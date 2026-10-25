import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/**
 * Noam's requests, kept as Obsidian notes (Agent-Manager 2026-10-25; Noam: "אז תעשה את זה").
 * When an item is marked ready or done, its note is written (or rewritten) under
 * MAIN VULT/TermFleet/Requests: his exact words, what was done, the evidence, the status and
 * the dates. One note per item id, so later marks update it instead of adding copies.
 *
 * Only the live ledger writes to the vault. A test or copy that points the ledger elsewhere
 * (TERMFLEET_REQ_DIR, TC_CONFIG_DIR) writes nothing unless TERMFLEET_REQUEST_DOCS_DIR says where.
 */

export const VAULT_REQUESTS = path.join(os.homedir(), 'home-data', 'app-data', 'sync', 'Dropbox', 'OBSIDIAN_SYNCED', 'MAIN VULT', 'TermFleet', 'Requests');

export function requestDocsDir(env = process.env) {
  if (env.TERMFLEET_REQUEST_DOCS_DIR) return env.TERMFLEET_REQUEST_DOCS_DIR;
  if (env.TERMFLEET_REQ_DIR || env.TC_CONFIG_DIR) return null;
  return VAULT_REQUESTS;
}

const day = (ms) => { const d = new Date(Number(ms) || 0); return Number.isFinite(d.getTime()) && ms ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : ''; };
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const yamlText = (s) => JSON.stringify(oneLine(s));

/** A file name Obsidian and every OS accept: the id, then his first words. */
export function docName(item) {
  const words = oneLine(item.words).replace(/[\\/:*?"<>|#^[\]]/g, '').slice(0, 60).replace(/[.\s]+$/, '').trim();
  return `${item.id}${words ? ` - ${words}` : ''}.md`;
}

/** Evidence as clickable lines: URLs as they are, existing files as file links. */
function evidenceLines(evidence) {
  const list = (Array.isArray(evidence) ? evidence : [evidence]).filter(Boolean);
  return list.map((e) => {
    const text = typeof e === 'string' ? e : (e.what || e.text || e.evidence || JSON.stringify(e));
    const when = typeof e === 'object' && e.at ? ` _(${day(e.at)})_` : '';
    const linked = String(text)
      .replace(/(^|\s)((?:~|\/)[^\s)]+)/g, (m, lead, p) => {
        const abs = p.replace(/^~(?=\/)/, os.homedir());
        return fs.existsSync(abs) ? `${lead}[${path.basename(abs)}](<file://${abs}>)` : m;
      });
    return `- ${linked}${when}`;
  });
}

export function renderRequestDoc(item, { now = Date.now() } = {}) {
  const evidence = item.evidence?.length ? item.evidence : [];
  const did = oneLine(item.note);
  return [
    '---',
    `request: ${item.id}`,
    `status: ${item.status}`,
    `project: ${yamlText(item.project || '')}`,
    ...(item.topics?.length ? [`topics: [${item.topics.map(yamlText).join(', ')}]`] : []),
    `asked: ${yamlText(day(item.at))}`,
    `marked: ${yamlText(day(item.statusAt || now))}`,
    `updated: ${yamlText(day(now))}`,
    ...(item.source ? [`source: ${yamlText(item.source)}`] : []),
    'tags: [termfleet/request]',
    '---',
    '',
    `# ${item.id}: ${oneLine(item.words).slice(0, 80)}`,
    '',
    '## Noam\'s words',
    '',
    ...String(item.words || '').split('\n').map((l) => `> ${l}`),
    '',
    '## What was done',
    '',
    did || '_No description was given with the mark._',
    '',
    '## Evidence',
    '',
    ...(evidence.length ? evidenceLines(evidence) : ['_None attached._']),
    '',
    '## Status',
    '',
    `**${item.status}**${item.statusAt ? ` since ${day(item.statusAt)}` : ''}${item.locked ? ' · locked: Noam confirmed it works' : ''}`,
    ...(item.assigned?.length ? ['', `Worked on in: ${item.assigned.map((a) => `${a.pane}${a.at ? ` (${day(a.at)})` : ''}`).join(', ')}`] : []),
    '',
  ].join('\n');
}

/** Writes the item's note; returns its path, or null when docs are off for this ledger. */
export function writeRequestDoc(item, { dir = requestDocsDir(), now = Date.now() } = {}) {
  if (!dir || !item?.id) return null;
  fs.mkdirSync(dir, { recursive: true });
  // The same id keeps one note even if an older one was named from different words.
  for (const f of fs.readdirSync(dir)) if ((f === `${item.id}.md` || f.startsWith(`${item.id} - `)) && f !== docName(item)) fs.renameSync(path.join(dir, f), path.join(dir, docName(item)));
  const file = path.join(dir, docName(item));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, renderRequestDoc(item, { now }));
  fs.renameSync(tmp, file);
  return file;
}
