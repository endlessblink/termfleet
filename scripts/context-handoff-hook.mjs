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
// user. Modes via TERMFLEET_CONTEXT_HANDOFF: "off" | "ask" | "auto" (default).
// "auto" lets the agent run the documented handover without asking; still once per
// session, and the successor session gets its own marker so no chain runs away
// unless the user opts in. Threshold: TERMFLEET_CONTEXT_HANDOFF_PERCENT (default 40),
// window: TERMFLEET_CONTEXT_WINDOW_TOKENS (default 200000; use 1000000 for [1m]).
import { contextTokens, decide, handoffAdvice } from "./lib/context-handoff.mjs";

export { contextTokens, decide };

async function main() {
  if ((process.env.TERMFLEET_CONTEXT_HANDOFF ?? "auto").toLowerCase() === "off") return;
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const message = handoffAdvice({ payload: JSON.parse(input || "{}"), provider: "claude" });
  if (!message) return;
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: message } })}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main().catch(() => process.exit(0));
