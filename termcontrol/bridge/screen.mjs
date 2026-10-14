import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.mjs';

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
