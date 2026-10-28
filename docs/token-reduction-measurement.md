# Token reduction: measurement contract

Status: the interval correction and side-response recording are live in03c236f, loaded2026-10-28T16:17:05.433Z with digest f153987f6fb41e5d72c87dec4b5a60bf038c72063d494efdcddff3ddd31f3108. Ordinary work now supplies proven observed intervals; actual reduction against a comparable baseline remains unverified.

## Concrete changes

- Persist valid completed-turn usage locally whether or not an optional Langfuse exporter is configured. No transcript content is exported.
- Preserve original raw inputTokens/outputTokens/cache snapshot values. Codex cachedInputTokens is a subset of inputTokens and is never added to it.
- Codex CLI0.164.0 emits cumulative thread usage in exec turn.completed, including restored usage on resume. Store usageScope, sessionId, observation UTC timestamp and interval provenance alongside the raw snapshot. The first resumed snapshot, missing identity, counter/time regression and unavailable baseline are unknown; never sum them as current consumption. A known new thread may start at an explicit invocation UTC timestamp with zero counters. Otherwise only a monotonic same-session snapshot pair supplies an observed interval. Unchanged snapshots add no consumption. Intervals can span multiple invocations or failed/missing observations; they are not per-invocation billing claims.
- Keep historical unscoped Codex rows intact and count them as unknownUsageGenerations, excluding them from trusted consumption totals. Do not repair them by guessing session identity from a bot name. Claude's completed-result accounting is unchanged. Summary usageObservations and unknown/unchanged counts distinguish stored evidence from measured intervals; recentIntervals retains explicit UTC endpoints and baseline provenance for the latest100 intervals, with an omitted count for earlier intervals.
- A counter or timestamp regression quarantines the session's later snapshot chain, including after monitor recreation. Recovering an earlier counter value cannot establish a new epoch: otherwise100→150→100→150 would count the same50 twice. Existing proven intervals remain; later snapshots stay unknown until a distinct session supplies an independently established baseline. A failed local write never advances the durable baseline or exports overlapping usage.
- Aggregate cachedInputTokens and uncachedInputTokens only for records with a valid reported subset. unknownCacheGenerations includes legacy, missing and invalid subsets; these are not fabricated zero-cache records. Thus the two cache subtotals cover only known records, not all input when unknowns exist. Claude remains unknown in this new breakdown; its existing total semantics are unchanged.
- Expose local write failures as sanitized current-process measurementHealth counters/timestamp. They invalidate the summary cache immediately, survive no process restart, and never interrupt a reply. Missing observations supply no standalone usage; a later proven snapshot interval can span them. Historical measurement gaps cannot be reconstructed from this counter.
- Export only proven Codex interval deltas; unknown and unchanged cumulative snapshots remain local evidence. Export cache details as metadata only to avoid overlapping counted quantities. No subscription allowance or billing attribution is inferred.

Version-specific source: [Codex0.164.0 JSON processor](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/exec/src/event_processor_with_jsonl_output.rs) copies usage.total into turn.completed; [thread usage protocol](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-protocol/src/protocol/v2/thread.rs) separates total and last; [resume replay](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/token_usage_replay.rs) restores persisted snapshots. The installed package and codex --version both report0.164.0. No model request was needed to establish this behavior.

## Proof

Before the implementation, focused regressions failed on absent local writes without exporter keys, absent Codex cache extraction and absent cache summary coverage. The implemented10-test suite exercises fake Codex response-stream reporting, unavailable/invalid cache metadata, historical rows, local storage exceptions/negative receipts, exporter failures, pagination, summary-cache invalidation and authenticated isolated summary retrieval. No provider/model request is needed.

Command: node --test termcontrol/test/token-monitor.test.mjs. Four additional cumulative-accounting regressions failed before the correction (10/14 passed): unknown resumed baseline, same-session deltas after monitor recreation/rename, missing/changed identity plus regression/unchanged observations, and known-new zero baseline with legacy rows retained. Review then exposed a replay-after-regression chain; its restart-spanning guard failed16/17 before quarantine. The fake Codex stream also verifies caller session identity/start-time wiring without inference.

## Live comparison

