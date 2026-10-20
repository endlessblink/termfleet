import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PATHS } from './paths.mjs';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';

const daemonSnapshot = async (id) => {
  const res = await requestDaemon({ type: 'snapshotSession', id }, defaultDaemonSocket());
  return res?.ok === true ? String(res.value?.data ?? '') : null;
};

/**
 * The terminal's screen drawn from the daemon's own output, for when the desktop's copy
 * is missing or stale (Noam 2026-10-20: the desktop wrote no terminal text, so a typed
 * answer to a still-waiting question was refused as "no longer on screen"). Drawn with
 * the same terminal library the app uses, at the size the daemon last gave that terminal.
 */
export function savedSizeOf(id, dir = path.join(path.dirname(PATHS.workspace), 'sessions')) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, `${Buffer.from(id).toString('hex')}.meta.json`), 'utf8'));
    const cols = Number(meta.cols), rows = Number(meta.rows);
    return cols >= 20 && cols <= 1000 && rows >= 5 && rows <= 500 ? { cols, rows } : null;
  } catch { return null; }
}

export async function liveScreenOf(id, { snapshot = daemonSnapshot, size = savedSizeOf } = {}) {
  const known = size(id);
  if (!known) return null;
  let data;
  try { data = await snapshot(id); } catch { return null; }
  if (typeof data !== 'string') return null;
  const { rows } = known;
  const { Terminal } = createRequire(import.meta.url)('@xterm/xterm');
  const draw = (cols) => new Promise((resolve) => {
    const term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
    term.write(data, () => {
      const buffer = term.buffer.active, lines = [];
      for (let y = 0; y < rows; y++) lines.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? '');
      term.dispose();
      resolve(lines);
    });
  });
  const lines = await draw(known.cols);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  return lines.join('\n');
}

/**
 * The pane's visible text, but only from an observation made at or after `since`.
 * Unlike visibleScreenOf this accepts a screen whose text did not change, which is
 * exactly the case to catch when a submit key was swallowed.
 */
export function observedScreenOf(id, { since, file=path.join(PATHS.agentStatus,'termfleet-cockpit-snapshot.json'), now=Date.now() } = {}) {
  try {
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    if(snapshot.sourceApp!=='termfleet')return null;
    const terminal=snapshot.terminals?.find(item=>item.terminalId===id);
    const observed=Number(terminal?.updatedAt);
    if(!observed || observed<since || observed>now+1000)return null;
    return typeof terminal.terminalVisibleText==='string'?terminal.terminalVisibleText:null;
  } catch { return null; }
}

// The daemon snapshot is ANSI scrollback, not a rendered screen. Stripping
// escapes cannot identify a focused form; use the desktop's existing VT view.
export function visibleScreenOf(id, { file=path.join(PATHS.agentStatus,'termfleet-cockpit-snapshot.json'), now=Date.now(), after=0, maxAgeMs=6000 } = {}) {
  try {
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    if(snapshot.sourceApp!=='termfleet')return null;
    const terminal=snapshot.terminals?.find(item=>item.terminalId===id);
    const at=Number(terminal?.terminalVisibleTextUpdatedAt);
    if(!at || at<after || at>now+1000)return null;
    // Terminal.tsx changes this timestamp only when VT text changes. A question
    // can stay unchanged for hours. The mounted pane's snapshot probe separately
    // observes that exact pane every ten seconds; a global heartbeat alone is
    // insufficient. After input, keep requiring content captured after the input.
    const observed=Number(terminal?.updatedAt),captured=Number(snapshot.updatedAt);
    if(observed){
      const ageLimit=Math.max(maxAgeMs,15000);
      if(observed>now+1000 || !captured || captured>now+1000 || observed>captured+1000 || now-observed>ageLimit || now-captured>ageLimit)return null;
    }else if(now-at>maxAgeMs)return null;
    return typeof terminal.terminalVisibleText==='string'?terminal.terminalVisibleText:null;
  } catch { return null; }
}
