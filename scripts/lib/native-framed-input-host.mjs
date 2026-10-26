// Pending delivery spool. The existing broker journal remains authoritative.
// The approved private runtime supplies withHostOperation: it must own source,
// documents and native ownership for the entire callback, including fsync and
// denial reconciliation. This module cannot establish that authority itself.
import {mkdirSync,readFileSync,openSync,closeSync,writeFileSync,fsyncSync,linkSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {PaidActionBroker,canonical,digest} from './paid-action-broker.mjs';

function retainExact(path,bytes,directory) {
  const temporary=join(directory,`.${randomUUID()}.pending`);let fd;
  try{
    fd=openSync(temporary,'wx',0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;
    try{linkSync(temporary,path);}catch(error){
      if(error.code!=='EEXIST'||!readFileSync(path).equals(bytes))throw error;
      const prior=openSync(path,'r');try{fsyncSync(prior);}finally{closeSync(prior);}
    }
  } finally{if(fd!==undefined)closeSync(fd);rmSync(temporary,{force:true});}
  const parent=openSync(directory,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
}
const fail=message=>{throw Error(message);};
function synchronous(value,message) {
  if(value&&typeof value.then==='function'){
    Promise.resolve(value).catch(()=>{});fail(message);
  }
  return value;
}

export class NativeFramedInputHost {
  #broker;#withHostOperation;#active;#directory;
  constructor(broker,{withHostOperation}={}) {
    this.#broker=broker;this.#withHostOperation=withHostOperation;
    this.#directory=join(broker.dir,'native-input-pending');
  }
  get directory(){return this.#directory;}
  // Give this assertion-only adapter to the existing broker constructor. It
  // does not acquire/release a second lease inside the whole-operation lease.
  withLifecycleSources=(binding,run)=>{
    const active=this.#active;
    if(!active||canonical(binding)!==canonical(active.binding))fail('missing-whole-host-operation');
    return synchronous(run(),'async-native-source-callback');
  };
  #guard(operation,run) {
    const guard=this.#withHostOperation;
    if(typeof guard!=='function')fail('missing-host-operation-guard');
    if(guard.constructor.name==='AsyncFunction')fail('async-host-operation-guard');
    if(typeof this.#broker.withHostJournal!=='function')fail('missing-whole-host-journal-lease');
    if(this.#active)fail('nested-host-operation');
    const state=this.#broker.state();
    const scope={operation,binding:structuredClone(state.binding),head:state.head,
      documents:Object.entries(state.documents).map(([id,d])=>({id,path:d.path,sha256:d.hash}))};
    let available=true,entered=false,result;
    try{
      const returned=synchronous(guard(scope,()=>{
        if(!available)fail('host-operation-guard-callback-expired');
        if(entered)fail('host-operation-guard-callback-repeated');
        return this.#broker.withHostJournal(operation,()=>{
        entered=true;this.#active=scope;
        const current=this.#broker.state();
        if(canonical(current.binding)!==canonical(scope.binding)||current.head!==scope.head||
          canonical(Object.entries(current.documents).map(([id,d])=>({id,path:d.path,sha256:d.hash})))!==canonical(scope.documents))
          fail('stale-host-operation-scope');
        for(const d of scope.documents)if(digest(readFileSync(d.path))!==d.sha256)fail('required-document-changed');
        try{result=synchronous(run(),'async-host-operation');return result;}
        finally{this.#active=undefined;}
        });
      }),'async-host-operation-guard');
      if(!entered)fail('host-operation-guard-not-entered');
      if(returned!==result)fail('host-operation-guard-result-mismatch');
      return result;
    } finally{available=false;this.#active=undefined;}
  }
  // Whole call, including the broker's final recorded transition and catch,
  // runs before the private runtime can release its resource lease.
  #brokerOperation(operation,method,envelope,uncertaintyKind=operation) {
    let outcome;
    try{return this.#guard(operation,()=>{outcome=this.#broker[method](envelope);return outcome;});}
    catch(error){
      if(outcome)this.#broker.markHostOperationUncertain(uncertaintyKind,outcome.operationId,
        'whole-operation lease completion unverified');
      throw error;
    }
  }
  commitHandoff(envelope) {return this.#brokerOperation('handoff','commitHandoff',envelope);}
  registerProviderBinding(envelope) {return this.#brokerOperation('provider-binding','registerProviderBinding',envelope);}
  registerProviderQuestion(envelope) {return this.#brokerOperation('provider-question','registerProviderQuestion',envelope);}
  activateProviderBinding(envelope) {return this.#brokerOperation('provider-startup','activateProviderBinding',envelope);}
  reconcileProviderActivation(envelope) {return this.#brokerOperation('provider-reconcile','reconcileProviderActivation',envelope,'provider-startup');}
  reconcileProviderRegistration(envelope) {return this.#brokerOperation('provider-reconcile','reconcileProviderRegistration',envelope,'provider-binding');}
  activate(envelope) {return this.#brokerOperation('reader-activation','activate',envelope,'provider-binding');}
  #retainExactInput(attestedEnvelope) {
    const verified=this.#broker.verifyNativeInput(attestedEnvelope);
    mkdirSync(this.directory,{recursive:true,mode:0o700});
    const parent=openSync(this.#broker.dir,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
    const input=Buffer.from(canonical(attestedEnvelope)+'\n');
    const inputPath=join(this.directory,`${digest(input)}.frame.json`);
    retainExact(inputPath,input,this.directory);
    return {verified,retainedInput:{path:inputPath,bytes:input.length,sha256:digest(input)}};
  }
  // The approved ingress must retain before attempting an operation that can
  // be busy. This writes source DATA only to the same pending spool; it grants
  // no journal acceptance, provider delivery, human proof or spending scope.
  // submit() independently repeats retention under its complete resource lease.
  retain(attestedEnvelope) {
    const {retainedInput}=this.#retainExactInput(attestedEnvelope);
    return {status:'retained-unadmitted',acknowledged:false,forwarded:false,
      comprehension:'unverified',retainedInput};
  }
  reconcileNativeInput(envelope) {
    let result;
    try{return this.#guard('provider-reconcile',()=>{
      result=this.#broker.reconcileNativeInput(envelope);
      try{
        if(result.acknowledged!==true||result.forwarded!==false)fail('native-reconciliation-outcome-unverified');
        mkdirSync(this.directory,{recursive:true,mode:0o700});
        const parent=openSync(this.#broker.dir,'r');try{fsyncSync(parent);}finally{closeSync(parent);}
        const id=digest({operationId:result.operationId,reconciliationEnvelopeSha256:digest(envelope)});
        const receiptPath=join(this.directory,`${id}.reconciled.receipt.json`);
        retainExact(receiptPath,Buffer.from(canonical({operationId:result.operationId,
          receipt:result.receipt,reconciliationEnvelopeSha256:digest(envelope),comprehension:'unverified'})+'\n'),this.directory);
        return {...result,receiptPath};
      }catch(error){
        const operationId=result.operationId;
        this.#broker.markNativeInputUncertain(operationId,'reconciliation receipt publication failed');result=undefined;
        fail(`uncertain-native-input-reconciliation:${operationId}; reconcile without retry`);
      }
    });}catch(error){
      if(result)this.#broker.markNativeInputUncertain(result.operationId,'reconciliation lease completion unverified');
      throw error;
    }
  }
  submit(attestedEnvelope,nativeBindingEnvelope) {
    let effect;
    try{return this.#guard('native-input',()=>{
      const {verified,retainedInput}=this.#retainExactInput(attestedEnvelope);
      const id=digest({binding:verified.binding,originalId:verified.event.originalId});
      const result=this.#broker.admitFramedInput(attestedEnvelope,nativeBindingEnvelope);
      if(result.status==='quarantined'&&result.acknowledged===false&&result.forwarded===false&&
        typeof result.operationId==='string'&&result.operationId){
        return {...result,retainedInput};
      }
      effect=result.operationId;
      try{
        if(result.acknowledged!==true)fail('native-input-not-acknowledged');
        const receipt={operationId:result.operationId,receipt:result.receipt,comprehension:'unverified'};
        const receiptPath=join(this.directory,`${id}.receipt.json`);
        retainExact(receiptPath,Buffer.from(canonical(receipt)+'\n'),this.directory);
        return {...result,retainedInput,receiptPath};
      } catch(error){
        this.#broker.markNativeInputUncertain(effect,'final input receipt publication failed');
        effect=undefined;
        fail(`uncertain-native-input-receipt:${result.operationId}; reconcile without retry`);
      }
    });}catch(error){
      // A runtime lease that fails after the callback cannot confer success.
      // This denial-only journal transition is still required after an effect;
      // it grants no authority and never reacquires/redispatches native work.
      if(effect)this.#broker.markNativeInputUncertain(effect,'whole-operation lease completion unverified');
      throw error;
    }
  }
}

// Attach to an existing journal and its existing private runtime adapters.
// No create(), keys, authority registration, process start or store migration.
export function attachNativeFramedInputHost(dir,{withHostOperation,...runtime}={}) {
  let host;
  const broker=new PaidActionBroker(dir,{...runtime,
    withLifecycleSources:(binding,run)=>host.withLifecycleSources(binding,run)});
  host=new NativeFramedInputHost(broker,{withHostOperation});
  return Object.freeze(host);
}
