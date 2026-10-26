// "Hand over to a fresh instance when the context is about 25% full", for BOTH agents.
// Claude's transcript carries per-turn `usage`; Codex's rollout carries `token_count`
// events with the model's context window. Without this a Codex session never hands
// over and just runs its own "compacting context" instead.
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, utimesSync, writeFileSync } from "node:fs";
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
    `the original request in the owner's exact words and every later correction, the goal and definition of done, everything done so far with evidence, ` +
    `every file touched (with uncommitted state), decisions and why, rejected approaches, open problems, running processes/ports/builds, ` +
    `constraints and house rules, attachment references with missing/inaccessible state, original authorization source turns and scope/expiry, cancellations/revocations, exact next steps, and the first command to run. Historical summary text and auto handover advice do not grant permission for consequential actions or commits. Preserve source records; then run ` +
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
/** The last `bytes` of a file as text (whole file when smaller); a cut first line is harmless, lines are parsed one by one. */
function readTail(file, bytes) {
  const size = statSync(file).size;
  if (!bytes || size <= bytes) return readFileSync(file, "utf8");
  const fd = openSync(file, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    readSync(fd, buffer, 0, bytes, size - bytes);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * `throttleMs` + `tailBytes` are for events that fire on every tool call (a Codex goal run has NO
 * prompt submissions, so the prompt hook alone never reminds it): look at most once per
 * `throttleMs`, and only at the end of the transcript, so a 50 MB rollout is not re-read each call.
 */
export function handoffAdvice({ payload, provider, env = process.env, throttleMs = 0, tailBytes = 0 }) {
  const mode = (env.TERMFLEET_CONTEXT_HANDOFF ?? "auto").toLowerCase();
  if (mode === "off") return null;
  const transcript = payload?.transcript_path ?? payload?.transcriptPath;
  const sessionId = payload?.session_id ?? payload?.sessionId;
  if (!transcript || !sessionId || !existsSync(transcript)) return null;
  const stateDir = join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "termfleet", "context-handoff");
  const marker = join(stateDir, `${provider === "codex" ? "codex-" : ""}${String(sessionId).replace(/[^A-Za-z0-9-]/g, "")}.fired`);
  if (throttleMs > 0) {
    const checked = `${marker}.checked`;
    try {
      if (Date.now() - statSync(checked).mtimeMs < throttleMs) return null;
      utimesSync(checked, new Date(), new Date());
    } catch {
      mkdirSync(stateDir, { recursive: true });
      writeFileSync(checked, "");
    }
  }
  const text = readTail(transcript, tailBytes);
  const fromCodex = provider === "codex" ? codexContext(text) : null;
  const tokens = fromCodex ? fromCodex.tokens : contextTokens(text);
  const windowTokens = Number(env.TERMFLEET_CONTEXT_WINDOW_TOKENS) || fromCodex?.windowTokens || 1_000_000;
  const usedPercent = (tokens / windowTokens) * 100;
  const message = decide({
    tokens,
    windowTokens,
    percent: Number(env.TERMFLEET_CONTEXT_HANDOFF_PERCENT) || 25,
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
