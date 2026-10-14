// How full an agent's working memory (context window) is, read from its own
// conversation record. On long runs this is what predicts a memory squeeze or a
// handover, so the phone shows it next to the status.
import fs from 'node:fs';
import { tailLines } from './tail.mjs';
import { claudeTranscript } from './paths.mjs';
import { transcriptPath as codexTranscript } from './adapters/codex.mjs';

const cache = new Map();

/** Claude: the newest assistant record's prompt size against its model's window. */
export function claudeFill(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const message = records[i]?.message;
    const usage = message?.usage;
    if (records[i]?.type !== 'assistant' || !usage || records[i]?.isSidechain) continue;
    const used = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    if (!used) continue;
    const model = String(message.model || '');
    // Current Opus and Sonnet run with a 1M-token window (checked 2026-10-12 against
    // Claude's own "ctx:" readout on 17 live panes); Haiku keeps 200k.
    const window = /haiku/i.test(model) && used <= 200_000 ? 200_000 : 1_000_000;
    return { used, window, percent: Math.min(100, Math.round((used / window) * 100)) };
  }
  return null;
}

/** Codex: its own token_count event carries the last prompt size and the window. */
export function codexFill(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const info = records[i]?.payload?.type === 'token_count' ? records[i].payload.info : null;
    const window = Number(info?.model_context_window);
    const used = Number(info?.last_token_usage?.input_tokens ?? info?.last_token_usage?.total_tokens);
    if (!window || !used) continue;
    // Codex reserves a fixed baseline for its own instructions and leaves it out of
    // its "Context N% used" readout; match that so the phone and terminal agree.
    const BASELINE = 12_000;
    const percent = window > BASELINE ? Math.round((Math.max(0, used - BASELINE) / (window - BASELINE)) * 100) : 0;
    return { used, window, percent: Math.min(100, percent) };
  }
  return null;
}

export function contextFill(pane) {
  let file = null;
  try {
    file = pane.provider === 'claude' ? claudeTranscript(pane.cwd, pane.sessionId)
      : pane.provider === 'codex' ? codexTranscript(pane) : null;
  } catch { return null; }
  if (!file) return null;
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.value;
  const records = [];
  for (const line of tailLines(file, 2 * 1024 * 1024)) {
    try { records.push(JSON.parse(line)); } catch { /* a cut record carries nothing */ }
  }
  const value = pane.provider === 'claude' ? claudeFill(records) : codexFill(records);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}
