import {sameSessionIdentity,selectSessionView} from './sessionState.mjs';
/** Persisted publisher state uses wall-clock lease coordinates. Rehydrate them
 * against the consumer's monotonic clock; never copy a different process's clock. */
export function hydrateSessionSnapshot(head,{now,wallNow}) {
  if(head?.version!==2 || !['codex','claude','opencode'].includes(head.provider) || !Number.isSafeInteger(head.seq) || head.seq<1 ||
    head.event?.version!==2 || head.event.seq!==head.seq || head.state?.version!==2 ||
    !sameSessionIdentity(head.identity,head.state.identity) || !(sameSessionIdentity(head.identity,head.event.identity) || (head.event.kind==='transport.reconnected' && head.event.source==='transport' && sameSessionIdentity({...head.identity,epoch:head.identity.epoch-1},head.event.identity))) ||
    !['paneId','sessionId','runId'].every(key=>typeof head.identity[key]==='string' && head.identity[key].trim()) ||
    !Number.isSafeInteger(head.identity.epoch) || head.identity.epoch<0 || !Number.isFinite(now) || !Number.isFinite(wallNow)) return null;
  if(!['unknown','working','waiting','idle','finished','interrupted','ended','crashed'].includes(head.state.lifecycle) ||
    !['high','low'].includes(head.state.confidence) || !Array.isArray(head.state.seen) || head.state.seen.length>64 ||
    !head.state.producerSeq || typeof head.state.producerSeq!=='object' ||
    !Object.values(head.state.producerSeq).every(seq=>Number.isSafeInteger(seq) && seq>=0) ||
    (head.state.tasks!=null && (!Array.isArray(head.state.tasks) || !head.state.tasks.every(task=>task && typeof task.id==='string' && typeof task.text==='string' && ['pending','in_progress','completed'].includes(task.status)))) ||
    (head.state.question!=null && (!head.state.question.id || !['approval','input'].includes(head.state.question.reason))) || !['task','goal','now'].every(key=>head.state[key]==null || typeof head.state[key].text==='string') ||
    (head.state.leaseUntil!=null && !Number.isFinite(head.state.leaseUntil))) return null;
  const state=JSON.parse(JSON.stringify(head.state));
  state.leaseUntil=state.leaseUntil==null ? null : now+Math.max(0,state.leaseUntil-wallNow);
  if(head.state.lastEventAt>wallNow+5000) {state.lifecycle='unknown';state.confidence='low';state.leaseUntil=null;state.reason='publisher clock is ahead';}
  return state;
}
export function viewFromSessionSnapshot(head,context) {
  const state=hydrateSessionSnapshot(head,context);
  return state ? selectSessionView(state,context.now) : null;
}
