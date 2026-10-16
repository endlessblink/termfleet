# TF-096 teammates — research record (2026-10-16)

Operator asks this answers (his words): "Research long lasting memory"; "If a model runs out of credits it should move to another so its possible to set default and than fallback based on what is working"; "my agents are really not good with memory and compact too much or change course and forget things"; "dont understand what I ask and build broken things"; "they get disconnected from the pc's, get blocked on basic things". Status of each research track is at the end.

## 1. Model fallback when credits run out (deep pass — DONE)

**Detection (typed signals first, text second):**

| Agent | Typed signal | Text fallback |
|---|---|---|
| Claude Code | `StopFailure` hook, `error_type` in {rate_limit, billing_error}; statusline `rate_limits.five_hour/seven_day.{used_percentage,resets_at}` (Pro/Max, after first response); stream-json `rate_limit_event.rate_limit_info.status == "rejected"` + `resetsAt` | `You've hit your (session|weekly|Opus|Sonnet) limit · resets …`, `Usage limit reached · limit resets …`, `monthly spend limit` |
| Codex CLI | rollout `token_count.rate_limits` (primary 300 min / secondary 10080 min, `used_percent`, `resets_at`, `rate_limit_reached_type`); `codexErrorInfo: usageLimitExceeded` | `You’ve hit your usage limit` (curly ’), `Try again at …`, `out of credits`, `spend cap`; exit code is always 1 — useless |
| OpenCode | none built in (community fallback plugins) | 429, `rate limit`, `quota exceeded`, `usage limit reached`, `credit balance too low` |
| Gemini CLI | `TerminalQuotaError` (vs retryable) | quota/429 |
| Cursor CLI | none | `ActionRequiredError … out of usage`, `[resource_exhausted]` |
| Grok Build / Qwen | none documented | `free Grok Build usage limit`; `Qwen API quota exceeded`, free tier discontinued |

Not a switch: 529 overloaded, short 429 throttles, auth errors, Opus/Sonnet-only limits (switch model inside the same agent instead).

**Claude now waits by itself** (v2.1.234+: "Continuing automatically at 3:45pm · esc to cancel", re-arms twice). A fallback must cancel that wait (Esc) or stop the process first, or the old pane resumes later and races the new one.

**Prior art:** bounce-router (MIT; original ask + bounded journal + git state handoff; 30 min cooldown), agworkbench #24 (watch pane text, wait for exit, `limitedUntil`), willynikes2/agent-orchestrator (MIT, next-man-up), t3code PR #17753 (`fallbackTriggered` guard), claude-code-router / LiteLLM / OpenRouter (API-key routers, not subscription-aware), ccusage (estimates only).

**Terms of service:** switch only between different providers/plans the operator pays for, each as the vendor's unmodified CLI with its own login. Never rotate several accounts of one provider to dodge limits (OpenAI terms forbid circumventing limits; Anthropic forbids routing subscription credentials through third parties). No token proxying, no auto-buying credits.

**Design:**
- Per teammate: default agent + ordered fallbacks (each may be marked "never auto-switch").
- Hooks/plugin write `limit: {kind, resetsAt, source}` into the pane sidecar.
- Switch only between turns: cancel Claude's wait / stop the agent → write handover (original ask in his words, plan, last N turns, git state) → start next agent in the same folder with the teammate's memory.
- Warning only at ~95% used.
- Card line: "Claude reached its limit (resets 3:45pm) — continuing on Codex", with a 30 s "stay and wait" undo.
- Return to the default after `resetsAt`, only at the next idle point; unknown reset → 30 min cooldown.
- One switch per limit event.
- Instruction files differ (CLAUDE.md vs AGENTS.md vs GEMINI.md): keep one shared source; translate permission modes explicitly.

Sources: code.claude.com/docs/en/{errors,interactive-mode,hooks,statusline,legal-and-compliance}; github.com/openai/codex codex-rs/protocol/src/error.rs; github.com/richet/bounce-router; github.com/yeroo/agworkbench/issues/24; github.com/pingdotgg/t3code/pull/17753; anthropic.com/legal/consumer-terms; openai.com/policies/row-terms-of-use.

