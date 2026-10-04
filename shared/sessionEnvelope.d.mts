import type {SessionState,SessionEvent} from './sessionState.mjs';
export interface SessionEnvelope extends SessionEvent {version:2;seq:number}
export function reduceSessionEnvelope(state:SessionState,envelope:SessionEnvelope,context:{now:number;wallNow?:number;leaseMs?:number;clockSkewMs?:number}):SessionState;
