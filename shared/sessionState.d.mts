export interface SessionIdentity {paneId:string;sessionId:string;runId:string;epoch:number}
export interface SessionText {text:string;source:string;pinned?:boolean;label?:string;since?:number;stale?:boolean}
export interface SessionQuestion {id:string;reason:'approval'|'input';callId?:string}
export interface SessionPlanTask {id:string;text:string;status:'pending'|'in_progress'|'completed';activeForm?:string}
export interface SessionEvent {identity:SessionIdentity;id:string;producer:string;seq?:number;at:number;
 source:'hook'|'vendor'|'operator'|'process'|'transport';kind:string;lifecycle?:string;
 tasks?:SessionPlanTask[]|null;task?:SessionText|null;goal?:SessionText|null;now?:SessionText|null;question?:SessionQuestion|null;
 questionId?:string;resolvesQuestionId?:string;startsNewTurn?:boolean;completionSource?:string;completedAt?:number}
export interface SessionState {version:2;identity:SessionIdentity;lifecycle:string;confidence:'high'|'low';
 authorityProducer:{producer:string;source:string}|null;goalAt:number|null;tasks:SessionPlanTask[];task:SessionText|null;goal:SessionText|null;now:SessionText|null;question:SessionQuestion|null;
 completion:{at:number;source:string;id:string}|null;producerSeq:Record<string,number>;seen:string[];
 lastEventAt:number|null;lastProducer:string|null;leaseUntil:number|null;transportGap:boolean;ended:boolean;reason:string}
export interface SessionView {version:2;identity:SessionIdentity;lifecycle:string;confidence:'high'|'low';
 tasks:SessionPlanTask[];task:SessionText|null;goal:SessionText|null;now:SessionText|null;question:SessionQuestion|null;
 completion:SessionState['completion'];attention:'running'|'waiting'|'idle'|'needs-attention'|'unavailable';stale:boolean;reason:string}
export function sameSessionIdentity(a:SessionIdentity,b:SessionIdentity):boolean;
export function createSessionState(identity:SessionIdentity,manualGoal?:SessionText|null):SessionState;
export function reduceSessionStatus(state:SessionState,event:SessionEvent,ctx:{now:number;wallNow?:number;leaseMs?:number;clockSkewMs?:number}):SessionState;
export function selectSessionView(state:SessionState,now:number):SessionView;