**Local evidence on this PC (read-only):**
- Claude out-of-limit record in the transcript: `assistant`, `model:"<synthetic>"`, `isApiErrorMessage:true`, `error:"rate_limit"`, `apiErrorStatus:429`, `quotaLimits:{status:"rejected", resetsAt, rateLimitType:"five_hour"|"seven_day", overage…}`, text "You've hit your session limit · resets 3:30pm (Asia/Jerusalem)". It is followed by `system/informational` "Usage limit reached · continuing automatically at … · esc or type to cancel" and later "Usage limit reset". `quotaLimits` appears only on the error record, so there is no spend-free "% left" for Claude from transcripts.
- Codex: `token_count.rate_limits` (`credits{has_credits,unlimited,balance}`, `plan_type`, windows). Text: "You've hit your usage limit. Visit … or try again at 12:48 AM." The same failure also silently failed automatic approvals.
- OpenCode log: `AI_APICallError: Weekly usage limit reached. Resets in 3 days…` / `5-hour usage limit reached. Resets in 4hr 31min`.
- Installed: codex 0.162.1, opencode 1.18.31 (logged in to zai-coding-plan, openai, opencode-go, ollama, togetherai), grok 1.0.34, aider. Claude has one login; `~/.claude-work` has no credentials. No gemini/qwen/cursor-agent on PATH.
- Bug fixed 2026-10-16: a weekly-only Codex record showed the same "74% left" as both 5-hour and weekly (test in orchestrate.test.mjs).
- Handover across agent kinds is blocked today in three places: termfleet-child forces the caller's provider; handoff-capsule only knows claude/codex; handoff-inject pauses on a provider mismatch. All three need an explicit fallback path.

## 2. Long-lasting memory (deep pass — DONE; the earlier light pass is superseded)

**Main finding: memory is not the bottleneck; holding on to the ask and proving the work are.**
- Context files (AGENTS.md etc.) did not raise success and cost >20% more (arxiv 2602.11988). Context strategy did not move correctness in 288 Claude/Codex runs; failures were implementation skill (arxiv 2607.27250).
- Multi-turn work loses ~39%: models assume early, lock on, don't recover; recapping the user's earlier turns recovers much of it; one full written spec removes most of the loss (arxiv 2505.06120, ICLR 2026).
- 65-69% of 516 "done" claims had no passing test behind them (specstory). Anthropic's long-running harness fix: JSON feature list, every item starts failing, flipped only via a `passes` field after user-style end-to-end testing.
- Agents ask for clarification in 1-2% of interactions; letting them ask recovers up to 74% on underspecified tasks (arxiv 2502.13069); a separate gap-finder role helps (arxiv 2603.26233).
- Coding-memory benchmark (DreamBench-SWE, arxiv 2608.20664): no memory 11.7%, verbatim event memory 45.6%, typed+raw 46.1%.
- Risks: memory poisoning (MINJA >95% injection; 1.2% poisoned corpus dropped accuracy 0.85→0.30; write-time screening caught 0/360), revoked facts outranking replacements (arxiv 2609.08258). Cursor removed Memories in 2.1 in favour of rules; Devin suggests knowledge and a human approves.

**Fixes per failure mode the operator named:**
- **A. Forgetting after compaction.** Re-inject the operator's exact words + item status after every compaction and fresh start. Claude: SessionStart `source:"compact"` additionalContext; Codex: PreCompact/PostCompact/SessionStart hooks; OpenCode: `experimental.session.compacting` plugin.
- **B. Drifting.** Goal anchored outside the conversation, restated at checkpoints; prefer a fresh start with a full written brief over repeated compaction.
- **C. Misunderstanding.** Before building, restate the ask as numbered items in his words, flag implied items, ask the gaps, wait for OK.
- **D. Broken things claimed done.** A Stop hook (Claude and Codex) blocks "done" unless every item has outside proof (command + output, screenshot, test name).
- **E. Silently doing less than asked.** Ask Ledger: every request verbatim, split into items with status todo/partial/done/dropped-with-reason + proof; the final message must name anything not done.

**Recommended architecture:**
1. Ask Ledger per teammate (SQLite/JSON), written by a prompt hook, re-injected at start/resume/compaction; the ~80% fresh-start brief is generated from the ledger + git state, not a model summary.
2. Done gate (Stop hook) + card shows "3/5 done, 1 partial".
3. Understand-first step for new or ambiguous asks.
4. Verbatim archive of all transcripts from every vendor, hybrid search (SQLite FTS5 + sqlite-vec, bge-m3 or Qwen3-Embedding via local Ollama; test 50 Hebrew/English queries first) through one `recall` tool — works when a teammate switches agent kind.
5. Curated card (<2k tokens): operator preferences and corrections verbatim, decisions, failed approaches, lessons/procedures; agents only propose entries, the operator approves (Devin style).
6. Shared (project facts, decisions, ledger) vs private scratch; every row has source and approval; superseded rows filtered out at lookup.
7. Nightly consolidation with a local model only, propose-only diff for a morning review; never auto-applied.
8. Measure on real asks: share of ledger items fully done, reopened "done"s, how often the operator repeats himself.
If an engine is ever needed: Hindsight (MIT, local, 91.4% LongMemEval peer-reviewed) over Mem0/OpenMemory. Gaps: no Hebrew retrieval benchmarks; several vendor scores self-reported; failure-mode fixes rest on single studies.

