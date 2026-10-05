import {selectSessionView,type SessionState} from '../../shared/sessionState.mjs';
import type {TerminalState} from './types';
export interface SessionDisagreement {paneId:string;at:number;legacyStatus:string;reportedStatus:string;fields:string[]}
const recent:SessionDisagreement[]=[];
/** Bounded, in-memory metadata only. No prompts, activity text or file paths. */
export function recordSessionDisagreement(pane:TerminalState,state:SessionState,now:number,at:number) {
 if(!state.authorityProducer) return;
 const view=selectSessionView(state,now),legacy=pane.statusSummary;
 const reportedStatus=view.lifecycle==='finished' ? 'idle':view.lifecycle;
 const fields:string[]=[];
 if(legacy?.status && legacy.status!==reportedStatus) fields.push('status');
 if(legacy?.task && view.task?.text && legacy.task!==view.task.text) fields.push('task');
 if(legacy?.mainTask && view.goal?.text && legacy.mainTask!==view.goal.text) fields.push('goal');
 if(legacy?.now && view.now?.text && legacy.now!==view.now.text) fields.push('now');
 if(!fields.length) return;
 const item={paneId:pane.paneId,at,legacyStatus:legacy?.status ?? 'unknown',reportedStatus:view.lifecycle,fields};
 const last=recent[recent.length-1];
 if(last?.paneId===item.paneId && last.legacyStatus===item.legacyStatus && last.reportedStatus===item.reportedStatus && last.fields.join()===fields.join()) return;
 recent.push(item);if(recent.length>64) recent.shift();
}
export function sessionDisagreements():SessionDisagreement[] {return recent.map(item=>({...item,fields:[...item.fields]}));}
