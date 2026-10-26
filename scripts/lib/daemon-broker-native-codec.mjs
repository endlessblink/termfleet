// Only convert a VERIFIED durable broker intent to the existing Rust native
// types. These conversions create no authorization, signature or new identity.
import {canonical,digest} from './paid-action-broker.mjs';
const fail=message=>{throw Error(message);};
const equal=(a,b)=>canonical(a)===canonical(b);
const identity=x=>typeof x==='string'&&x.length>0&&!x.includes('\0');
const run=x=>{
  if(!x||!identity(x.ptyId)||!identity(x.runId)||!Number.isSafeInteger(x.pid)||x.pid<1)fail('invalid-native-run');
  return {pane:x.ptyId,run_id:x.runId,pid:x.pid};
};
const draft=x=>{
  if(!x||typeof x.text!=='string'||x.bytes!==Buffer.byteLength(x.text)||x.sha256!==digest(x.text))fail('invalid-native-draft');
  return {text:x.text,sha256:x.sha256,bytes:x.bytes};
};
const route=x=>({pane:x.pane,logical_route_session:x.logicalRouteSession,actual_session:x.actualSession,ownership:run(x.ownership)});
const wire=x=>{
  if(typeof x?.wireBase64!=='string')fail('missing-native-wire');
  const b=Buffer.from(x.wireBase64,'base64');
  if(b.toString('base64')!==x.wireBase64||b.length!==x.wireBytes||digest(b)!==x.wireSha256)fail('invalid-native-wire');
  return {wire:[...b],wire_bytes:b.length,wire_sha256:digest(b)};
};
export function nativeIntent(kind,i,{provider}={}) {
  if(kind==='provider-binding')return {id:i.id,head:i.head,through:i.through,generation:i.generation,
    lifecycle_operation_id:i.lifecycleOperationId,revision:i.revision,provider_binding_hash:i.providerBindingHash,
    source:route(i.source),target:i.target===null?null:route(i.target)};
  if(kind==='native-input')return {id:i.id,original_id:i.originalId,event_hash:i.eventHash,accepted_head:i.acceptedHead,
    through:i.through,source_pane:i.sourcePane,source_session:i.sourceSession,target_pane:i.targetPane,target_session:i.targetSession,
    source_logical_route_session:i.sourceLogicalRouteSession,target_logical_route_session:i.targetLogicalRouteSession,
    provider_binding_hash:i.providerBindingHash,lifecycle_operation_id:i.lifecycleOperationId,generation:i.generation,
    source_ownership:run(i.sourceOwnership),target_ownership:run(i.targetOwnership),question_ownership:i.questionOwnership,
    ...wire(i.frame),provider_choice:i.frame.kind==='provider-choice'};
  if(kind==='provider-startup')return {id:i.id,head:i.head,through:i.through,checkpoint_hash:i.checkpointHash,
    decision_hash:i.decisionHash,decision_revision:i.decisionRevision,epoch:i.epoch,generation:i.generation,
    provider_binding_generation:i.providerBindingGeneration,provider_binding_hash:i.providerBindingHash,
    provider_binding_revision:i.providerBindingRevision,lifecycle_operation_id:i.lifecycleOperationId,
    target_pane:i.targetPane,target_session:i.targetSession,target_logical_route_session:i.targetLogicalRouteSession,
    target_ownership:run(i.targetOwnership),startup_task:draft(i.startupTask),...wire(i.frame)};
  if(kind==='handoff'){
    const a=i.action,s=run(a.sourceOwnership),l=a.launch;
    if(s.pane!==a.sourcePane)fail('native-handoff-source-pane-mismatch');
    if(!l||!['claude','codex'].includes(l.provider)||l.provider!==provider||!identity(l.command)||
      l.cwd!==null&&!identity(l.cwd)||!Number.isSafeInteger(l.cols)||l.cols<1||l.cols>65535||
      !Number.isSafeInteger(l.rows)||l.rows<1||l.rows>65535)fail('missing-native-handoff-launch');
    return {operation_id:i.id,action_hash:i.actionHash,request_id:a.requestId,source_pane:a.sourcePane,
      source_session:a.sourceSession,target_pane:a.targetPane,target_session:a.targetSession,descriptor:a.descriptor,
      generation:i.generation,head:i.head,through:i.through,epoch:i.epoch,checkpoint_hash:i.checkpointHash,
      decision_hash:i.decisionHash,decision_revision:i.decisionRevision,launch:l,draft:draft(a.unsentDraft),
      startup_task:draft(a.startupTask),source_run_id:s.run_id,source_pid:s.pid};
  }
  fail('unknown-native-effect-kind');
}
export function brokerReceipt(kind,i,native,received) {
  // Native callbacks must return the exact typed tuple. Rust independently
  // validates the tuple and effect against its real bound PTY ownership.
  if(kind==='handoff'){
    if(!received||!equal(received.intent,native)||!identity(received.target?.pane)||
      received.target.pane!==native.target_pane||!identity(received.target.run_id)||
      received.target.run_id===native.source_run_id||!Number.isSafeInteger(received.target.pid)||
      received.target.pid<1||received.target.pid===native.source_pid)fail('native-handoff-receipt-mismatch');
    const a=i.action;return {operationId:i.id,actionHash:i.actionHash,sourcePane:a.sourcePane,targetPane:a.targetPane,
      sourceSession:a.sourceSession,targetSession:a.targetSession,descriptor:a.descriptor,generation:i.generation,
      head:i.head,through:i.through,epoch:i.epoch,checkpointHash:i.checkpointHash,decisionHash:i.decisionHash,
      decisionRevision:i.decisionRevision,startOwnership:'committed',archiveOwnership:'committed',
      startupTask:{bytes:a.startupTask.bytes,sha256:a.startupTask.sha256,status:'withheld',submitted:false},
      unsentDraft:{sha256:a.unsentDraft.sha256,bytes:a.unsentDraft.bytes,targetPane:a.targetPane,
        targetSession:a.targetSession,status:'retained-unsent',submitted:false}};
  }
  if(!equal(kind==='native-input'?received?.intent:received,native))fail('native-effect-receipt-mismatch');
  if(kind==='provider-binding')return Object.fromEntries(['head','through','generation','lifecycleOperationId',
    'revision','providerBindingHash','source','target'].map(k=>[k,i[k]]).concat([
      ['operationId',i.id],['status','bound-native-provider-projection']]));
  if(kind==='native-input')return Object.fromEntries(['originalId','eventHash','acceptedHead','through','sourcePane',
    'sourceSession','targetPane','targetSession','lifecycleOperationId','generation','sourceOwnership','targetOwnership',
    'questionOwnership','sourceLogicalRouteSession','targetLogicalRouteSession','providerBindingHash'].map(k=>[k,i[k]]).concat([
      ['operationId',i.id],['wireBytes',i.frame.wireBytes],['wireSha256',i.frame.wireSha256],['status','written-to-bound-pty']]));
  if(kind==='provider-startup')return Object.fromEntries(['head','through','checkpointHash','decisionHash','decisionRevision',
    'epoch','generation','providerBindingGeneration','providerBindingHash','providerBindingRevision','lifecycleOperationId',
    'targetPane','targetSession','targetLogicalRouteSession','targetOwnership'].map(k=>[k,i[k]]).concat([
      ['operationId',i.id],['startupTask',{bytes:i.startupTask.bytes,sha256:i.startupTask.sha256}],
      ['wireBytes',i.frame.wireBytes],['wireSha256',i.frame.wireSha256],['status','released-to-bound-provider']]));
  fail('unknown-native-effect-kind');
}
