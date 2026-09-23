import fs from 'node:fs';
import { transcriptPath as codexTranscriptPath } from './adapters/codex.mjs';
import { tailLines } from './tail.mjs';

const cache = new Map();

const finite = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function resetAt(value) {
  const number = finite(value);
  if (number != null) return number > 10_000_000_000 ? number : number * 1000;
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function limitSnapshot(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const usedPercent = finite(raw.used_percent);
  if (usedPercent == null) return null;
  return {
    usedPercent,
    remainingPercent: Math.max(0, Math.min(100, 100 - usedPercent)),
    windowMinutes: finite(raw.window_minutes),
    resetsAt: resetAt(raw.resets_at),
  };
}

function namedLimits(rateLimits) {
  const candidates = [rateLimits?.primary, rateLimits?.secondary]
    .map(limitSnapshot)
    .filter(Boolean);
  const byMinutes = (minutes) => candidates.find((item) => item.windowMinutes === minutes) || null;
  return {
    // Codex calls these primary and secondary. Prefer their declared window
    // lengths; the positional fallback preserves useful status on older logs.
    fiveHour: byMinutes(300) || limitSnapshot(rateLimits?.primary),
    weekly: byMinutes(10080) || limitSnapshot(rateLimits?.secondary),
  };
}

export function foldCodexStatus(records) {
  let workingSince = null;
  let limits = { fiveHour: null, weekly: null };

  for (const record of records) {
    const payload = record?.payload;
    if (!payload || typeof payload !== 'object') continue;
    if (payload.type === 'task_started') {
      const at = Date.parse(String(record.timestamp || ''));
      workingSince = Number.isFinite(at) ? at : workingSince;
    } else if (payload.type === 'task_complete') {
      workingSince = null;
    } else if (payload.type === 'token_count' && payload.rate_limits) {
      limits = namedLimits(payload.rate_limits);
    }
  }

  return { workingSince, limits };
}

export function readSessionStatus(pane) {
  if (pane.provider !== 'codex') return { workingSince: null, limits: { fiveHour: null, weekly: null } };
  const file = codexTranscriptPath(pane);
  if (!file) return { workingSince: null, limits: { fiveHour: null, weekly: null } };

  let stat;
  try { stat = fs.statSync(file); } catch { return { workingSince: null, limits: { fiveHour: null, weekly: null } }; }
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;

  const records = [];
  for (const line of tailLines(file, 12 * 1024 * 1024)) {
    try { records.push(JSON.parse(line)); } catch { /* a partial vendor record carries no status */ }
  }
  const value = foldCodexStatus(records);
  cache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, value });
  return value;
}
