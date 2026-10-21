#!/usr/bin/env node
// Action log hook (TF-098): records what a terminal agent did, in plain words, for the
// Activity view of the bot that started it. Claude and Codex call it on PostToolUse
// (the action happened) and PermissionRequest (the agent asked first). Record only:
// it never blocks, never prints, and always exits 0.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { classifyTool, appendAction, paneLogFile } from '../termcontrol/bridge/action-log.mjs';

const ASK_TTL_MS = 60 * 60 * 1000;
const fingerprint = (name, input) => crypto.createHash('sha1').update(`${name}\n${JSON.stringify(input ?? null)}`).digest('hex').slice(0, 16);

export function handle(payload, env = process.env, now = Date.now()) {
  const paneId = String(env.TERMFLEET_PANE_ID || '').slice(0, 200);
  // A bot's own brain is recorded by the bridge; outside TermFleet there is no card to show it on.
  if (!paneId || env.TERMFLEET_BOT_ID) return null;
  const event = String(payload.hook_event_name || payload.hookEventName || '');
  const name = String(payload.tool_name || payload.toolName || '');
  const input = payload.tool_input ?? payload.toolInput ?? {};
  if (!name) return null;
  const file = paneLogFile(paneId);
  const askFile = file.replace(/\.jsonl$/, '.asked.json');
  const key = fingerprint(name, input);
  if (event === 'PermissionRequest') {
    let asked = {};
    try { asked = JSON.parse(fs.readFileSync(askFile, 'utf8')) || {}; } catch { asked = {}; }
    for (const [k, at] of Object.entries(asked)) if (now - at > ASK_TTL_MS) delete asked[k];
    asked[key] = now;
    fs.mkdirSync(path.dirname(askFile), { recursive: true, mode: 0o700 });
    fs.writeFileSync(askFile, JSON.stringify(asked), { mode: 0o600 });
    return { asked: key };
  }
  if (event !== 'PostToolUse') return null;
  const cwd = String(payload.cwd || process.cwd());
  const action = classifyTool(name, input, cwd);
  if (!action) return null;
  let asked = false;
  try {
    const marks = JSON.parse(fs.readFileSync(askFile, 'utf8')) || {};
    if (marks[key] && now - marks[key] < ASK_TTL_MS) { asked = true; delete marks[key]; fs.writeFileSync(askFile, JSON.stringify(marks), { mode: 0o600 }); }
  } catch { /* nothing was asked */ }
  const entry = {
    at: now, actor: 'terminal', paneId, provider: env.CODEX_THREAD_ID || payload.turn_id ? 'codex' : 'claude',
    ...action, toolUseId: payload.tool_use_id || payload.toolUseId || null,
    mode: payload.permission_mode || payload.permissionMode || payload.approval_policy || null, asked, cwd,
  };
  appendAction(file, entry);
  return entry;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try { handle(JSON.parse(raw || '{}')); } catch { /* never in the agent's way */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
