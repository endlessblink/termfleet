// A confirmation covers only these bots and this exact activity snapshot.
// Callers supply current safety checks and existing close/archive operations.
import { randomBytes } from 'node:crypto';

const MAX_BOTS = 100;
const copy = value => JSON.parse(JSON.stringify(value));
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const failure = error => ({ ok: false, error });

export function createBotBatch({ snapshot, close, archive, now = Date.now, ttlMs = 120_000 }) {
  if (![snapshot, close, archive, now].every(fn => typeof fn === 'function') || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new TypeError('Batch operations and a positive confirmation lifetime are required.');
  const pending = new Map();
  const prune = () => { for (const [token, batch] of pending) if (batch.expiresAt <= now()) pending.delete(token); };
  async function inspect(id) {
    try {
      const current = await snapshot(id);
      if (!current || current.id !== id) return { id, name: id, blocked: 'That bot is no longer available.' };
      if (current.identity == null || !Array.isArray(current.plan?.items)) return { id, name: current.name || id, blocked: 'Cannot verify its current activity.' };
      const saved = copy(current);
      const blocked = saved.blocked || (saved.plan.items.some(item => item.busy) ? 'It is working or waiting for you. Close it individually after checking its work.' : null);
      return { id, name: saved.name || id, blocked, snapshot: freeze(saved), fingerprint: stable({ id: saved.id, name: saved.name, identity: saved.identity, plan: saved.plan }) };
    } catch { return { id, name: id, blocked: 'Could not check its current activity. Try again.' }; }
  }
  return {
    async preview(ids, action) {
      if (!['close', 'remove'].includes(action)) return failure('Choose close or remove.');
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BOTS || ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{12}$/.test(id))) return failure('Select between 1 and 100 existing bots.');
      prune();
      if (pending.size >= MAX_BOTS) return failure('Too many pending confirmations. Cancel one or try again shortly.');
      const bots = [];
      for (const id of new Set(ids)) bots.push(await inspect(id));
      const token = randomBytes(32).toString('hex'), expiresAt = now() + ttlMs;
      pending.set(token, { action, bots, expiresAt });
      return { ok: true, token, action, expiresAt, bots: bots.map(bot => ({ id: bot.id, name: bot.name, items: copy(bot.snapshot?.plan.items || []), blocked: bot.blocked, warning: bot.snapshot?.plan.warning || null })) };
    },
    cancel(token) { return { ok: pending.delete(token) }; },
    async execute(token, { confirmManager = false } = {}) {
      const batch = pending.get(token);
      // Consume before awaiting: duplicate clicks can never execute the same request twice.
      pending.delete(token);
      if (!batch || batch.expiresAt <= now()) return failure('This confirmation expired or was already used. Select the bots again.');
      const results = [];
      for (const saved of batch.bots) {
        let result;
        try {
          if (saved.blocked) result = failure(saved.blocked);
          else if (saved.snapshot.plan.warning && confirmManager !== true) result = failure(`Confirm that closing ${saved.name} pauses its supervision before continuing.`);
          else {
            const current = await inspect(saved.id);
            if (current.blocked) result = failure(current.blocked);
            else if (current.fingerprint !== saved.fingerprint) result = failure('Its activity changed. Check it and confirm again.');
            else {
              result = saved.snapshot.plan.items.length ? await close(saved.snapshot) : { ok: true, results: [] };
              if (result?.ok === true && batch.action === 'remove') {
                const removed = await archive(saved.snapshot);
                result = { ...removed, ...(result.results ? { results: result.results } : {}) };
              }
              if (result?.ok !== true) result = { ...result, ok: false, error: result?.error || 'It was not completed. Check its result before trying again.' };
            }
          }
        } catch (error) { result = failure(error?.message || 'It was not completed. Check before trying again.'); }
        results.push({ ...result, id: saved.id, name: saved.name });
      }
      const succeeded = results.filter(result => result.ok === true).length;
      return { ok: succeeded === results.length, action: batch.action, succeeded, failed: results.length - succeeded, results };
    },
  };
}
