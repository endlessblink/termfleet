#!/usr/bin/env node
// Claude prompt hook: configured threshold defaults to 25%, auto, with 15-point
// repeat advice. Injection and source freshness remain active even with advice off.
// PreToolUse checks late-source changes; usage advice still runs only on prompts.
// There is no semantic comprehension receipt.
import { contextTokens, decide, handoffAdvice } from "./lib/context-handoff.mjs";
import { handoffInjection, handoffMonitor, handoffHookOutput } from "./lib/handoff-inject.mjs";

export { contextTokens, decide };

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  const payload = JSON.parse(input || "{}");
  const event = payload.hook_event_name ?? payload.hookEventName ?? "UserPromptSubmit";
  const injected = (event === "UserPromptSubmit" ? handoffInjection(payload.prompt) : null) ?? handoffMonitor(process.env,{payload,provider:'claude'});
  const message = injected ?? (event === "UserPromptSubmit" ? handoffAdvice({payload,provider:"claude"}) : null);
  if (!message) return;
  process.stdout.write(
    `${JSON.stringify(handoffHookOutput(event,message))}\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main().catch(() => process.exit(0));
