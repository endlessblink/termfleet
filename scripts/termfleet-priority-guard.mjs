#!/usr/bin/env node
// Always-on priority guard (Noam 2026-10-22: 'אין דרך להגביל את מידת השימוש במעבד לכל הסוכנים
// האלו אלא אם זה משהו דחוף?' … 'אבל לחכות ללא הגבלה לא יכול להיות הפתרון כאן').
// Every 5 s: agent terminals, bot brains and gentle background services get the idle disk class
// (Urgent terminals normal); the agent CPU share and Urgent marks are kept true; and when disk
// pressure stays high for 15 s, the heaviest background disk users are lowered until a calm
// minute passes. Never kills, never pauses. Quiet log: ~/.local/state/termfleet/priority-guard.jsonl
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyIoPriority, applyAgentWeight, reconcileUrgent, pressureGuardStep, isBackgroundCgroup, readGentleServices, stickyGentleServices,
} from './lib/cpu-priority.mjs';

const TICK_MS = 5000;
const logFile = path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state'), 'termfleet', 'priority-guard.jsonl');
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const log = (entry) => {
  try {
    fs.appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`);
    if (fs.statSync(logFile).size > 2_000_000) fs.renameSync(logFile, `${logFile}.1`);
  } catch { /* logging is best effort */ }
};
const ioSome = () => Number(fs.readFileSync('/proc/pressure/io', 'utf8').match(/^some .*?avg10=([0-9.]+)/m)?.[1] || 0);

let last = new Map();
function sampleHogs() {
  const now = new Map();
  const hogs = [];
  for (const pid of fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n))) {
    try {
      const cgroup = (fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8').match(/^0::(.*)$/m) || [])[1] || '';
      if (!isBackgroundCgroup(cgroup)) continue;
      const io = fs.readFileSync(`/proc/${pid}/io`, 'utf8');
      const bytes = Number(io.match(/read_bytes: (\d+)/)[1]) + Number(io.match(/^write_bytes: (\d+)/m)[1]);
      now.set(pid, bytes);
      const before = last.get(pid);
      if (before !== undefined && bytes > before) {
        hogs.push({ pid, bytes: bytes - before, cgroup, cmd: fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').slice(0, 120) });
      }
    } catch { /* gone or not ours */ }
  }
  last = now;
  return hogs;
}

const state = { highSince: null, calmSince: null, lowered: new Map(), sticky: new Map() };
const cache = new Map();
let tick = 0;
log({ action: 'started' });
setInterval(() => {
  tick += 1;
  try { pressureGuardStep({ ioSome: ioSome(), hogs: sampleHogs(), state, log }); } catch (e) { log({ action: 'error', where: 'guard', error: String(e?.message || e) }); }
  if (tick % 2 === 1) { try { applyIoPriority({ cache, gentleServices: [...new Set([...readGentleServices(), ...stickyGentleServices(state)])] }); } catch (e) { log({ action: 'error', where: 'io', error: String(e?.message || e) }); } }
  if (tick % 6 === 1) { try { reconcileUrgent(); } catch { /* next time */ } }
  if (tick % 12 === 1) { try { applyAgentWeight(); } catch { /* next time */ } }
}, TICK_MS);
