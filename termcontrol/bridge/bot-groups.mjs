import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Group chats of bots (Noam 2026-10-21: "למה שבעצם לא יהיו 2 האופציות? סוכן מנהל + קבוצה").
 * A group is a name, its member bots and one shared chat. A bot answers in it only when
 * Noam tags it (@name, or @all); bots never write to a group or to each other on their own.
 * The routing lives in Bots (sendGroup / ask); this is only the store.
 */
export const GROUP_LIMITS = { name: 60, members: 12 };
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const newId = () => crypto.randomBytes(6).toString('hex');

export class BotGroups {
  constructor({ dir, now = () => Date.now(), botExists = () => true } = {}) {
    this.dir = dir;
    this.now = now;
    this.botExists = botExists;
  }

  folder(id) {
    if (!/^[0-9a-f]{12}$/.test(String(id))) throw new Error('Unknown group.');
    return path.join(this.dir, id);
  }

  read(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.folder(id), 'group.json'), 'utf8')); } catch { return null; }
  }

  write(group) {
    const dir = this.folder(group.id);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `group.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(group, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, 'group.json'));
  }

  messages(id) {
    try {
      return fs.readFileSync(path.join(this.folder(id), 'chat.jsonl'), 'utf8').split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch { return []; }
  }

  append(id, message) {
    if (!this.read(id)) return null;
    const entry = { id: newId(), at: this.now(), ...message };
    fs.appendFileSync(path.join(this.folder(id), 'chat.jsonl'), JSON.stringify(entry) + '\n', { mode: 0o600 });
    return entry;
  }

  members(list) {
    return [...new Set((Array.isArray(list) ? list : []).map(String))].filter((m) => /^[0-9a-f]{12}$/.test(m) && this.botExists(m)).slice(0, GROUP_LIMITS.members);
  }

  list() {
    let ids = [];
    try { ids = fs.readdirSync(this.dir).filter((d) => /^[0-9a-f]{12}$/.test(d)); } catch { return []; }
    return ids.map((id) => {
      const g = this.read(id);
      if (!g) return null;
      const last = this.messages(id).filter((m) => m.role !== 'system').pop();
      return { id, name: g.name, members: g.members, createdAt: g.createdAt, lastAt: last?.at || g.createdAt, last: last ? { role: last.role, who: last.guest?.name || null, text: String(last.text || '').slice(0, 160) } : null };
    }).filter(Boolean).sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0));
  }

  create({ name, members } = {}) {
    const n = clean(name, GROUP_LIMITS.name).replace(/\s+/g, ' ');
    if (!n) return { error: 'Give the group a name.' };
    const m = this.members(members);
    if (!m.length) return { error: 'Pick at least one bot.' };
    const group = { id: newId(), name: n, members: m, createdAt: this.now() };
    this.write(group);
    this.append(group.id, { role: 'system', text: `${n} was created.` });
    return { ok: true, group };
  }

  update(id, patch = {}) {
    const group = this.read(id);
    if (!group) return { error: 'That group no longer exists.' };
    if ('name' in patch) {
      const n = clean(patch.name, GROUP_LIMITS.name).replace(/\s+/g, ' ');
      if (!n) return { error: 'Give the group a name.' };
      group.name = n;
    }
    if ('members' in patch) {
      const m = this.members(patch.members);
      if (!m.length) return { error: 'A group needs at least one bot.' };
      group.members = m;
    }
    this.write(group);
    return { ok: true, group };
  }

  /** Off the list without losing the chat: the folder moves to archived/. */
  remove(id) {
    if (!this.read(id)) return { error: 'That group no longer exists.' };
    const shelf = path.join(this.dir, 'archived');
    fs.mkdirSync(shelf, { recursive: true, mode: 0o700 });
    fs.renameSync(this.folder(id), path.join(shelf, `${id}-${this.now()}`));
    return { ok: true };
  }
}
