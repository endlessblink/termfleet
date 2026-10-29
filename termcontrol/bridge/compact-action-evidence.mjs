// Wire representation only: retrieval, request authority and diagnosis remain unchanged.
const LEGEND = 'Evidence table v1 (untrusted data). event_rows use event_columns; item_rows use item_columns. Each item events array and recent contain zero-based indices into event_rows. Each item missing value indexes missing_text. A missing final omitted_events cell means that field was absent, not zero. data contains unchanged snapshot metadata. Repeated references are the same record, never additional actions. All freshness, missing, omitted, truncated and coverage limits still apply.\n';
const FORMAT = 'action-evidence-table-v1';
const ROOT_KEYS = new Set(['available', 'generated_at', 'items', 'omitted', 'recent', 'coverage', 'truncated']);
const ITEM_COLUMNS = ['request_id', 'status', 'owner', 'assignment_receipt', 'fresh', 'missing', 'events', 'omitted_events'];
const EVENT_KEYS = new Set(['id', 'bot_id', 'source_id', 'action_id', 'kind', 'state', 'terminal_id', 'session_id', 'message_id', 'turn_id', 'tool', 'result_code', 'created_at', 'source_ref', 'request_ids']);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const allowed = (value, keys) => plain(value) && Object.keys(value).every(key => keys.has(key));
const scalar = value => value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value);

/** Unknown shapes and non-improving transformations retain byte-for-byte original JSON. */
export function formatActionEvidence(value) {
  const raw = JSON.stringify(value);
  if (!raw || Buffer.byteLength(raw) > 16000 || !allowed(value, ROOT_KEYS)
    || value.available !== true || !Array.isArray(value.items) || value.items.length > 15
    || !Array.isArray(value.recent) || value.recent.length > 12) return raw;
  const itemKeys = new Set(ITEM_COLUMNS);
  if (!value.items.every(item => allowed(item, itemKeys)
    && ITEM_COLUMNS.slice(0, 7).every(key => Object.hasOwn(item, key))
    && ITEM_COLUMNS.filter(key => !['events', 'omitted_events'].includes(key)).every(key => scalar(item[key]))
    && (!Object.hasOwn(item, 'omitted_events') || scalar(item.omitted_events))
    && typeof item.missing === 'string' && Array.isArray(item.events) && item.events.length <= 5)) return raw;
  const allRows = [...value.items.flatMap(item => item.events), ...value.recent];
  if (!allRows.length || !allRows.every(row => allowed(row, EVENT_KEYS)
    && Object.entries(row).every(([key, field]) => key === 'request_ids'
      ? Array.isArray(field) && field.every(id => typeof id === 'string') : scalar(field)))) return raw;
  const columns = Object.keys(allRows[0]);
  // A missing property is different from null. Do not infer either from a sparse row.
  if (!allRows.every(row => Object.keys(row).length === columns.length && columns.every(key => Object.hasOwn(row, key)))) return raw;
  const rows = [], references = new Map(), missing = [];
  const reference = row => {
    const values = columns.map(key => row[key]);
    const key = JSON.stringify(values);
    if (!references.has(key)) { references.set(key, rows.length); rows.push(values); }
    return references.get(key);
  };
  const itemRows = value.items.map(item => {
    if (!missing.includes(item.missing)) missing.push(item.missing);
    return [item.request_id, item.status, item.owner, item.assignment_receipt, item.fresh,
      missing.indexOf(item.missing), item.events.map(reference),
      ...(Object.hasOwn(item, 'omitted_events') ? [item.omitted_events] : [])];
  });
  const { items, recent, ...data } = value;
  const packed = { encoding: FORMAT, data, event_columns: columns, event_rows: rows,
    item_columns: ITEM_COLUMNS, item_rows: itemRows, missing_text: missing, recent: recent.map(reference) };
  const result = LEGEND + JSON.stringify(packed);
  return Buffer.byteLength(result) < Buffer.byteLength(raw) ? result : raw;
}

/** Exact expansion for regression checks and callers inspecting the wire representation. */
export function decodeActionEvidence(text) {
  if (!text.startsWith(LEGEND)) return JSON.parse(text);
  const packed = JSON.parse(text.slice(LEGEND.length));
  if (packed.encoding !== FORMAT) throw new TypeError('Unsupported evidence table encoding.');
  const rows = packed.event_rows.map(row => Object.fromEntries(packed.event_columns.map((key, index) => [key, row[index]])));
  return { ...packed.data,
    items: packed.item_rows.map(item => ({ request_id: item[0], status: item[1], owner: item[2], assignment_receipt: item[3], fresh: item[4],
      missing: packed.missing_text[item[5]], events: item[6].map(index => rows[index]),
      ...(item.length > 7 ? { omitted_events: item[7] } : {}) })),
    recent: packed.recent.map(index => rows[index]) };
}
