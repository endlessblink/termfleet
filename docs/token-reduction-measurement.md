# Token reduction: measurement contract

Status: source verification only; actual reduction remains unverified until the reviewed build is loaded and observed.

## Concrete changes

- Persist valid completed-turn usage locally whether or not an optional Langfuse exporter is configured. No transcript content is exported.
- Preserve existing inputTokens/outputTokens/cost meanings. Codex cachedInputTokens is a subset of inputTokens and is never added to it.
- Aggregate cachedInputTokens and uncachedInputTokens only for records with a valid reported subset. unknownCacheGenerations includes legacy, missing and invalid subsets; these are not fabricated zero-cache records. Thus the two cache subtotals cover only known records, not all input when unknowns exist. Claude remains unknown in this new breakdown; its existing total semantics are unchanged.
- Expose local write failures as sanitized current-process measurementHealth counters/timestamp. They invalidate the summary cache immediately, exclude missing writes from totals, survive no process restart, and never interrupt a reply. Historical measurement gaps cannot be reconstructed from this counter.
- Export cache details as metadata only; preserve the exporter's existing input/output usage fields to avoid introducing overlapping counted quantities. No subscription allowance or billing attribution is inferred.

## Proof

Before the implementation, focused regressions failed on absent local writes without exporter keys, absent Codex cache extraction and absent cache summary coverage. The implemented10-test suite exercises fake Codex response-stream reporting, unavailable/invalid cache metadata, historical rows, local storage exceptions/negative receipts, exporter failures, pagination, summary-cache invalidation and authenticated isolated summary retrieval. No provider/model request is needed.

Command: node --test termcontrol/test/token-monitor.test.mjs

## Live comparison

1. Before cutover record the exact loaded digest, UTC interval and selected session identities using metadata only; distinguish cached subset, uncached input, output and incomplete counter coverage. Keep parent/child and diagnostic overhead separate.
2. Verify the activated digest includes completion delivery, compact evidence and token-monitor modules. Verify retained bot/terminal/conversation identity and unresolved work before releasing the automatic-action hold.
3. Use normal authorized work, not speculative model sessions, to observe one obligation per actual completion identity and a new obligation for a genuinely new turn. Repeated unchanged status must not create more turns.
4. Compare input/cache/output and automatic-wake counts over aligned intervals with model/settings and task acceptance unchanged. Report work volume, retries, user corrections, diagnostic overhead and measurement gaps. Do not call bytes saved token savings or raw input subscription quota.
5. A broken health counter, unavailable usage, unfinished task or acceptance regression makes the result partial; never claim completion from source tests alone.
