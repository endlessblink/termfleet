// Shared rooms: several agents and the operator in one conversation.
// A message goes to the members it @-mentions (every member when it mentions
// nobody). Each agent's next finished answer is posted back to the room, and an
// answer that @-mentions another member is passed on to it, a few hops at most,
// so agents can talk to each other without looping forever.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const MAX_HOPS = 3;
export const REPLY_TIMEOUT_MS = 30 * 60 * 1000;
const SETTLE_MS = 6000;
const HISTORY_FOR_AGENT = 6;

const defaultFile = () => path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'rooms.json');

/** A short, typeable name for a member: "@termfleet", "@bina-codex". */
export function handleFor(pane, taken = new Set()) {
  const base = String(pane.title || pane.name || pane.project || pane.provider || 'agent')
    .toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'agent';
  const choices = [base, `${base}-${pane.provider}`];
  for (let n = 2; ; n++) {
    const handle = choices.shift() || `${base}-${n}`;
    if (!taken.has(handle)) return handle;
  }
}

/** Members named in the text, as `@handle`. */
export function mentionedMembers(room, text) {
  const found = new Set();
  for (const match of String(text || '').matchAll(/@([\p{L}\p{N}][\p{L}\p{N}-]*)/gu)) {
    const handle = match[1].toLowerCase().replace(/-+$/, '');
    const member = room.members.find((m) => m.handle === handle);
    if (member) found.add(member.pane);
  }
  return [...found];
}

const words = (text) => new Set((String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []));

/**
 * TF-096 part 6 (Grok Bot's groups): a message without an @ goes to the member
 * whose name or job fits it best. When nothing clearly fits, every member is asked
 * but told to answer only if it is theirs, and to reply PASS otherwise.
 */
export function pickResponder(room, text) {
  const asked = words(text);
  const scored = room.members.map((m) => {
    const about = words(`${m.label || ''} ${m.handle || ''} ${m.job || ''} ${m.project || ''}`);
    let score = 0;
    for (const w of asked) if (about.has(w)) score += 1;
    return { member: m, score };
  }).sort((a, b) => b.score - a.score);
  if (scored.length && scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) return [scored[0].member.pane];
  return null;
}

export const PASS = /^\s*PASS\.?\s*$/i;

/** What an agent receives: who is in the room, the recent talk, the new message. */
export function messageForAgent(room, member, message) {
  const others = room.members.filter((m) => m.pane !== member.pane).map((m) => `@${m.handle}`).join(', ') || 'nobody else yet';
  const earlier = room.messages.filter((m) => m.seq < message.seq).slice(-HISTORY_FOR_AGENT)
    .map((m) => `${m.author}: ${clip(m.text, 600)}`).join('\n');
  return [
    `[Room "${room.name}" — a group chat with the operator and other agents. You are @${member.handle}. Others: ${others}.]`,
    earlier ? `Recent room messages:\n${earlier}\n` : '',
    `${message.author}: ${message.text}`,
    '',
    'Your final answer will be posted to the room. To ask another agent, mention them with their @name. Only answer what concerns you.',
    message.everyone ? 'This message was not addressed to anyone. If it is not about your job, or another member fits it better, reply with exactly: PASS' : '',
  ].filter((line) => line !== '').join('\n');
}

