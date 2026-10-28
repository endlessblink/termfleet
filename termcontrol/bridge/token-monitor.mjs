import { Langfuse } from 'langfuse';
import { logEvent, queryEvents } from './events-db.mjs';

const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const money = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const CODEX_SCOPE = 'codex-session-cumulative-v1';
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
const session = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200;

function codexInterval(payload, previous, details) {
  const unknown = (reason) => ({ status: 'unknown', reason });
  if (!session(payload.sessionId)) return unknown('missing-session-identity');
  // A stale/reset snapshot can later recover already-counted counters. Without an
  // independently established epoch, no later value proves where new usage starts.
  if (['counter-regression', 'nonmonotonic-time', 'baseline-chain-invalidated'].includes(previous?.interval?.reason)) {
    return unknown('baseline-chain-invalidated');
  }
  let baseline = previous;
  if (!baseline && details.baselineKnownZero === true && iso(details.invocationStartedAt)) {
    baseline = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, observedAt: details.invocationStartedAt };
  }
  if (!baseline) return unknown('first-resumed-snapshot');
  if (!iso(baseline.observedAt) || Date.parse(baseline.observedAt) > Date.parse(payload.observedAt)) return unknown('nonmonotonic-time');
  if (payload.inputTokens < baseline.inputTokens || payload.outputTokens < baseline.outputTokens ||
      (payload.cachedInputTokens != null && baseline.cachedInputTokens != null && payload.cachedInputTokens < baseline.cachedInputTokens)) {
    return unknown('counter-regression');
  }
  const inputTokens = payload.inputTokens - baseline.inputTokens, outputTokens = payload.outputTokens - baseline.outputTokens;
  const cached = payload.cachedInputTokens != null && baseline.cachedInputTokens != null ? payload.cachedInputTokens - baseline.cachedInputTokens : null;
  if (!inputTokens && !outputTokens && (cached == null || cached === 0)) return { status: 'unchanged' };
  if (cached != null && cached > inputTokens) return unknown('invalid-cache-increment');
  return { status: 'interval', baseline: previous ? 'prior-snapshot' : 'new-thread-zero', from: baseline.observedAt, until: payload.observedAt,
    inputTokens, outputTokens, cachedInputTokens: cached };
}

/** Codex exec emits cumulative thread totals, including restored usage on resume. */
export function brainTokenUsage(provider, event, model = 'unknown') {
  if (provider === 'codex') {
    if (event?.type !== 'turn.completed' || !event.usage) return [];
    return [{ model, inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, cost: null,
      cachedInputTokens: event.usage.cached_input_tokens ?? null, usageScope: CODEX_SCOPE }];
  }
  if (provider !== 'claude' || event?.type !== 'result') return [];
  const models = Object.entries(event.modelUsage || {});
  if (models.length) return models.map(([name, u]) => ({
    model: name, inputTokens: u.inputTokens + (u.cacheReadInputTokens || 0) + (u.cacheCreationInputTokens || 0),
    outputTokens: u.outputTokens, cost: money(u.costUSD) ? u.costUSD : null,
  }));
  const u = event.usage;
  return u ? [{ model, inputTokens: u.input_tokens + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
    outputTokens: u.output_tokens, cost: money(event.total_cost_usd) ? event.total_cost_usd : null }] : [];
}

