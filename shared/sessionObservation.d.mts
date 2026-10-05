import type {SessionIdentity,SessionState} from './sessionState.mjs';
import type {SessionEnvelope} from './sessionEnvelope.mjs';
/** Capture-time binding and process lifetime token supplied by a trusted source.
 * observer sequence must remain monotonic across restarts for the same run. */
export interface SessionObservation {
 identity:SessionIdentity;observer:string;seq:number;at:number;
 type:'agent.started'|'agent.exited'|'interruption.intent'|'interruption.observed'|'transport.disconnected'|'transport.reconnected';
 processToken?:string;exitCode?:number;signal?:string;intentId?:string;key?:'Escape'|'Ctrl+C';
}
export function sessionObservationEnvelope(state:SessionState,observation:SessionObservation,seq:number):SessionEnvelope|null;
