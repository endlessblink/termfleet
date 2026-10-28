import { Langfuse } from 'langfuse';
import { logEvent, queryEvents } from './events-db.mjs';

const count = (value) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const money = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Read completed-turn totals, never assistant chunks which would double count. */
export function brainTokenUsage(provider, event, model = 'unknown') {
  if (provider === 'codex') {
    if (event?.type !== 'turn.completed' || !event.usage) return [];
    return [{ model, inputTokens: event.usage.input_tokens, outputTokens: event.usage.output_tokens, cost: null, cachedInputTokens: event.usage.cached_input_tokens ?? null }];
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
  function traceTokenUsage(botName, provider, model, inputTokens, outputTokens, cost = null, details = {}) {
    if (!count(inputTokens) || !count(outputTokens) || (cost != null && !money(cost))) return false;
    const cachedInputTokens = count(details?.cachedInputTokens) && details.cachedInputTokens <= inputTokens ? details.cachedInputTokens : null;
    const payload = { model: model || 'unknown', inputTokens, outputTokens, cost: cost ?? null, cachedInputTokens };
    let stored = false;
    try {
      const receipt = write(`bot-token:${botName}`, botName, provider, 'token_usage', payload);
      if (receipt === null || receipt === false) throw new Error('No local measurement receipt');
      cache = null;
      stored = true;
    } catch {
      writeFailures++;
      lastWriteFailureAt = new Date(now()).toISOString();
      cache = null;
    }
    if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) return stored;
    try {
      if (!client) {
        client = new Client({ publicKey: env.LANGFUSE_PUBLIC_KEY, secretKey: env.LANGFUSE_SECRET_KEY,
          baseUrl: env.LANGFUSE_HOST || 'https://cloud.langfuse.com' });
        client.on('error', () => {});
      }
      client.generation({ name: 'bot-token-usage', model: payload.model,
        metadata: { botName, provider, cachedInputTokens, uncachedInputTokens: cachedInputTokens == null ? null : inputTokens - cachedInputTokens }, usageDetails: { input: inputTokens, output: outputTokens },
        ...(cost != null ? { costDetails: { total: cost } } : {}), startTime: new Date(now()), endTime: new Date(now()) });
    } catch { /* monitoring must never stop a bot */ }
    return stored;
  }
  function getTokenSummary() {
    if (cache && now() - cachedAt < cacheMs) return structuredClone(cache);
    const totals = () => ({ generations: 0, inputTokens: 0, outputTokens: 0, cost: 0, unknownCostGenerations: 0, cachedInputTokens: 0, uncachedInputTokens: 0, unknownCacheGenerations: 0 });
    const byBot = new Map(), byProvider = new Map(), total = totals();
    let after_id = 0;
    for (;;) {
      const rows = read({ event_type: 'token_usage', after_id, limit: 1000 });
      for (const row of rows) {
        const u = row.payload;
        if (!count(u?.inputTokens) || !count(u?.outputTokens)) continue;
        const botName = row.bot_name || 'unknown', provider = row.provider || 'unknown';
        if (!byBot.has(botName)) byBot.set(botName, { botName, ...totals() });
        if (!byProvider.has(provider)) byProvider.set(provider, { provider, ...totals() });
        for (const group of [total, byBot.get(botName), byProvider.get(provider)]) {
          group.generations++; group.inputTokens += u.inputTokens; group.outputTokens += u.outputTokens;
          if (count(u.cachedInputTokens) && u.cachedInputTokens <= u.inputTokens) {
            group.cachedInputTokens += u.cachedInputTokens;
            group.uncachedInputTokens += u.inputTokens - u.cachedInputTokens;
          } else group.unknownCacheGenerations++;
          if (money(u.cost)) group.cost += u.cost; else group.unknownCostGenerations++;
        }
      }
      if (rows.length < 1000) break;
      const next = rows.at(-1).id;
      if (next <= after_id) throw new Error('Token summary cursor did not advance');
      after_id = next;
    }
    cache = { total, byBot: [...byBot.values()], byProvider: [...byProvider.values()], generatedAt: new Date(now()).toISOString(), retentionDays: 7, measurementHealth: { writeFailures, lastWriteFailureAt, scope: 'current process; failed writes are excluded from totals' } };
    cachedAt = now();
    return structuredClone(cache);
  }
  return { traceTokenUsage, getTokenSummary };
}

const monitor = createTokenMonitor();
export const traceTokenUsage = (...args) => monitor.traceTokenUsage(...args);
export const getTokenSummary = () => monitor.getTokenSummary();
