// Scheduled messages ("routines"): a message the bridge sends to an agent on the
// chosen days at the chosen time, through the same path as a typed phone message.
// A due routine for a busy agent waits until it is free (never doubled, never
// typed into a running turn); one that cannot run within two hours is marked missed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const LATE_LIMIT_MS = 2 * 60 * 60 * 1000;
const defaultFile = () => path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'routines.json');

/** Next local time at or after `from` that falls on one of `days` (0=Sunday) at "HH:MM". */
export function nextRunAt(days, time, from = Date.now()) {
  const [hours, minutes] = String(time).split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || !days?.length) return null;
  const at = new Date(from);
  at.setSeconds(0, 0);
  at.setHours(hours, minutes);
  for (let i = 0; i < 8; i++) {
    if (days.includes(at.getDay()) && at.getTime() >= from) return at.getTime();
    at.setDate(at.getDate() + 1);
    at.setHours(hours, minutes, 0, 0);
  }
  return null;
}

export function describeDays(days) {
  const sorted = [...new Set(days)].sort();
  if (sorted.length === 7) return 'Every day';
  if (sorted.join() === '0,1,2,3,4') return 'Sun–Thu';
  if (sorted.join() === '1,2,3,4,5') return 'Mon–Fri';
  return sorted.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ');
}

export class Routines {
  constructor({ file = defaultFile(), send, now = () => Date.now() } = {}) {
    this.file = file;
    this.send = send;
    this.now = now;
    this.mtime = null;
    this.data = { routines: [] };
    this.load();
  }

  /**
   * Agents create their own schedules from the command line (TF-096, the way a
   * Grok Bot sets up a routine when asked), so the file can change under the
   * bridge. Re-read it whenever it changed, before every read or write.
   */
  load() {
    let mtime = null;
    try { mtime = fs.statSync(this.file).mtimeMs; } catch { /* no file yet */ }
    if (mtime === this.mtime) return;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.data = { routines: [] }; }
    if (!Array.isArray(this.data.routines)) this.data.routines = [];
    this.mtime = mtime;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try { this.mtime = fs.statSync(this.file).mtimeMs; } catch { this.mtime = null; }
  }

  forPane(paneId) {
    this.load();
    return this.data.routines.filter((r) => r.pane === paneId);
  }

  create({ pane, text, days, time, createdBy = null }) {
    this.load();
    const body = String(text || '').trim();
    const cleanDays = [...new Set((days || []).map(Number).filter((d) => d >= 0 && d <= 6))];
    if (!body) return { error: 'Write the message to send.' };
    if (body.length > 20_000) return { error: 'That message is too long for a schedule.' };
    if (!cleanDays.length) return { error: 'Pick at least one day.' };
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time))) return { error: 'Pick a time.' };
    const routine = { id: crypto.randomBytes(5).toString('hex'), pane, text: body, days: cleanDays, time, enabled: true,
      createdAt: this.now(), nextRunAt: nextRunAt(cleanDays, time, this.now()), lastRunAt: null, lastResult: null, ...(createdBy ? { createdBy } : {}) };
    this.data.routines.push(routine);
    this.save();
    return { ok: true, routine };
  }

  /** Pause or resume a schedule; it is kept either way (Noam's "close this bot" pauses them). */
  setEnabled(id, enabled) {
    this.load();
    const routine = this.data.routines.find((r) => r.id === id);
    if (!routine) return { error: 'That schedule no longer exists.' };
    routine.enabled = Boolean(enabled);
    if (routine.enabled) routine.nextRunAt = nextRunAt(routine.days, routine.time, this.now());
    this.save();
    return { ok: true };
  }

  remove(id) {
    this.load();
    const before = this.data.routines.length;
    this.data.routines = this.data.routines.filter((r) => r.id !== id);
    if (before === this.data.routines.length) return { error: 'That schedule no longer exists.' };
    this.save();
    return { ok: true };
  }

  /** Send whatever is due. `panes` are the live panes. */
  async tick(panes, { send = this.send } = {}) {
    this.load();
    let changed = false;
    for (const routine of this.data.routines) {
      if (!routine.enabled || !routine.nextRunAt || routine.nextRunAt > this.now()) continue;
      const late = this.now() - routine.nextRunAt;
      const pane = panes.find((p) => p.id === routine.pane);
      const advance = (result) => {
        routine.lastResult = result;
        routine.nextRunAt = nextRunAt(routine.days, routine.time, this.now() + 60_000);
        changed = true;
      };
      if (!pane) { advance({ at: this.now(), ok: false, reason: 'The agent was closed, so this one was skipped.' }); continue; }
      const busy = pane.turn === 'working' || pane.producing === true;
      if (busy && late < LATE_LIMIT_MS) continue;   // wait for it to be free
      if (busy) { advance({ at: this.now(), ok: false, reason: 'The agent stayed busy for two hours, so this one was skipped.' }); continue; }
      let result;
      try { result = await send(pane, routine.text, {kind:'routine',source_id:`${routine.id}:${routine.nextRunAt}`,
        pane_id:pane.id,provider:pane.provider,session_id:pane.sessionId || null}); } catch (error) { result = { error: error.message }; }
      if (result?.paused && result?.notSent) continue; // keep the original due occurrence; never consume a maintenance refusal
      routine.lastRunAt = this.now();
      advance(result?.ok ? { at: this.now(), ok: true } : { at: this.now(), ok: false, reason: result?.error || 'Not sent.' });
    }
    if (changed) this.save();
    return changed;
  }
}
