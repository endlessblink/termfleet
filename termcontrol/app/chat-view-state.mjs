// Local presentation preferences only: no bot activity or owner answer changes.
const CLOSED_GROUPS = 'termcontrol.closed-chat-groups.v1';
const DISMISSED_STATUS = 'termcontrol.dismissed-attention.v1';
const validId = id => typeof id === 'string' && /^[0-9a-f]{12}$/.test(id);
function requireId(id) { if (!validId(id)) throw new TypeError('Unknown chat identity.'); }
function stored(storage, key, fallback) {
  const raw = storage.getItem(key);
  try { return JSON.parse(raw) ?? fallback; } catch { return fallback; }
}
function read(storage, key, fallback) {
  try { return stored(storage, key, fallback); } catch { return fallback; }
}
function write(storage, key, value) { storage.setItem(key, JSON.stringify(value)); }
function statusMap(storage, strict = false) {
  const value = (strict ? stored : read)(storage, DISMISSED_STATUS, {});
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([id, key]) => validId(id) && typeof key === 'string' && key.length)) : {};
}
function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
export function closedChatGroups(storage) {
  const saved = read(storage, CLOSED_GROUPS, []);
  return Array.isArray(saved) ? [...new Set(saved.filter(validId))] : [];
}
export function setChatGroupClosed(storage, id, closed) {
  requireId(id);
  if (typeof closed !== 'boolean') throw new TypeError('Choose whether to close the chat.');
  const saved = stored(storage, CLOSED_GROUPS, []);
  const ids = new Set(Array.isArray(saved) ? saved.filter(validId) : []);
  if (closed) ids.add(id); else ids.delete(id);
  write(storage, CLOSED_GROUPS, [...ids]);
  return true;
}
export function attentionStatusKey(bot, attention) {
  if (!bot || !validId(bot.id) || attention?.kind !== 'status') return null;
  try {
    // JSON restricts the fingerprint to serializable presentation data. Top-level
    // bot activity, unread counts and last activity never affect dismissal.
    const value = JSON.parse(JSON.stringify({ id: bot.id, helperDelivery: bot.helperDelivery ?? null,
      label: attention.label, text: attention.text, details: attention.details }));
    return stable(value);
  } catch { return null; }
}
export function dismissedAttention(storage, id, key) {
  return validId(id) && typeof key === 'string' && key.length > 0 && statusMap(storage)[id] === key;
}
export function dismissAttention(storage, id, key) {
  requireId(id);
  if (typeof key !== 'string' || !key.length) throw new TypeError('Only a current status can be dismissed.');
  write(storage, DISMISSED_STATUS, { ...statusMap(storage, true), [id]: key });
  return true;
}
export function resetDismissedAttention(storage, id) {
  requireId(id);
  const saved = statusMap(storage, true);
  delete saved[id];
  if (Object.keys(saved).length) write(storage, DISMISSED_STATUS, saved);
  else storage.removeItem(DISMISSED_STATUS);
}
