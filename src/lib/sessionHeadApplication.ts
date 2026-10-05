import type {TerminalState} from './types';
import type {SessionSnapshot} from '../../shared/sessionSnapshot.mjs';
import {sameSessionIdentity} from '../../shared/sessionState.mjs';
/** Apply validated collection separately from activation. Shadow cannot replace
 * provider attribution, conversation metadata or the legacy Task rail. */
export function applySessionHead(pane:TerminalState,head:SessionSnapshot,sourcePaneId:string,authority:boolean):TerminalState {
 const previous=pane.sessionSnapshotV2;
 const sameBinding=previous && sameSessionIdentity(previous.identity,head.identity);
 if(sameBinding && previous.seq>head.seq) return pane;
 // Re-reading a head must not reset local PTY-exit/reconnect observations.
 const snapshot=sameBinding && previous.seq===head.seq ? previous : head;
 const taskLineup=(head.state.tasks ?? []).map(task=>({id:task.id,content:task.text,activeForm:task.activeForm,status:task.status,
  source:'todo-write' as const,runId:pane.activeRunId,updatedAt:head.state.lastEventAt ?? head.event.at}));
 const displayChanged=authority && (pane.providerSessionId!==head.identity.sessionId || pane.agentProvider!==head.provider || JSON.stringify(pane.taskLineup)!==JSON.stringify(taskLineup));
 if(snapshot===previous && pane.statusEventPaneId===sourcePaneId && !displayChanged) return pane;
 return {...pane,statusEventPaneId:sourcePaneId,sessionSnapshotV2:snapshot,
  ...(authority ? {providerSessionId:head.identity.sessionId,agentProvider:head.provider,taskLineup}: {})};
}