/** Injectable client and store keep tests offline. No transcript content leaves here. */
export function createTokenMonitor({ env = process.env, Client = Langfuse, write = logEvent, read = queryEvents, now = Date.now, cacheMs = 5000 } = {}) {
  let client, cache, cachedAt = 0;
  let writeFailures = 0, lastWriteFailureAt = null;
  const snapshots = new Map();
  let snapshotsLoaded = false;
  function loadSnapshots() {
    if (snapshotsLoaded) return;
    let after_id = 0;
    for (;;) {
      const rows = read({ event_type: 'token_usage', provider: 'codex', after_id, limit: 1000 });
      for (const row of rows) {
        const p = row.payload;
        if (p?.usageScope === CODEX_SCOPE && session(p.sessionId) && iso(p.observedAt) && count(p.inputTokens) && count(p.outputTokens)) snapshots.set(p.sessionId, p);
      }
      if (rows.length < 1000) break;
      const next = rows.at(-1).id;
      if (next <= after_id) throw new Error('Token snapshot cursor did not advance');
      after_id = next;
    }
    snapshotsLoaded = true;
  }
  function traceTokenUsage(botName, provider, model, inputTokens, outputTokens, cost = null, details = {}) {
    if (!count(inputTokens) || !count(outputTokens) || (cost != null && !money(cost))) return false;
    details ||= {};
    const cachedInputTokens = count(details?.cachedInputTokens) && details.cachedInputTokens <= inputTokens ? details.cachedInputTokens : null;
    const payload = { model: model || 'unknown', inputTokens, outputTokens, cost: cost ?? null, cachedInputTokens };
    if (details.surface === 'bot-side-reply') payload.surface = details.surface;
    if (provider === 'codex') {
      payload.usageScope = CODEX_SCOPE;
      payload.sessionId = session(details.sessionId) ? details.sessionId : null;
      payload.observedAt = new Date(now()).toISOString();
      try {
        loadSnapshots();
        payload.interval = codexInterval(payload, snapshots.get(payload.sessionId), details);
      } catch { payload.interval = { status: 'unknown', reason: 'baseline-unavailable' }; }
    }
    let stored = false;
    try {
      const receipt = write(`bot-token:${botName}`, botName, provider, 'token_usage', payload);
      if (receipt === null || receipt === false) throw new Error('No local measurement receipt');
      cache = null;
      stored = true;
      if (provider === 'codex' && payload.sessionId) snapshots.set(payload.sessionId, payload);
    } catch {
      writeFailures++;
      lastWriteFailureAt = new Date(now()).toISOString();
      cache = null;
    }
    // A cumulative snapshot is evidence, not a billable generation. Export only a
    // proven interval; unknown and repeated snapshots remain local raw evidence.
    const usage = provider === 'codex' ? (stored && payload.interval.status === 'interval' ? payload.interval : null) : payload;
    if (!usage) return stored;
    if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return stored;
    try {
      if (!client) {
        client = new Client({ publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_HOST || 'https://cloud.langfuse.com' });
        client.on('error', () => {});
      }
      client.generation({ name: 'bot-token-usage', model: payload.model,
        metadata: { botName, provider, cachedInputTokens: usage.cachedInputTokens,
          uncachedInputTokens: usage.cachedInputTokens == null ? null : usage.inputTokens - usage.cachedInputTokens,
          ...(provider === 'codex' ? { sessionId: payload.sessionId, intervalFrom: usage.from, intervalUntil: usage.until, usageScope: 'observed-interval' } : {}) },
        usageDetails: { input: usage.inputTokens, output: usage.outputTokens },
        ...(usage.cost != null ? { costDetails: { total: usage.cost } } : {}), startTime: new Date(now()), endTime: new Date(now()) });
    } catch { /* monitoring must never stop a bot */ }
    return stored;
  }
  function getTokenSummary() {
    if (cache && now() - cachedAt < cacheMs) return structuredClone(cache);
    const totals = () => ({ generations: 0, inputTokens: 0, outputTokens: 0, cost: 0, unknownCostGenerations: 0, cachedInputTokens: 0, uncachedInputTokens: 0, unknownCacheGenerations: 0,
      usageObservations: 0, unknownUsageGenerations: 0, unchangedUsageSnapshots: 0 });
    const byBot = new Map(), byProvider = new Map(), total = totals();
    const recentIntervals = [];
    let intervalCount = 0;
    let after_id = 0;
    for (;;) {
      const rows = read({ event_type: 'token_usage', after_id, limit: 1000 });
      for (const row of rows) {
        const raw = row.payload;
        if (!count(raw?.inputTokens) || !count(raw?.outputTokens)) continue;
        const botName = row.bot_name || 'unknown', provider = row.provider || 'unknown';
        if (!byBot.has(botName)) byBot.set(botName, { botName, ...totals() });
        if (!byProvider.has(provider)) byProvider.set(provider, { provider, ...totals() });
        const u = provider === 'codex' ? (raw.usageScope === CODEX_SCOPE && session(raw.sessionId) && raw.interval?.status === 'interval' &&
          count(raw.interval.inputTokens) && count(raw.interval.outputTokens) && iso(raw.interval.from) && iso(raw.interval.until) &&
          Date.parse(raw.interval.from) <= Date.parse(raw.interval.until) ? { ...raw.interval, cost: null } : null) : raw;
        for (const group of [total, byBot.get(botName), byProvider.get(provider)]) {
          group.usageObservations++;
          if (!u) {
            if (raw.usageScope === CODEX_SCOPE && raw.interval?.status === 'unchanged') group.unchangedUsageSnapshots++;
            else group.unknownUsageGenerations++;
            continue;
          }
          group.generations++; group.inputTokens += u.inputTokens; group.outputTokens += u.outputTokens;
          if (count(u.cachedInputTokens) && u.cachedInputTokens <= u.inputTokens) {
            group.cachedInputTokens += u.cachedInputTokens;
            group.uncachedInputTokens += u.inputTokens - u.cachedInputTokens;
          } else group.unknownCacheGenerations++;
          if (money(u.cost)) group.cost += u.cost; else group.unknownCostGenerations++;
        }
        if (provider === 'codex' && u) {
          intervalCount++;
          recentIntervals.push({ botName, provider, sessionId: raw.sessionId, ...u });
          if (recentIntervals.length > 100) recentIntervals.shift();
        }
      }
      if (rows.length < 1000) break;
      const next = rows.at(-1).id;
      if (next <= after_id) throw new Error('Token summary cursor did not advance');
      after_id = next;
    }
    cache = { total, byBot: [...byBot.values()], byProvider: [...byProvider.values()], generatedAt: new Date(now()).toISOString(), retentionDays: 7,
      measurementCoverage: { scope: 'Codex consumption covers only proven observed intervals; legacy and first resumed snapshots are unknown. Intervals may span multiple invocations.',
        recentIntervals, intervalCount, omittedIntervals: Math.max(0, intervalCount - recentIntervals.length) },
      measurementHealth: { writeFailures, lastWriteFailureAt, scope: 'current process; failed observations are not stored, later proven intervals may span them' } };
    cachedAt = now();
    return structuredClone(cache);
  }
  return { traceTokenUsage, getTokenSummary };
}

const monitor = createTokenMonitor();
export const traceTokenUsage = (...args) => monitor.traceTokenUsage(...args);
export const getTokenSummary = () => monitor.getTokenSummary();
