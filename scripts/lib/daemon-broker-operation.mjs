// Private one-operation stdio bridge. Rust selects this job in its own catalog,
// owns every source/document/native guard before spawning, and retains those
// physical guards until the final response AND successful child exit. Pipe
// origin does not authenticate the owner or authorize spending.
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {PaidActionBroker,canonical,digest} from './paid-action-broker.mjs';
import {NativeFramedInputHost} from './native-framed-input-host.mjs';
import {nativeIntent,brokerReceipt} from './daemon-broker-native-codec.mjs';
const fail=message=>{throw Error(message);};
const equal=(a,b)=>canonical(a)===canonical(b);
const sync=(x,label)=>{
  if(x&&typeof x.then==='function'){Promise.resolve(x).catch(()=>{});fail(`async-${label}`);}return x;
};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const identity=x=>typeof x==='string'&&x.length>0&&!x.includes('\0');
const keys=(x,allowed)=>object(x)&&Object.keys(x).every(k=>allowed.includes(k));
const methods=Object.freeze({commitHandoff:1,submit:2,retain:1,registerProviderBinding:1,
  registerProviderQuestion:1,activateProviderBinding:1,reconcileProviderRegistration:1,
  reconcileProviderActivation:1,reconcileNativeInput:1,activate:1,recoverUnsent:1});