1. Before cutover record the exact loaded digest, UTC interval and selected session identities using metadata only; distinguish cached subset, uncached input, output and incomplete counter coverage. Keep parent/child and diagnostic overhead separate.
2. Verify the activated digest includes completion delivery, compact evidence and token-monitor modules. Verify retained bot/terminal/conversation identity and unresolved work before releasing the automatic-action hold.
3. Use normal authorized work, not speculative model sessions, to observe one obligation per actual completion identity and a new obligation for a genuinely new turn. Repeated unchanged status must not create more turns.
4. Compare input/cache/output and automatic-wake counts over aligned intervals with model/settings and task acceptance unchanged. Report work volume, retries, user corrections, diagnostic overhead and measurement gaps. Do not call bytes saved token savings or raw input subscription quota.
5. A broken health counter, unavailable usage, unfinished task or acceptance regression makes the result partial; never claim completion from source tests alone.

## Ordinary-work observation on 2026-10-28

The bounded metadata-only observer started15:31:28.092UTC. At15:57:45.710UTC the authenticated summary reported four proven intervals:1,495,297 input tokens,1,433,728 cached input,61,569 uncached input and4,153 output. Current-process write failures were zero. Thirteen other observations remained unknown, including ten historical unscoped rows; they are excluded, not zero consumption. Cost is unknown for all four intervals.

The explicit UTC endpoints were15:44:37.877–15:55:17.472 and15:55:17.472–15:57:25.575 for one resumed thread, and15:54:05.461–15:56:14.792 plus15:56:14.792–15:57:13.459 for a separate new thread. The first new-thread interval has an explicit invocation zero baseline; the others use prior monotonic snapshots. Bot rename between the two new-thread observations did not duplicate the baseline. These are two independent timelines, not one shared wall-clock interval.

One exact helper completion identity had one delivered obligation. Distinct subsequent completion eligibility still needs ordinary live observation. The observer made no provider requests and sent no user messages. These measurements prove recorder coverage and reported cache subsets, not lower consumption, subscription allowance, billing or comprehension parity.

At the final16:17UTC activation there were eight proven intervals,10,829,245 input tokens including10,574,592 cached and254,653 uncached, plus24,710 output. Twenty-four observations include sixteen unknown records, and interval cost remains unknown. The retained recentIntervals metadata records every UTC pair; the newest recorded endpoint was16:09:31.950UTC. These values include ordinary work across independent threads, not one bot turn or subscription quota.

The next coverage check is a naturally occurring side response. Its subprocess now records only emitted usage on close, including failure/timeout, with surface bot-side-reply. No missing usage is estimated, no prompt content is exported, and no provider call was created for acceptance. The exact integrated source passed101 affected tests including fake side subprocesses and isolated headless chat/server checks. Both conservative bridge activations preserved daemon2068834, exact terminal/conversation identities and original chat prefixes; only owned holds were released. Sixteen unknown observations are not repaired from this code change.

## Latest activation and observation — 2026-10-28T16:37UTC

Reviewed e20f8aa is live at16:36:53.011UTC, PID3090042, digest f5c1e6b422606ec5beb4b724ef79ebf8db213c5e4d11781c181c15fefde10ca5. Affected106/106 pass; original daemon2068834, five terminal identity triples, conversations and chat prefixes retained; owned hold released, admission unpaused with no retained outcomes. No model trial.

Readback16:36:54.304UTC contains ten proven intervals:13,943,624 input,13,641,344 cached subset,302,280 uncached input and30,561 output. Sixteen of26 observations remain unknown and excluded; current-process write failures0, cost unknown. Two newly recorded session-specific UTC pairs are15:43:48.852–16:27:50.128 and16:09:31.950–16:31:25.314. Ordinary side-surface coverage remains unobserved as of16:36:45.842UTC; existing bounded numeric observer continues without inference. These totals establish coverage, not comparative savings.

Installed question access16:37:11.313UTC passed eight exact navigation targets at430/1400 widths, including a card buried beneath307 later messages. All eight ambiguous questions remain visible, with explicit resolution controls; no server writes or model requests were allowed. Navigation proof does not resolve their unanswered status.
