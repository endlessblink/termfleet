import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * Sidebar folders and the Archive (Noam 2026-10-24, R-7369/R-7385/R-7387: "תיקיות לtermcontrol
 * sidebar", "7 days", quiet chats go to "תיקייה ברורה ... לחלק לקטגוריות"). Kept per owner on the
 * bridge, like Last used, so the phone and the PC show the same folders.
 *
 * Which chat is archived is decided by the app from live facts (its last activity, whether it
 * waits for Noam, whether an answer is unread); this store holds only his choices: folders,
 * folder membership, archive categories, "bring back" marks and the number of quiet days.
 */
const file = path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'list-folders.json');
export const ARCHIVE_DAYS = [0, 7, 14, 30];
const empty = () => ({ folders: [], members: {}, archiveCats: [], archiveCat: {}, keepActive: {}, archiveDays: 7 });
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const newId = (prefix) => `${prefix}-${randomBytes(4).toString('hex')}`;
const paneId = (v) => { const s = String(v ?? ''); if (!s || s.length > 300) throw new Error('Which conversation?'); return s; };

function nameOf(raw, taken, what) {
  const n = clean(raw);
  if (!n) throw new Error(`Give the ${what} a name.`);
  if (n.length > 48) throw new Error(`Keep the ${what} name under 48 characters.`);
  if (taken.some((t) => t.toLowerCase() === n.toLowerCase())) throw new Error(`There is already a ${what} called "${n}".`);
  return n;
}

export class ListFolders {
  constructor(location = file) { this.file = location; }

  readAll() {
    try { const all = JSON.parse(fs.readFileSync(this.file, 'utf8')); return all && typeof all === 'object' && !Array.isArray(all) ? all : {}; } catch { return {}; }
  }

  read(owner) {
    const s = { ...empty(), ...(this.readAll()[owner] || {}) };
    s.archiveDays = ARCHIVE_DAYS.includes(Number(s.archiveDays)) ? Number(s.archiveDays) : 7;
    return s;
  }

  write(owner, state) {
    const all = this.readAll();
    all[owner] = state;
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return state;
  }

  /** One change from the app. Returns the owner's whole state; throws a plain sentence on a bad request. */
  apply(owner, body = {}, now = Date.now()) {
    const s = this.read(owner);
    const folder = (id) => { const f = s.folders.find((x) => x.id === id); if (!f) throw new Error('That folder no longer exists.'); return f; };
    switch (body.op) {
      case 'create': {
        const f = { id: newId('f'), name: nameOf(body.name, s.folders.map((x) => x.name), 'folder'), collapsed: false, hidden: false };
        s.folders.push(f);
        if (body.pane) s.members[paneId(body.pane)] = f.id;
        break;
      }
      case 'rename': { const f = folder(body.id); f.name = nameOf(body.name, s.folders.filter((x) => x !== f).map((x) => x.name), 'folder'); break; }
      case 'remove': {
        folder(body.id);
        s.folders = s.folders.filter((x) => x.id !== body.id);
        for (const [p, f] of Object.entries(s.members)) if (f === body.id) delete s.members[p];
        break;
      }
      case 'order': {
        const f = folder(body.id), at = s.folders.indexOf(f), to = at + (body.direction === 'up' ? -1 : 1);
        if (to >= 0 && to < s.folders.length) { s.folders.splice(at, 1); s.folders.splice(to, 0, f); }
        break;
      }
      case 'collapse': folder(body.id).collapsed = Boolean(body.collapsed); break;
      case 'hide': folder(body.id).hidden = Boolean(body.hidden); break;
      case 'move': {
        const p = paneId(body.pane);
        if (body.folder) { folder(body.folder); s.members[p] = body.folder; } else delete s.members[p];
        break;
      }
      case 'catCreate': {
        const c = { id: newId('c'), name: nameOf(body.name, s.archiveCats.map((x) => x.name), 'category') };
        s.archiveCats.push(c);
        if (body.pane) s.archiveCat[paneId(body.pane)] = c.id;
        break;
      }
      case 'catRemove': {
        s.archiveCats = s.archiveCats.filter((c) => c.id !== body.id);
        for (const [p, c] of Object.entries(s.archiveCat)) if (c === body.id) delete s.archiveCat[p];
        break;
      }
      case 'sortCat': {
        const p = paneId(body.pane);
        if (body.cat) { if (!s.archiveCats.some((c) => c.id === body.cat)) throw new Error('That category no longer exists.'); s.archiveCat[p] = body.cat; } else delete s.archiveCat[p];
        break;
      }
      // "Bring back": counts as activity now, so it leaves the Archive until it is quiet again.
      case 'bringBack': s.keepActive[paneId(body.pane)] = now; break;
      case 'days': {
        const d = Number(body.days);
        if (!ARCHIVE_DAYS.includes(d)) throw new Error('Choose 7, 14 or 30 days, or never.');
        s.archiveDays = d;
        break;
      }
      default: throw new Error('Unknown folder change.');
    }
    return this.write(owner, s);
  }
}

export const listFolders = new ListFolders();

/**
 * Is this conversation in the Archive? Quiet for the chosen number of days (its last activity:
 * the agent's last report or the owner opening it, or a "bring back"), and never when it waits
 * for Noam, has an unread answer, is working, or its activity date is unknown.
 */
export function isArchived(p, state, { now = Date.now(), unread = false, open = false } = {}) {
  const days = Number(state?.archiveDays ?? 7);
  if (!days || open || unread) return false;
  if (p.turn === 'waiting' || p.attention || p.turn === 'working' || p.producing) return false;
  const last = Math.max(Number(p.lastActiveAt) || 0, Number(p.lastUsedAt) || 0, Number(state?.keepActive?.[p.id]) || 0);
  if (!last) return false;
  return now - last >= days * 86400_000;
}
