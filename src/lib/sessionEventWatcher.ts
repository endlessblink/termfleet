import {applySessionHead} from './sessionHeadApplication';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {fnv} from './agentStatusSidecar';
import {useWorkspaceStore} from '../stores/workspace';
import {hydrateSessionSnapshot,type SessionSnapshot} from '../../shared/sessionSnapshot.mjs';
import {sessionClock,sessionAuthorityEnabled} from './sessionStateAdapter';
let started=false;
const inFlight=new Map<string,Promise<void>>();
const pending=new Set<string>();
/** File events carry names only. Re-read the complete atomic head, then validate
 * the exact target and re-check the pane after awaiting disk I/O. */
export async function refreshSessionEventHeads(changed='rescan') {
 const initial=useWorkspaceStore.getState();
 const reads=initial.tabs.flatMap(tab=>tab.terminals.flatMap(pane=>{
  const ids=[...new Set([`terminal-${tab.id}-${pane.paneId}`,pane.id])];
  return ids.map(id=>({tabId:tab.id,paneId:pane.paneId,ptyId:pane.id,id,file:`events-${fnv(id)}.json`}));
 }));
 await Promise.all(reads.filter(target=>changed==='rescan'||target.file===changed).map(async target=>{
  if(inFlight.has(target.file)) {pending.add(target.file);return inFlight.get(target.file);}
  const promise=(async()=>{
   const raw=await invoke<string|null>('agent_status_read_sidecar',{fileName:target.file});
   if(!raw) return;
   const head=JSON.parse(raw) as SessionSnapshot;
   if(head.identity?.paneId!==target.id || !hydrateSessionSnapshot(head,{now:sessionClock(),wallNow:Date.now()})) return;
   const store=useWorkspaceStore.getState(),tab=store.tabs.find(item=>item.id===target.tabId),pane=tab?.terminals.find(item=>item.paneId===target.paneId);
   if(!tab||!pane||pane.id!==target.ptyId || (pane.agentProvider && pane.agentProvider!=='shell' && pane.agentProvider!==head.provider)) return;
   const updated=applySessionHead(pane,head,target.id,sessionAuthorityEnabled());
   if(updated===pane) return;
   store.updateTab(tab.id,{terminals:tab.terminals.map(item=>item.paneId===target.paneId ? updated : item)});
  })().catch(error=>console.warn('[termfleet-session-events]',target.file,error)).finally(()=>{inFlight.delete(target.file);if(pending.delete(target.file)) void refreshSessionEventHeads(target.file);});
  inFlight.set(target.file,promise);return promise;
 }));
}
export async function startSessionEventWatcher() {
 if(started||typeof window==='undefined'||!('__TAURI_INTERNALS__' in window)) return;
 started=true;
 let unlisten:(()=>void)|undefined;
 try {
  unlisten=await listen<string>('termfleet:session-event-head',event=>void refreshSessionEventHeads(event.payload));
  await invoke('agent_status_events_watch');
  await refreshSessionEventHeads();
  // Verification covers missed notifications and panes added after watcher startup.
  // Leases use real event time; rereading a snapshot cannot extend them.
  window.setInterval(()=>void refreshSessionEventHeads(),30000);
 } catch(error) {unlisten?.();started=false;console.warn('[termfleet-session-events] watcher unavailable',error);}
}