function clip(text, max) {
  const s = String(text || '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

export class Rooms {
  constructor({ file = defaultFile(), send, readFeed, now = () => Date.now() } = {}) {
    this.file = file;
    this.send = send;           // (pane, text) => {ok|error}
    this.readFeed = readFeed;   // (pane) => {events}
    this.now = now;
    this.data = this.load();
  }

  load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { rooms: [] }; }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list() {
    return this.data.rooms.map((room) => {
      const last = room.messages.at(-1);
      return { id: room.id, name: room.name, members: room.members, last: last ? { author: last.author, text: clip(last.text, 140), at: last.at } : null,
        waiting: room.pending.length };
    });
  }

  get(id) {
    return this.data.rooms.find((room) => room.id === id) || null;
  }

  create(name, panes) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) return { error: 'Give the room a name.' };
    if (!panes.length) return { error: 'Pick at least one agent.' };
    const taken = new Set();
    const members = panes.map((pane) => {
      const handle = handleFor(pane, taken);
      taken.add(handle);
      return { pane: pane.id, handle, label: pane.title || pane.name || pane.project || handle, provider: pane.provider, job: pane.job || pane.profile?.job || '', project: pane.project || '' };
    });
    const room = { id: crypto.randomBytes(6).toString('hex'), name: clean, createdAt: this.now(), members, messages: [], pending: [], seq: 0 };
    this.data.rooms.push(room);
    this.save();
    return { ok: true, room };
  }

  remove(id) {
    const before = this.data.rooms.length;
    this.data.rooms = this.data.rooms.filter((room) => room.id !== id);
    if (this.data.rooms.length === before) return { error: 'That room no longer exists.' };
    this.save();
    return { ok: true };
  }

  addMessage(room, entry) {
    const message = { seq: ++room.seq, at: this.now(), ...entry };
    room.messages.push(message);
    if (room.messages.length > 500) room.messages.splice(0, room.messages.length - 500);
    return message;
  }

  /** The operator writes in the room. */
  async post(id, text, livePanes) {
    const room = this.get(id);
    if (!room) return { error: 'That room no longer exists.' };
    const body = String(text || '').trim();
    if (!body) return { error: 'Write a message first.' };
    const tagged = mentionedMembers(room, body);
    const chosen = tagged.length ? null : pickResponder(room, body);
    const message = this.addMessage(room, { author: 'You', from: 'operator', text: body, tagged, everyone: !tagged.length && !chosen });
    const targets = tagged.length ? tagged : chosen || room.members.map((m) => m.pane);
    const delivered = await this.deliver(room, message, targets, livePanes, 0);
    this.save();
    return { ok: true, message, delivered };
  }

  async deliver(room, message, targets, livePanes, hops) {
    const results = [];
    for (const paneId of targets) {
      const member = room.members.find((m) => m.pane === paneId);
      const pane = livePanes.find((p) => p.id === paneId);
      if (!member) continue;
      if (!pane) {
        this.addMessage(room, { author: 'Room', from: 'system', text: `@${member.handle} is closed, so it did not get this.` });
        results.push({ pane: paneId, ok: false });
        continue;
      }
      // An agent already asked to answer gets the newer message as well; its
      // next finished answer covers both.
      const since = this.now();
      let result;
      try { result = await this.send(pane, messageForAgent(room, member, message)); } catch (error) { result = { error: error.message }; }
      if (result?.error) {
        this.addMessage(room, { author: 'Room', from: 'system', text: `Could not reach @${member.handle}: ${result.error}` });
        results.push({ pane: paneId, ok: false });
        continue;
      }
      room.pending = room.pending.filter((p) => p.pane !== paneId);
      room.pending.push({ pane: paneId, since, seq: message.seq, hops });
      results.push({ pane: paneId, ok: true });
    }
    return results;
  }

  /**
   * Look for finished answers. An answer counts once the agent has stopped
   * working, its newest reply came after the room message, and nothing has
   * changed for a few seconds.
   */
  async poll(livePanes) {
    let changed = false;
    for (const room of this.data.rooms) {
      for (const wait of [...room.pending]) {
        const member = room.members.find((m) => m.pane === wait.pane);
        const pane = livePanes.find((p) => p.id === wait.pane);
        const drop = () => { room.pending = room.pending.filter((p) => p !== wait); changed = true; };
        if (!member || !pane) { drop(); continue; }
        if (this.now() - wait.since > REPLY_TIMEOUT_MS) {
          drop();
          this.addMessage(room, { author: 'Room', from: 'system', text: `@${member.handle} did not answer within 30 minutes.` });
          continue;
        }
        const busy = pane.producing || pane.turn === 'working' || pane.live === 'producing' || pane.live === 'working';
        if (busy) { wait.quietSince = null; continue; }
        let events = [];
        try { events = this.readFeed(pane)?.events || []; } catch { continue; }
        const after = events.filter((e) => toMs(e.at) >= wait.since - 2000);
        const replies = after.filter((e) => e.kind === 'assistant' && String(e.text || '').trim());
        if (!replies.length) continue;
        const latest = replies.at(-1);
        // The agent may still be mid-turn between two messages.
        if (after.at(-1) !== latest && after.at(-1)?.kind !== 'assistant') continue;
        const mark = `${latest.at}|${latest.text.length}`;
        if (wait.mark !== mark) { wait.mark = mark; wait.quietSince = this.now(); changed = true; continue; }
        if (this.now() - (wait.quietSince || this.now()) < SETTLE_MS) continue;
        drop();
        if (PASS.test(latest.text)) continue;   // not theirs: stays quiet in the room
        const answer = this.addMessage(room, { author: `@${member.handle}`, from: member.pane, text: latest.text });
        const next = mentionedMembers(room, latest.text).filter((id) => id !== member.pane);
        answer.tagged = next;
        if (next.length && wait.hops + 1 < MAX_HOPS) await this.deliver(room, answer, next, livePanes, wait.hops + 1);
        else if (next.length) this.addMessage(room, { author: 'Room', from: 'system', text: 'The agents have passed this back and forth enough. Reply to continue.' });
      }
    }
    if (changed) this.save();
    return changed;
  }
}

function toMs(at) {
  if (typeof at === 'number') return at;
  const ms = Date.parse(at || '');
  return Number.isFinite(ms) ? ms : 0;
}
