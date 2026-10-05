import type {SessionState,SessionEvent,SessionIdentity,SessionView} from './sessionState.mjs';
export interface SessionSnapshot {version:2;provider:'codex'|'claude'|'opencode';identity:SessionIdentity;seq:number;event:SessionEvent & {version:2;seq:number};state:SessionState;journal:string}
export function hydrateSessionSnapshot(head:unknown,context:{now:number;wallNow:number}):SessionState|null;
export function viewFromSessionSnapshot(head:unknown,context:{now:number;wallNow:number}):SessionView|null;
