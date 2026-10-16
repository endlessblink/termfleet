#!/usr/bin/env node
// TF-096 sure gate. Noam 2026-10-16: "create a gate that forces you to run /sure and
// pass it only on high". Before an agent changes a code file it must have answered
// /sure (root cause, confidence, fix, side effects) at HIGH confidence since the
// operator's latest message. Works as a PreToolUse hook for Claude Code (Edit, Write,
// MultiEdit, NotebookEdit, lean-ctx ctx_patch) and Codex (apply_patch).
//
// Blocks with exit 2 (both agents feed stderr back to the model). Off switch:
// TERMFLEET_SURE_GATE=off. Notes, plans and scratch files are never gated.
import { closeSync, openSync, readFileSync, readSync, statSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const TAIL_BYTES = 4 * 1024 * 1024;

/** Paths an agent may write without /sure: scratch, memory, notes and plans. */
export function exempt(file) {
  if (!file) return false;
  const p = String(file);
  const home = homedir();
  if (p.startsWith(tmpdir() + '/') || p.startsWith('/tmp/')) return true;
  if (p.startsWith(`${home}/.cache/`)) return true;
  if (/\/\.claude\/projects\/[^/]+\/memory\//.test(p)) return true;
  return /\.(md|markdown|txt)$/i.test(p);
}

export function targetFile(toolName, input = {}) {
  if (typeof input.file_path === 'string') return input.file_path;
  if (typeof input.notebook_path === 'string') return input.notebook_path;
  if (typeof input.path === 'string') return input.path;
  // Codex apply_patch: the patch text names its files.
  const patch = typeof input.input === 'string' ? input.input : typeof input.patch === 'string' ? input.patch : typeof input.command === 'string' ? input.command : '';
  const files = [...patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map((m) => m[1].trim());
  if (files.length) return files.every(exempt) ? files[0] : files.find((f) => !exempt(f));
  return null;
}

export const GATED_TOOL = /^(Edit|Write|MultiEdit|NotebookEdit|mcp__lean-ctx__ctx_patch|apply_patch)$/;

function tail(file, bytes = TAIL_BYTES) {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8');
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
  } finally { closeSync(fd); }
}

const textOf = (content) => typeof content === 'string' ? content
  : Array.isArray(content) ? content.filter((b) => ['text', 'input_text', 'output_text'].includes(b?.type)).map((b) => b.text || '').join('\n') : '';

const RECORDED = /termfleet-sure\b/;
const commandText = (input) => {
  if (!input) return '';
  if (typeof input === 'string') { try { return commandText(JSON.parse(input)); } catch { return input; } }
  return [input.command, input.cmd, input.input].filter((v) => typeof v === 'string').join('\n') || (Array.isArray(input.command) ? input.command.join(' ') : '');
};

/**
 * One normalized turn per line: who spoke and what they wrote, for Claude and Codex
 * records. A `termfleet-sure` command counts as the agent's words: a plain text reply
 * is sometimes not saved before the next tool runs, a tool call always is.
 */
export function turns(lines) {
  const out = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o?.type === 'user' || o?.type === 'assistant') {
      if (o.isSidechain || o.isMeta) continue;
      const content = o.message?.content;
      if (o.type === 'user' && Array.isArray(content) && content.some((b) => b?.type === 'tool_result')) continue;
      const text = textOf(content);
      if (text.trim()) out.push({ role: o.type, text });
      if (o.type === 'assistant' && Array.isArray(content)) {
        for (const b of content) if (b?.type === 'tool_use') { const c = commandText(b.input); if (RECORDED.test(c)) out.push({ role: 'assistant', text: c }); }
      }
    } else if (o?.type === 'response_item' && ['function_call', 'local_shell_call', 'custom_tool_call'].includes(o.payload?.type)) {
      const c = commandText(o.payload.arguments ?? o.payload.action ?? o.payload.input);
      if (RECORDED.test(c)) out.push({ role: 'assistant', text: c });
    } else if (o?.type === 'response_item' && o.payload?.type === 'message') {
      const role = o.payload.role === 'assistant' ? 'assistant' : o.payload.role === 'user' ? 'user' : null;
      const text = textOf(o.payload.content);
      if (role && text.trim()) out.push({ role, text });
    }
  }
  return out;
}

/** Text the harness injects as a user turn is not the operator speaking. */
const injected = (text) => /^\s*(<(system-reminder|command-|local-command|task-notification|user-prompt-submit-hook)|\[SYSTEM NOTIFICATION|Caveat:|<environment_context>|# AGENTS\.md|<user_instructions>)/i.test(text);

export function sureVerdict(text) {
  if (!/root\s*cause/i.test(text)) return null;
  const m = /confidence[^\n]{0,60}?\b(HIGH|MEDIUM|LOW)\b/i.exec(text) || /^\s*[-*]?\s*\**\s*(HIGH|MEDIUM|LOW)\s*\**\s*[—:-]/im.exec(text);
  return m ? m[1].toUpperCase() : null;
}

/** HIGH if the newest /sure answer after the operator's latest message is HIGH. */
export function gateState(allTurns) {
  let lastOperator = -1;
  allTurns.forEach((t, i) => { if (t.role === 'user' && !injected(t.text)) lastOperator = i; });
  let verdict = null;
  for (let i = lastOperator + 1; i < allTurns.length; i++) {
    if (allTurns[i].role !== 'assistant') continue;
    const v = sureVerdict(allTurns[i].text);
    if (v) verdict = v;
  }
  return verdict;
}

export const BLOCK_MESSAGE = (verdict) => verdict && verdict !== 'HIGH'
  ? `Sure gate: your latest /sure answer is ${verdict}. Do the research it lists first (read, search, test), then answer /sure again; code changes unlock only at HIGH.`
  : 'Sure gate: before changing code, record your /sure answer by running: termfleet-sure "1. Root cause: <one sentence> 2. Confidence: HIGH|MEDIUM|LOW 3. <what you would check if not HIGH> 4. Fix: <what changes, where> 5. Side effects: <what could break>". Code changes unlock at HIGH and stay unlocked until the operator writes again. Notes, plans and scratch files are not gated.';

export function decide(payload, { readLines = (f) => tail(f).split('\n') } = {}) {
  if (process.env.TERMFLEET_SURE_GATE === 'off') return { allow: true, why: 'off' };
  const tool = payload?.tool_name || payload?.toolName || '';
  if (!GATED_TOOL.test(tool)) return { allow: true, why: 'not a code change' };
  const file = targetFile(tool, payload?.tool_input || payload?.toolInput || {});
  if (file && exempt(file)) return { allow: true, why: 'exempt file' };
  const transcript = payload?.transcript_path;
  if (!transcript) return { allow: true, why: 'no transcript' };
  let lines;
  try { lines = readLines(transcript); } catch { return { allow: true, why: 'transcript unreadable' }; }
  const verdict = gateState(turns(lines));
  return verdict === 'HIGH' ? { allow: true, why: 'sure HIGH' } : { allow: false, verdict, message: BLOCK_MESSAGE(verdict) };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  let payload = {};
  try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
  const result = decide(payload);
  if (!result.allow) { process.stderr.write(result.message + '\n'); process.exit(2); }
  process.exit(0);
}
