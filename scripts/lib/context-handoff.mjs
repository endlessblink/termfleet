// "Hand over to a fresh instance when the context is about 50% full", for BOTH agents.
// Claude's transcript carries per-turn `usage`; Codex's rollout carries `token_count`
// events with the model's context window. Without this a Codex session never hands
// over and just runs its own "compacting context" instead.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Claude: input + cache tokens of the LAST assistant turn is the live context size. */
export function contextTokens(transcriptText) {
  let last = 0;
  for (const line of transcriptText.split("\n")) {
    if (!line.includes('"usage"')) continue;
    try {
      const usage = JSON.parse(line)?.message?.usage;
      if (!usage) continue;
      const total =
        (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
      if (total > 0) last = total;
    } catch {
      /* partial line */
    }
  }
  return last;
}

/** Codex: the last request's size and the model's window, from the rollout's token_count events. */
export function codexContext(rolloutText) {
  let tokens = 0;
  let windowTokens = 0;
  for (const line of rolloutText.split("\n")) {
    if (!line.includes('"token_count"')) continue;
    try {
      const info = JSON.parse(line)?.payload?.info;
      const used = info?.last_token_usage?.total_tokens ?? info?.last_token_usage?.input_tokens;
      if (used > 0) tokens = used;
      if (info?.model_context_window > 0) windowTokens = info.model_context_window;
    } catch {
      /* partial line */
    }
  }
  return { tokens, windowTokens };
}

/** Re-remind each time the context has grown this many points past the last reminder. */
export const RENAG_STEP = 15;

export function decide({ tokens, windowTokens, percent, mode, alreadyFired, lastFiredPercent, provider = "claude" }) {
  if (mode === "off" || tokens <= 0) return null;
  const used = (tokens / windowTokens) * 100;
  if (used < percent) return null;
  // One reminder is not enough: an agent mid-task can miss it and keep spending. Stay quiet until
  // the context has grown another RENAG_STEP points, then say it again, louder.
  const last = lastFiredPercent ?? (alreadyFired ? percent : undefined);
  if (last !== undefined && used < last + RENAG_STEP) return null;
  const rounded = Math.round(used);
  const how =
    mode === "auto"
      ? "Do it now, before anything else, without asking: follow the spawn-on-termfleet skill's handover recipe."
      : "Tell Noam in one plain sentence and offer to do it; only do it if he agrees.";
  const compaction =
    provider === "codex"
      ? " Do NOT wait for Codex to compact the context on its own: hand over instead, in a new Codex session."
      : "";
  const overdue = last !== undefined ? `STILL NOT HANDED OVER (reminded at ${Math.round(last)}%, every extra turn costs money). ` : "";
  return (
    `${overdue}Context is about ${rounded}% full: hand over to a fresh instance. Write an EXPANSIVE HANDOFF.md that skips nothing relevant: ` +
    `the original request in Noam's words and every later correction, the goal and definition of done, everything done so far with evidence, ` +
    `every file touched (with uncommitted state), decisions and why, rejected approaches, open problems, running processes/ports/builds, ` +
    `constraints and house rules, exact next steps, and the first command to run. Commit only your own files, then run ` +
    `\`termfleet-child spawn --provider ${provider} --cwd <project dir> --dropoff <abs path to HANDOFF.md>\` (never tmux; the card lands under the project's row; a handover always continues in the same kind of agent). ${how}${compaction}`
  );
}

/** The percent recorded by the last reminder; older markers held a timestamp, which means "fired at the threshold". */
function readLastPercent(marker) {
  try {
    const value = Number(readFileSync(marker, "utf8"));
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The advice to inject for this hook payload, or null. Re-fires every RENAG_STEP points of growth. */
export function handoffAdvice({ payload, provider, env = process.env }) {
  const mode = (env.TERMFLEET_CONTEXT_HANDOFF ?? "auto").toLowerCase();
  if (mode === "off") return null;
  const transcript = payload?.transcript_path ?? payload?.transcriptPath;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  if (!transcript || !sessionId || !existsSync(transcript)) return null;
  const stateDir = join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "termfleet", "context-handoff");
  const marker = join(stateDir, `${provider === "codex" ? "codex-" : ""}${String(sessionId).replace(/[^A-Za-z0-9-]/g, "")}.fired`);
  const text = readFileSync(transcript, "utf8");
  const fromCodex = provider === "codex" ? codexContext(text) : null;
  const tokens = fromCodex ? fromCodex.tokens : contextTokens(text);
  const windowTokens = Number(env.TERMFLEET_CONTEXT_WINDOW_TOKENS) || fromCodex?.windowTokens || 200_000;
  const usedPercent = (tokens / windowTokens) * 100;
  const message = decide({
    tokens,
    windowTokens,
    percent: Number(env.TERMFLEET_CONTEXT_HANDOFF_PERCENT) || 50,
    mode,
    alreadyFired: existsSync(marker),
    lastFiredPercent: readLastPercent(marker),
    provider,
  });
  if (!message) return null;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker, String(Math.round(usedPercent)));
  return message;
}
