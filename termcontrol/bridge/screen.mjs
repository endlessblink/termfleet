import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from './paths.mjs';

// The daemon snapshot is ANSI scrollback, not a rendered screen. Stripping
// escapes cannot identify a focused form; use the desktop's existing VT view.
export function visibleScreenOf(id, { file=path.join(PATHS.agentStatus,'termfleet-cockpit-snapshot.json'), now=Date.now(), after=0, maxAgeMs=6000 } = {}) {
  try {
    const snapshot=JSON.parse(fs.readFileSync(file,'utf8'));
    if(snapshot.sourceApp!=='termfleet')return null;
    const terminal=snapshot.terminals?.find(item=>item.terminalId===id);
    const at=Number(terminal?.terminalVisibleTextUpdatedAt);
    if(!at || at<after || at>now+1000 || now-at>maxAgeMs)return null;
    return typeof terminal.terminalVisibleText==='string'?terminal.terminalVisibleText:null;
  } catch { return null; }
}