## 3. Blocked and disconnected (deep pass + local counts — DONE)

**Local evidence, last 7 days.** Claude: 356 transcripts, 38,419 tool results, 2,287 errors/blocks (~6%). Codex: 3,197 rollouts, 789 failed/blocked.

Claude, ranked:
1. Our own PreToolUse gates: 770 (paid_go_gate 200, context-mode redirect 152, pixel_reviewer 146, HARD RULE 66, design_skill_gate 47, render-guard 44).
2. lean-ctx allowlist: 528 (a blocked segment rejects the whole pipeline; shell functions, cmp, nvidia-smi, base64, mktemp…).
3. Interpreter blocks (python heredoc/inline): 326.
4. Not found: 55.
5. Timeouts: 39.
6. Auto-mode classifier denials: 37.
7. Auth/403: 13.
8. Rate limit: 1.

Codex:
- Sandbox network denials: 69. The config is `workspace-write` with `network_access` unset, so ssh/curl to the VPS fail.
- DNS/network: 49.
- Not found: 68.
- Timeouts: 49.
- Auth: 9.

TermFleet keeps no record of approval waits today.

**Main finding:** the top three blockers (~1,600 events) are policy we wrote ourselves, not vendor limits. Each costs the agent a turn and often makes it change course, which matches the "change course and forget things" complaint.

**Disconnection lessons (Grok Bot forum):**
- Grok Bot's local-exec daemon gets SIGTERM'd while the app runs.
- It pauses on screen lock or lost window focus.
- It stays dead after a restart.
- It shows "connected" while file access fails.

So the link must not depend on a GUI app, and "connected" must be proven end to end. The Cursor self-hosted worker pattern: outbound-only, hibernate and reconnect with the same id.

**Design: never blocked, never disconnected:**
1. Teammates run under the PTY daemon as a systemd user unit with linger, so UI, lock or window state never kill them. A VPS uses the same daemon over Tailscale, outbound only.
2. A heartbeat every 30 s that does a real round trip. States: Connected (<60 s), Degraded (1-5 min), Lost (>5 min). Jittered reconnect that never gives up; resume the same conversation.
3. Preflight on wake: auth (gh, gcloud, codex, claude), binaries/PATH, disk, network to needed hosts, sandbox mode, git state. Any failure becomes one plain ask before starting, never a mid-task 403.
4. Non-interactive environment in every teammate terminal: PAGER=cat, GIT_PAGER=cat, GIT_EDITOR=true, EDITOR=true, GIT_TERMINAL_PROMPT=0, GIT_ASKPASS=true, SSH_ASKPASS_REQUIRE=never, DEBIAN_FRONTEND=noninteractive, CI=1, ssh BatchMode, sudo -n. A no-output watchdog reports "waiting for input: <prompt>".
5. Pre-approved safe actions per teammate:
   - Claude: dontAsk plus an explicit allow list.
   - Codex: workspace-write profile with network on.
   - OpenCode: bash patterns.
   - lean-ctx: add the missing read-only binaries; teach "script file, not inline".
   - Hard-deny only destructive or paid actions.
6. Gates that only block become one-tap phone asks (Approve / Deny / Always for this pattern). Every ask is logged with timestamps. Login, 2FA and CAPTCHA become "do this on your phone" asks.
7. Recovery playbook per blocker class:
   - Allowlist block: try the allowed form once.
   - Auth: pause and ask.
   - Network: wait for the heartbeat.
   - Rate limit: sleep until the reset, or fall back (section 1).
   - Never retry the same blocked command.
8. Health light on every card: link, preflight result, waiting-on-you count and oldest age, last heartbeat.

**Quick wins — APPLIED 2026-10-16 on Noam's OK ("Apply them now"):** Codex `network_access = true` (backup `config.toml.bak.20261016-tf096`); lean-ctx now allows cmp, nvidia-smi, base64, mktemp, od, fc-list, findmnt, getent, pdfinfo, top; global render-guard now ASKS (phone-answerable permission prompt) instead of blocking (backup `.bak.20261016-tf096`); paid_go_gate + pixel_reviewer handed to the Freelance Desk agent to switch to ask (its own project/tests). Approval logging stays for phase C. Original list:
- Codex network access, or a separate ops profile.
- Add ~10 read-only binaries to lean-ctx.
- Turn the block-only gates (paid_go, pixel_reviewer, render-guard) into phone asks.
- Log approvals.

Sources: code.claude.com/docs/en/{hooks,permission-modes}; developers.openai.com/codex/{agent-approvals-security,config-advanced}; opencode.ai/docs/permissions; cursor.com/docs/cloud-agent/self-hosted; forum.cursor.com threads 174369, 174223, 173728, 168922, 169877.

## 4. Still running
- Local credits/limits evidence in TermFleet itself.
