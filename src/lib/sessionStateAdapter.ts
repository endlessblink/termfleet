import {recordSessionDisagreement} from './sessionShadowDiagnostics';
import {hydrateSessionSnapshot} from '../../shared/sessionSnapshot.mjs';
import {reduceSessionEnvelope} from '../../shared/sessionEnvelope.mjs';
import {createSessionState, reduceSessionStatus, selectSessionView, sameSessionIdentity,
  type SessionState, type SessionEvent, type SessionView} from '../../shared/sessionState.mjs';
import type {TerminalState} from './types';

const eventDigest = (value:string) => {
  let digest=2166136261;for (const char of value) digest=Math.imul(digest^char.charCodeAt(0),16777619);
  return (digest>>>0).toString(16);
};
export const sessionClock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
/** Opt-in after shadow proof; reading this flag never changes settings. */
export function sessionAuthorityEnabled() {
  try { return typeof window !== 'undefined' && window.localStorage.getItem('termfleet.experimental.sessionAuthority') === 'on'; }
  catch { return false; }
}
export function authoritativeSessionView(state?:SessionState, now=sessionClock()):SessionView|undefined {
  return state && sessionAuthorityEnabled() ? selectSessionView(state,now) : undefined;
}
/** Compatibility observations enter ONE reducer, independently of the two legacy writers. */
function projectSessionStateCore(previous:TerminalState|undefined, pane:TerminalState, wallNow=Date.now(), now=sessionClock()):SessionState {
  const old=previous?.sessionStateV2;
  const identity={paneId:pane.paneId,sessionId:pane.providerSessionId ?? pane.statusSummary?.sessionId ?? 'unbound',
    runId:pane.activeRunId ?? 'unbound',epoch:old?.identity.epoch ?? 0};
  let state=old && sameSessionIdentity(old.identity,identity) ? old : createSessionState({...identity,epoch:old ? old.identity.epoch+1 : 0},old?.goal);
  const snapshot=pane.sessionSnapshotV2;
  if(snapshot && [pane.id,pane.statusEventPaneId].includes(snapshot.identity.paneId) &&
      (!pane.providerSessionId || pane.providerSessionId===snapshot.identity.sessionId) &&
      (!pane.agentProvider || pane.agentProvider==='shell' || pane.agentProvider===snapshot.provider)) {
    if(snapshot===previous?.sessionSnapshotV2 && old) state=old;
    else {
      const loaded=hydrateSessionSnapshot(snapshot,{now,wallNow});
      if(loaded) {
        const sameBinding=old?.identity.sessionId===loaded.identity.sessionId && old?.identity.runId===loaded.identity.runId;
        const epoch=sameBinding ? Math.max(old!.identity.epoch,loaded.identity.epoch) : loaded.identity.epoch;
        state={...loaded,identity:{...loaded.identity,paneId:pane.paneId,epoch},
          goal:old?.goal?.source==='manual' ? {...old.goal} : loaded.goal};
      }
    }
  }
  // Physical reattach is verification, never completion or a new conversation.
  if (old && previous?.id !== pane.id && state===old) state=reduceSessionStatus(state,{
    identity:state.identity,id:`attach:${pane.id}:${now}`,producer:'transport',source:'transport',at:wallNow,kind:'transport.reconnected',
  },{now,wallNow});
  const manual=pane.mainUserAsk?.source==='manual' ? pane.mainUserAsk : null;
  if (manual) state=reduceSessionStatus(state,{identity:state.identity,id:`manual:${manual.updatedAt}:${eventDigest(manual.text)}`,
    producer:'operator',source:'operator',kind:'goal.set',at:manual.updatedAt ?? wallNow,
    goal:{text:manual.text,source:'manual'}},{now,wallNow});
  for (const envelope of pane.sessionEventsV2 ?? []) state=reduceSessionEnvelope(state,envelope,{now,wallNow});
  // A bound v2 publisher supersedes compatibility observations, even when its lease expires.
  if (state.authorityProducer || snapshot) return state;
  const summary=pane.statusSummary;
  // No resubmission of old data after a rebind or reconnect. Read-side refresh time is not evidence time.
  if (!summary || (summary.sessionId && summary.sessionId!==state.identity.sessionId) || (previous && summary===previous.statusSummary) || summary.confidence!=='high' ||
      !summary.updatedAt || !['sidecar','process'].includes(pane.statusSummarySource ?? '') && !summary.statusFromAgentLog) return state;
  const completed=summary.completedAt && summary.completionSource;
  const lifecycle=completed ? 'finished' : summary.status==='working' ? 'working'
    : summary.status==='waiting' && summary.waitingReason && summary.waitingReason!=='blocked' ? 'waiting' : summary.status==='idle' ? 'idle' : 'unknown';
  // Untyped waiting is unknown in v2; it cannot invent an approval or an unanswered question.
  const question=summary.waitingReason && summary.waitingReason!=="blocked" ? {id:summary.questionId ?? `legacy:${summary.updatedAt}`,reason:summary.waitingReason} : null;
  const currentTask=pane.taskLineup?.find(task=>task.status==='in_progress' && (!task.runId || task.runId===pane.activeRunId));
  const task=currentTask ? {text:currentTask.content,source:'task-tool'} :
    pane.taskLine && ["declared","opening-request","operator-request","current-step"].includes(pane.taskLine.source) && pane.taskLine.capturedAt >= summary.updatedAt ? {text:pane.taskLine.text,source:'task-line'} : null;
  const goal=summary.mainTask && ['about-what','opening-request','agent-goal'].includes(summary.mainTaskSource ?? '')
    ? {text:summary.mainTask,source:summary.mainTaskSource!} : null;
  const event:SessionEvent={identity:state.identity,producer:'legacy-report',source:summary.statusFromAgentLog ? 'vendor':'hook',
    id:`report:${summary.updatedAt}:${eventDigest(JSON.stringify([lifecycle,task,goal,summary.now,question]))}`,
    at:summary.updatedAt,kind:'report',lifecycle,task,goal,now:summary.now ? {text:summary.now,source:'reported'} : null,
    question,startsNewTurn:summary.reportedEventKind==="turn-started",completionSource:summary.completionSource,completedAt:summary.completedAt};
  return reduceSessionStatus(state,event,{now,wallNow});
}

export function projectSessionState(previous:TerminalState|undefined,pane:TerminalState,wallNow=Date.now(),now=sessionClock()):SessionState {
 const state=projectSessionStateCore(previous,pane,wallNow,now);
 recordSessionDisagreement(pane,state,now,wallNow);
 return state;
}
