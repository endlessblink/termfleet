// Fleet-wide context health monitoring (TF-096): each agent terminal's context
// usage at a glance — normal, elevated, or critical — so the Agent-Manager and
// the phone can spot runaway sessions before they burn money on compaction.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { contextTokens, codexContext } from './context-handoff.mjs';
import { fleetPanes } from '../../termcontrol/bridge/orchestrate.mjs';
import { adapterFor } from '../../termcontrol/bridge/feed.mjs';

/** Last `bytes` of a file as text; a partial first line is harmless — lines are parsed individually. */
function readTail(file, bytes) {
  const size = statSync(file).size;
  if (size <= bytes) return readFileSync(file, 'utf8');
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    readSync(fd, buffer, 0, bytes, size - bytes);
    return buffer.toString('utf8');
  } finally { closeSync(fd); }
}

const TAIL_BYTES = 512 * 1024;
const CLAUDE_WINDOW = 1_000_000;

/**
 * Find the transcript file for any pane by delegating to the feed adapter
 * (claude.mjs / codex.mjs / opencode.mjs each know their own layout).
 */
export function findTranscriptPath(pane) {
  try {
    const adapter = adapterFor(pane);
    return adapter?.transcriptPath(pane) || null;
  } catch { return null; }
}

/**
 * Context health for a single pane: how full is its context window?
 * Returns null when no transcript is found or the pane is not alive.
 */
export function paneContextHealth(pane) {
  try {
    if (!pane.alive) return null;
    const file = findTranscriptPath(pane);
    if (!file) return null;
    const tail = readTail(file, TAIL_BYTES);
    let tokens = 0;
    let windowTokens = CLAUDE_WINDOW;

    if (pane.provider === 'codex') {
      const cx = codexContext(tail);
      tokens = cx.tokens;
      windowTokens = cx.windowTokens || CLAUDE_WINDOW;
    } else {
      tokens = contextTokens(tail);
    }

    if (tokens <= 0) return null;

    const percent = (tokens / windowTokens) * 100;
    const level = percent >= 78 ? 'critical' : percent >= 55 ? 'elevated' : 'normal';

    return {
      paneId: pane.id,
      name: pane.profile?.name || pane.project || null,
      provider: pane.provider,
      sessionId: pane.sessionId || null,
      tokens,
      windowTokens,
      percent,
      level,
    };
  } catch { return null; }
}

/** Context health for every alive agent terminal, sorted critical-first. */
export async function fleetContextHealth() {
  const panes = (await fleetPanes()).filter((p) => p.alive && p.provider !== 'shell');
  const results = panes.map((p) => paneContextHealth(p)).filter(Boolean);
  const order = { critical: 0, elevated: 1, normal: 2 };
  results.sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
  return results;
}

/** Panes whose context usage is above `threshold` percent. */
export async function contextAlert(threshold = 78) {
  const health = await fleetContextHealth();
  return health.filter((h) => h.percent >= threshold);
}