export function validateOperation(start) {
  if(!keys(start,['version','type','callId','job','method','args'])||start.version!==1||start.type!=='operation'||
    !identity(start.callId)||!Object.hasOwn(methods,start.method)||!Array.isArray(start.args)||
    start.args.length!==methods[start.method])fail('invalid-private-operation');
  if(!keys(start.job,['id','brokerDirectory'])||!identity(start.job.id)||!identity(start.job.brokerDirectory)||
    !isAbsolute(start.job.brokerDirectory))fail('invalid-private-resolved-job');
  // No create(), grant, paid dispatch, dynamic module, key or verification
  // option is accepted. Signed args remain untrusted until broker.verify.
  canonical(start);return start;
}
export function resolvePrivateLaunchJob(start) {
  validateOperation(start);
  return {id:start.job.id,brokerDirectory:start.job.brokerDirectory};
}
function recoverUnsent(broker,withHostOperation,args) {
  if(!keys(args,['operationId','targetPane','targetSession'])||
    !['operationId','targetPane','targetSession'].every(k=>identity(args[k])))fail('invalid-unsent-recovery');
  const s=broker.state(),scope={operation:'handoff',binding:structuredClone(s.binding),head:s.head,
    documents:Object.entries(s.documents).map(([id,d])=>({id,path:d.path,sha256:d.hash}))};
  return withHostOperation(scope,()=>broker.withHostJournal('handoff',()=>{
    const current=broker.state();
    if(current.head!==scope.head||!equal(current.binding,scope.binding)||
      !equal(Object.entries(current.documents).map(([id,d])=>({id,path:d.path,sha256:d.hash})),scope.documents))
      fail('stale-unsent-recovery-scope');
    for(const d of scope.documents)if(digest(readFileSync(d.path))!==d.sha256)fail('required-document-changed');
    const op=current.lifecycleOperations?.[args.operationId],a=op?.action,t=current.inputTarget,d=a?.unsentDraft;
    if(!op||op.status!=='recorded'||op.id!==args.operationId||op.actionHash!==digest(a)||
      a?.targetPane!==args.targetPane||a?.targetSession!==args.targetSession||
      t?.operationId!==op.id||t.generation!==op.generation||t.targetPane!==args.targetPane||t.targetSession!==args.targetSession||
      !d||typeof d.text!=='string'||d.submitted!==false||d.bytes!==Buffer.byteLength(d.text)||d.sha256!==digest(d.text)||
      !op.receipt||op.receipt.operationId!==op.id||op.receipt.actionHash!==op.actionHash||
      op.receipt.unsentDraft?.status!=='retained-unsent'||op.receipt.unsentDraft?.submitted!==false||
      op.receipt.unsentDraft?.sha256!==d.sha256||op.receipt.unsentDraft?.bytes!==d.bytes||
      op.receipt.unsentDraft?.targetPane!==args.targetPane||op.receipt.unsentDraft?.targetSession!==args.targetSession)
      fail('unverified-recorded-unsent-recovery');
    return {operation_id:op.id,target_pane:args.targetPane,target_session:args.targetSession,
      draft:{text:d.text,sha256:d.sha256,bytes:d.bytes}};
  }));
}
// resolveJob/createBroker/clock are private function injection for the harness.
// The production entrypoint supplies only resolvePrivateLaunchJob, the actual
// broker class and its real clock; no caller packet can select these functions.
export function runDaemonBrokerOperation(start,{resolveJob=resolvePrivateLaunchJob,exchange,emit,
  createBroker=(dir,runtime)=>new PaidActionBroker(dir,runtime),clock}={}) {
  let broker,native=null,effectKind=null,effectId=null,issued=false,request=0,guardEntered=false;
  const callId=identity(start?.callId)?start.callId:null;
  const ask=(type,payload)=>{
    if(typeof exchange!=='function')fail('missing-private-pipe-exchange');
    const requestId=++request,reply=sync(exchange({version:1,type,callId,requestId,...payload}),'private-pipe-exchange');
    const allowed=type==='guard'?['version','type','callId','requestId','ok','error']:
      ['version','type','callId','requestId','ok','error','receipt'];
    if(!keys(reply,allowed)||reply.version!==1||reply.type!==`${type}-result`||
      reply.callId!==callId||reply.requestId!==requestId||typeof reply.ok!=='boolean')fail('private-pipe-reply-mismatch');
    if(reply.ok!==true)fail(identity(reply.error)?reply.error:'private-native-guard-or-effect-denied');
    if(Object.hasOwn(reply,'error'))fail('private-pipe-success-error-conflict');
    return reply;
  };
  const guard=(scope,run)=>{
    if(guardEntered)fail('repeated-private-operation-guard');
    // Rust compares this scope to its ACTUALLY held, enrolled resources. A
    // client payload boolean cannot call this function or confer a lease.
    ask('guard',{scope});guardEntered=true;return sync(run(),'broker-operation');
  };
  const effect=(kind,intent)=>{
    if(!guardEntered||issued)fail('native-effect-callback-consumed; no retry');
    issued=true;effectKind=kind;effectId=intent.id;
    const typed=nativeIntent(kind,intent,{provider:broker.state().binding.provider}),reply=ask('effect',{kind,intent,native:typed});
    const receipt=brokerReceipt(kind,intent,typed,reply.receipt);native=structuredClone(reply.receipt);return receipt;
  };
  let packet;
  try{
    validateOperation(start);
    const job=sync(resolveJob(start),'private-job-resolver');
    if(!keys(job,['id','brokerDirectory'])||job.id!==start.job.id||job.brokerDirectory!==start.job.brokerDirectory)
      fail('private-job-resolution-mismatch');
    let host;
    const runtime={withLifecycleSources:(binding,run)=>host.withLifecycleSources(binding,run),
      lifecycleAdapter:(_action,intent)=>effect('handoff',intent),inputAdapter:intent=>effect('native-input',intent),
      providerRegistrationAdapter:intent=>effect('provider-binding',intent),
      providerActivationAdapter:intent=>effect('provider-startup',intent),...(clock?{clock}:{})};
    broker=sync(createBroker(job.brokerDirectory,runtime),'private-broker-constructor');
    host=new NativeFramedInputHost(broker,{withHostOperation:guard});
    const result=start.method==='recoverUnsent'?recoverUnsent(broker,guard,start.args[0]):host[start.method](...start.args);
    const typed=start.method==='commitHandoff'?{effect:native}:
      ['submit','registerProviderBinding','activateProviderBinding'].includes(start.method)?native:result;
    packet={version:1,type:'result',callId,ok:true,result:typed,broker:result};
  }catch(error){packet={version:1,type:'result',callId,ok:false,error:String(error?.message??error)};}
  if(typeof emit==='function'){
    try{sync(emit(packet),'private-final-publication');}
    catch(error){
      // Rust still owns its native/resource lease here. Retain a denial-only
      // transition when the completed effect's delivery cannot be confirmed.
      // Failure to persist this cannot authorize a retry: Rust must hold the
      // uncertain call and inspect the existing journal without resubmission.
      if(issued&&broker&&effectId)try{
        if(effectKind==='native-input')broker.markNativeInputUncertain(effectId,'private final transport publication unverified');
        else broker.markHostOperationUncertain(effectKind,effectId,'private final transport publication unverified');
      }catch{}
      throw error;
    }
  }
  return packet;
}
