/** Compatibility projection is independent of collection. Shadow records the
 * binding but must not replace the legacy display's turn/reason. */
export function sessionCompatibilitySidecar(sidecar,head,authority=false) {
 const next={...sidecar,...(head ? {sessionEventBinding:head.identity,sessionEventSeq:head.seq}:{})};
 if(!authority) return next;
 if(!head) {next.turn='unknown';delete next.turnReason;delete next.now;return next;}
 next.turn=head.state.lifecycle==='waiting' ? 'waiting' : ['finished','idle','ended'].includes(head.state.lifecycle) ? 'idle' : head.state.lifecycle==='working' ? 'working':'unknown';
 if(head.state.now && ['working','waiting'].includes(head.state.lifecycle)) next.now=head.state.now.text;
 else delete next.now;
 if(head.state.question) next.turnReason=head.state.question.reason==='approval' ? 'permission_request':'operator_question';
 else delete next.turnReason;
 return next;
}
