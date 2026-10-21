import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.mjs';
import { tailLines } from './tail.mjs';

/**
 * How much of each plan's usage is left and when it renews, read ONLY from what
 * is already on this PC — never a call to Anthropic or OpenAI.
 *
 * - Claude: Claude Code hands its status line `rate_limits` (5-hour and 7-day
 *   windows); the status line wrapper keeps the newest copy in
 *   `terminal-workspace/usage/claude.json`.
 * - GPT/Codex: every Codex rollout records `token_count` events carrying
 *   `rate_limits.primary/secondary` with the window length in minutes.
 *
 * A window whose reset time has passed is reported as renewed (full) rather
 * than showing its old, pre-reset number. Nothing on disk → `known: false`.
 */

const dataHome = path.dirname(PATHS.agentStatus);
const claudeUsageFile = () => process.env.TC_CLAUDE_USAGE_FILE || path.join(dataHome, 'usage', 'claude.json');
const codexSessionsDir = () => process.env.TC_CODEX_SESSIONS_DIR || PATHS.codexSessions;
const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const toMs = (value) => {
  const n = finite(value);
  if (n != null) return n > 10_000_000_000 ? n : n * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

function windowOf(kind, usedPercent, resetsAt, now) {
  const used = finite(usedPercent);
  if (used == null) return null;
  const reset = toMs(resetsAt);
  if (reset != null && reset <= now) return { kind, remainingPercent: 100, resetsAt: null, renewed: true };
  return { kind, remainingPercent: Math.max(0, Math.min(100, Math.round(100 - used))), resetsAt: reset, renewed: false };
}

export function claudeUsageFrom(record, now = Date.now()) {
  const limits = record?.rate_limits;
  if (!limits || typeof limits !== 'object') return { id: 'claude', label: 'Claude', known: false, windows: [] };
  const windows = [
    windowOf('fiveHour', limits.five_hour?.used_percentage, limits.five_hour?.resets_at, now),
    windowOf('weekly', limits.seven_day?.used_percentage, limits.seven_day?.resets_at, now),
  ].filter(Boolean);
  return { id: 'claude', label: 'Claude', known: windows.length > 0, observedAt: finite(record.observedAt), windows };
}

export function codexUsageFrom(rateLimits, observedAt, now = Date.now()) {
  if (!rateLimits || typeof rateLimits !== 'object') return { id: 'codex', label: 'GPT', known: false, windows: [] };
  const windows = [];
  for (const raw of [rateLimits.primary, rateLimits.secondary]) {
    if (!raw || typeof raw !== 'object') continue;
    const minutes = finite(raw.window_minutes);
    // Only label a window we can name from its declared length; never guess.
    const kind = minutes === 300 ? 'fiveHour' : minutes === 10080 ? 'weekly' : null;
    if (!kind || windows.some((w) => w.kind === kind)) continue;
    const item = windowOf(kind, raw.used_percent, raw.resets_at, now);
    if (item) windows.push(item);
  }
  windows.sort((a, b) => (a.kind === 'fiveHour' ? 0 : 1) - (b.kind === 'fiveHour' ? 0 : 1));
  return { id: 'codex', label: 'GPT', known: windows.length > 0, observedAt, windows };
}

function readClaude(now) {
  try { return claudeUsageFrom(JSON.parse(fs.readFileSync(claudeUsageFile(), 'utf8')), now); }
  catch { return claudeUsageFrom(null, now); }
}

/** Newest few rollout files by modification time, from the last 8 day folders. */
function recentRollouts(root, limit = 6) {
  const files = [];
  const list = (dir) => { try { return fs.readdirSync(dir).sort().reverse(); } catch { return []; } };
  let days = 0;
  outer: for (const y of list(root)) for (const m of list(path.join(root, y))) for (const d of list(path.join(root, y, m))) {
    const dir = path.join(root, y, m, d);
    for (const name of list(dir)) if (name.endsWith('.jsonl')) {
      const file = path.join(dir, name);
      try { files.push({ file, mtimeMs: fs.statSync(file).mtimeMs }); } catch { /* vanished */ }
    }
    if (++days >= 8) break outer;
  }
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, limit);
}

let codexCache = null;
function readCodex(now) {
  const rollouts = recentRollouts(codexSessionsDir());
  const key = rollouts.map((r) => `${r.file}:${r.mtimeMs}`).join('|');
  if (codexCache?.key !== key) {
    let best = null;
    for (const { file } of rollouts) {
      const lines = tailLines(file, 2 * 1024 * 1024);
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"rate_limits"')) continue;
        let record; try { record = JSON.parse(lines[i]); } catch { continue; }
        const limits = record?.payload?.rate_limits;
        const at = Date.parse(String(record?.timestamp || ''));
        if (limits && Number.isFinite(at) && (!best || at > best.observedAt)) best = { rateLimits: limits, observedAt: at };
        break;
      }
    }
    codexCache = { key, rateLimits: best?.rateLimits || null, observedAt: best?.observedAt ?? null };
  }
  return codexUsageFrom(codexCache.rateLimits, codexCache.observedAt, now);
}

export function readUsageLimits(now = Date.now()) {
  return { providers: [readClaude(now), readCodex(now)] };
}
