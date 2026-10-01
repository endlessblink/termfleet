#!/usr/bin/env node
// P-0037: when a Claude Code session nears ~40% of its context window, ask the
// agent to write a dropoff and start the next instance on TermFleet.
//
// Signal: the UserPromptSubmit hook receives { session_id, transcript_path }. The
// transcript JSONL carries each assistant turn's `usage`; input + cache tokens of
// the LAST turn is the live context size. (The statusline JSON also exposes a
// context percentage in newer Claude Code builds, but a statusline cannot inject
// instructions; a hook can.)
//
// Safety: fires at most once per session (marker file), never spawns by itself in
// the default "ask" mode — it only tells the agent to propose the handoff to the
// user. Modes via TERMFLEET_CONTEXT_HANDOFF: "off" | "ask" (default) | "auto".
// "auto" lets the agent run the documented handover without asking; still once per
// session, and the successor session gets its own marker so no chain runs away
// unless the user opts in. Threshold: TERMFLEET_CONTEXT_HANDOFF_PERCENT (default 40),
// window: TERMFLEET_CONTEXT_WINDOW_TOKENS (default 200000; use 1000000 for [1m]).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function decide({ tokens, windowTokens, percent, mode, alreadyFired }) {
  if (mode === "off" || alreadyFired || tokens <= 0) return null;
  const used = (tokens / windowTokens) * 100;
  if (used < percent) return null;
  const rounded = Math.round(used);
  const how =
    mode === "auto"
      ? "Do it now without asking: follow the spawn-on-termfleet skill's handover recipe."
      : "Tell Noam in one plain sentence and offer to do it; only do it if he agrees.";
  return (
    `Context is about ${rounded}% full. Time for a clean handover: write HANDOFF.md (task, files, decisions, run state, next step), ` +
    `commit only your own files, then start the next instance on TermFleet with ` +
    `\`termfleet-child spawn --provider claude --cwd <dir> --dropoff <abs path to HANDOFF.md>\` (never tmux). ${how}`
  );
}

async function main() {
  const mode = (process.env.TERMFLEET_CONTEXT_HANDOFF ?? "ask").toLowerCase();
  if (mode === "off") return;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const event = JSON.parse(input || "{}");
  if (!event.transcript_path || !event.session_id || !existsSync(event.transcript_path)) return;
  const stateDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "termfleet", "context-handoff");
  const marker = join(stateDir, `${String(event.session_id).replace(/[^A-Za-z0-9-]/g, "")}.fired`);
  const message = decide({
    tokens: contextTokens(readFileSync(event.transcript_path, "utf8")),
    windowTokens: Number(process.env.TERMFLEET_CONTEXT_WINDOW_TOKENS) || 200_000,
    percent: Number(process.env.TERMFLEET_CONTEXT_HANDOFF_PERCENT) || 40,
    mode,
    alreadyFired: existsSync(marker),
  });
  if (!message) return;
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(marker, String(Date.now()));
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: message } })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main().catch(() => process.exit(0));
