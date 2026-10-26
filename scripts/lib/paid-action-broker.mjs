// Isolated dispatch core: no installed hooks, provider credentials or network client.
// A trusted host must own this store, signing adapters, input ingress and paid routes.
import {createHash, randomUUID, verify} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, rmSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {readHandoffCapsule,capsuleFreshness} from './handoff-capsule.mjs';
import {validateNativeInputFrame,nativeOwnershipValid,validateProviderQuestion,validateProviderTaskDelivery,providerQuestionOwnership} from './native-input-frame.mjs';

export const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw Error('non-json-value');
  return encoded;
};
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : typeof value === 'string' ? value : canonical(value)).digest('hex');
const equal = (a,b) => canonical(a) === canonical(b);
const fail = message => {throw Error(message);};
const integer = x => Number.isSafeInteger(x) && x >= 0;
const clone = x => JSON.parse(canonical(x));
function durable(path, bytes, flags='wx') {
  const fd = openSync(path, flags, 0o600);
  try {writeFileSync(fd, bytes);fsyncSync(fd);} finally {closeSync(fd);}
}
function bindingValid(b) {
  for (const k of ['requestId','sourceSession','sourcePane','targetSession','targetPane']) if (!b?.[k] || typeof b[k] !== 'string') fail('missing-binding');
  if (!['claude','codex'].includes(b.provider)) fail('unsupported-provider');
  if (b.sourceSession === b.targetSession || b.sourcePane === b.targetPane) fail('identity-collision');
}
// The existing trusted ingress signs this provenance together with the event.
// These fields prove internal completeness/identity consistency, not human
// authentication by themselves. A production native input adapter is still
// required. No filename, shortened excerpt or decoder summary can pass here.
function completeOriginal(e) {
  const o=e?.original;
  if (!o || !['sourceId','channel','session','pane','timestamp','modality'].every(k=>typeof o[k]==='string'&&o[k].length) ||
      !Number.isFinite(Date.parse(o.timestamp)) || !integer(o.sequence) ||
      o.bodyEncoding!=='utf8' || o.complete!==true || !integer(o.bodyBytes) ||
      o.retainedBytes!==o.bodyBytes || !Array.isArray(o.attachmentRefs) ||
      o.attachmentRefs.some(r=>typeof r!=='string'||!r) || !Array.isArray(e.attachments))
    fail('incomplete-original-source');
  let body;
  if(typeof e.text==='string') body=e.text;
  else if(e.kind==='tool-result'&&Object.hasOwn(e,'result')) body=canonical(e.result);
  else fail('missing-original-source-body');
  if(Buffer.byteLength(body)!==o.bodyBytes || digest(body)!==o.bodySha256)
    fail('original-source-byte-mismatch');
  const refs=e.attachments.map(a=>a?.ref??a?.url??a?.path??a?.id);
  if(!equal(refs,o.attachmentRefs)) fail('original-source-attachment-mismatch');
}
function covered(reads, resource) {
  let cursor=0;
  for (const r of reads.filter(r => r.resourceHash === resource.hash).sort((a,b) => a.start-b.start)) {
    if (r.start > cursor) return false;
    cursor=Math.max(cursor,r.end);
  }
  return cursor === resource.bytes.length;
}

export class PaidActionBroker {
  #adapter; #policy; #clock; #timeoutMs; #lifecycleAdapter; #withLifecycleSources; #inputAdapter; #providerActivationAdapter; #providerRegistrationAdapter;
  #hostJournal=null; #transactionActive=false;
  constructor(dir, {adapter, policy, lifecycleAdapter, withLifecycleSources, inputAdapter, providerActivationAdapter, providerRegistrationAdapter, clock=Date.now, timeoutMs=1000}={}) {
    this.dir=dir;this.file=join(dir,'state.json');this.lock=join(dir,'transaction.lock');
    this.#adapter=adapter;this.#policy=policy;this.#clock=clock;this.#timeoutMs=timeoutMs;this.#lifecycleAdapter=lifecycleAdapter;this.#withLifecycleSources=withLifecycleSources;this.#inputAdapter=inputAdapter;this.#providerActivationAdapter=providerActivationAdapter;
    this.#providerRegistrationAdapter=providerRegistrationAdapter;
  }
  static create(dir, {binding, trustedPublicKeys, documents, requiredCapabilities=['ctx_read'], totalBudget}, runtime) {
    bindingValid(binding);
    if (!integer(totalBudget) || !totalBudget) fail('missing-project-budget');
    for (const role of ['ingress','policy','approval','transport','boundary']) if (!trustedPublicKeys?.[role]) fail('missing-trust-root');
    if (!documents?.skill || !documents?.process) fail('missing-required-documents');
    const docs=Object.fromEntries(Object.entries(documents).map(([id,path]) => {
      const bytes=readFileSync(path);return [id,{path,hash:digest(bytes),bytes:bytes.toString('base64')}];
    }));
    mkdirSync(dir,{recursive:true,mode:0o700});
    const state={version:1,binding,trustedPublicKeys,documents:docs,requiredCapabilities,totalBudget,
      entries:[],head:digest({version:1,binding}),epoch:0,activation:null,decision:null,checkpoint:null,approvals:{},
      reads:[],pendingReads:{},operations:{},audit:[]};
    durable(join(dir,'state.json'),canonical(state)+'\n');
    return new PaidActionBroker(dir,runtime);
  }
  state() {
    const s=JSON.parse(readFileSync(this.file,'utf8'));bindingValid(s.binding);
    let head=digest({version:1,binding:s.binding});
    for (const [i,e] of s.entries.entries()) {
      head=digest({previous:head,event:e.event});
      if (e.seq !== i+1 || e.head !== head) fail('journal-integrity');
    }
    if (head !== s.head) fail('journal-integrity');
    // Registration is derived from the existing journal, never a sidecar/alias table.
    let scope=null,hostUncertain=null;
    for(const entry of s.entries) {
      const e=entry.event;
      if(e.kind==='provider-binding-registration') {
        const p=this.verify(s,'boundary',e.kind,e.envelope);
        const op=s.providerRegistrationOperations?.[e.operationId];
        if(!op||!equal(e.receipt,this.#providerRegistrationReceipt(op))||!equal(op.envelope,e.envelope))fail('provider-binding-native-receipt-journal-mismatch');
        if(e.reconciliation){const r=this.verify(s,'boundary','provider-binding-reconciliation',e.reconciliation);
          if(r.operationId!==e.operationId||r.outcome!=='bound'||!equal(r.receipt,e.receipt)||r.providerBindingHash!==digest(p))
            fail('provider-binding-reconciliation-journal-mismatch');}
        if(p.revision!==(scope?.revision??0)+1)fail('provider-binding-journal-revision');
        const identity=digest({provider:p.provider,source:p.source,target:p.target,generation:p.generation,lifecycleOperationId:p.lifecycleOperationId});
        const sameRoute=scope?.routeIdentityHash===identity;
        scope={...clone(p),hash:digest(p),routeIdentityHash:identity,questions:{},activation:sameRoute?scope.activation:null};
        hostUncertain=null;
      } else if(e.kind==='provider-question-registration') {
        const p=this.verify(s,'boundary',e.kind,e.envelope);
        if(!scope||p.providerBindingHash!==scope.hash)fail('provider-question-journal-scope');
        scope.questions[p.logicalRouteSession]=clone(p.question);
      } else if(e.kind==='provider-startup-released') {
        const activation=this.verify(s,'boundary','provider-startup-activation',e.envelope),op=s.providerActivationOperations?.[e.operationId];
        if(!op||!equal(op.envelope,e.envelope)||!equal(e.receipt,this.#providerActivationReceipt(op))||
          activation.providerBindingHash!==e.providerBindingHash)fail('provider-startup-replay-receipt-mismatch');
        if(e.reconciliation){const r=this.verify(s,'boundary','provider-startup-reconciliation',e.reconciliation);
          if(r.operationId!==e.operationId||r.outcome!=='released'||r.providerBindingHash!==e.providerBindingHash||!equal(r.receipt,e.receipt))
            fail('provider-startup-replay-reconciliation-mismatch');}
        if(!scope||e.providerBindingHash!==scope.hash||!e.receipt)fail('provider-activation-journal-scope');
        scope.activation={operationId:e.operationId,status:'released',receipt:clone(e.receipt)};
        if(e.reconciliation&&hostUncertain?.kind==='provider-startup'&&hostUncertain.operationId===e.operationId)hostUncertain=null;
      } else if(e.kind==='provider-host-uncertain') {
        hostUncertain={kind:e.operationKind,operationId:e.operationId,reason:e.reason};
      } else if(e.kind==='provider-binding-confirmed') {
        const r=this.verify(s,'boundary','provider-binding-reconciliation',e.envelope),op=s.providerRegistrationOperations?.[r.operationId];
        if(!scope||!op||r.outcome!=='bound'||r.providerBindingHash!==scope.hash||!equal(r.receipt,this.#providerRegistrationReceipt(op)))
          fail('provider-binding-confirmation-journal-mismatch');
        hostUncertain=null;
      } else if(e.kind==='native-input-reconciled') {
        const p=this.verify(s,'boundary','native-input-reconciliation',e.envelope),op=s.nativeInputOperations?.[p.operationId];
        if(!op||e.operationId!==p.operationId||p.outcome!=='written'||p.providerBindingHash!==op.providerBindingHash||
          !equal(p.receipt,this.#nativeInputReceipt(op)))fail('native-input-reconciliation-journal-mismatch');
      }
    }
    s.providerScope=scope;
    s.providerHostUncertain=hostUncertain;
    return s;
  }
  #persistState(s) {
    const tmp=join(this.dir,`${randomUUID()}.tmp`);
    try {durable(tmp,canonical(s)+'\n');renameSync(tmp,this.file);
      const fd=openSync(this.dir,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
    } finally {rmSync(tmp,{force:true});}
  }
  transaction(change, afterPersist) {
    return this.#transaction(null,change,afterPersist);
  }
  withHostJournal(operation,run) {
    const kind=typeof operation==='string'?operation:operation?.kind;
    if(!['native-input','handoff','provider-binding','provider-question','provider-startup','provider-reconcile','reader-activation'].includes(kind))
      fail('unknown-private-host-operation');
    if(typeof run!=='function'||run.constructor.name==='AsyncFunction')fail('async-private-host-journal');
    if(this.#hostJournal)fail('reentrant-private-host-journal');
    try{mkdirSync(this.lock,{mode:0o700});}catch(error){if(error.code==='EEXIST')fail('busy-or-interrupted; retain input without acknowledgement');throw error;}
    this.#hostJournal={kind};
    try{const result=run();if(result&&typeof result.then==='function'){
      Promise.resolve(result).catch(()=>{});fail('thenable-private-host-journal');}return result;
    }finally{this.#hostJournal=null;rmSync(this.lock,{recursive:true,force:true});}
  }
  #transaction(kind,change,afterPersist) {
    const held=Boolean(this.#hostJournal);
    if(held&&(!kind||kind!==this.#hostJournal.kind&&kind!=='denial'))fail('unrelated-private-host-journal-operation');
    if(this.#transactionActive)fail('reentrant-broker-transaction');
    if(!held)try {mkdirSync(this.lock,{mode:0o700});} catch(e){if(e.code==='EEXIST')fail('busy-or-interrupted; retain input and retry without acknowledgement');throw e;}
    this.#transactionActive=true;
    try {
      const s=this.state(),result=change(s);
      if(result && typeof result.then==='function')fail('async-transaction-change-not-supported');
      this.#persistState(s);
      const effect=afterPersist ? afterPersist(result):result;
      if(effect && typeof effect.then==='function')fail('async-transaction-effect-not-supported');
      return effect;
    } finally {this.#transactionActive=false;if(!held)rmSync(this.lock,{recursive:true,force:true});}
  }
  verify(s, role, type, envelope) {
    const p=envelope?.payload;
    if (!p || p.type !== type || !equal(p.binding,s.binding)) fail('untrusted-or-wrong-binding');
    try {if (!verify(null,Buffer.from(canonical(p)),s.trustedPublicKeys[role],Buffer.from(envelope.signature,'base64'))) fail('invalid-attestation');}
    catch {fail('invalid-attestation');}
    return clone(p);
  }
  #invalidateProviderReadiness(s) {
    s.activation=null;s.reads=[];s.pendingReads={};s.approvals={};
  }
  #appendProviderTransition(s,event) {
    if(!event.originalId||s.entries.some(x=>x.event.originalId===event.originalId))fail('provider-transition-duplicate');
    s.head=digest({previous:s.head,event});s.entries.push({seq:s.entries.length+1,head:s.head,event});
    this.#invalidateProviderReadiness(s);
    return {seq:s.entries.length,head:s.head,through:s.entries.length};
  }
  #providerTarget(s,requireReleased=true) {
    if(s.providerHostUncertain)fail('private-host-completion-unverified');
    const scope=s.providerScope;
    if(!scope)fail('missing-provider-registration');
    if(!integer(scope.expiresAt)||scope.expiresAt<=this.#clock())fail('expired-provider-registration');
    if(Object.values(s.providerRegistrationOperations??{}).some(op=>op.status!=='recorded'))fail('unreconciled-provider-registration');
    const target=s.inputTarget??{targetPane:s.binding.sourcePane,targetSession:s.binding.sourceSession};
    const route=target.operationId?scope.target:scope.source;
    if(!route||route.pane!==target.targetPane||route.logicalRouteSession!==target.targetSession||
      (target.operationId&&(scope.lifecycleOperationId!==target.operationId||scope.generation!==target.generation)))
      fail('provider-registration-current-route-mismatch');
    if(Object.values(s.providerActivationOperations??{}).some(op=>!['recorded','not-released'].includes(op.status)))
      fail('unreconciled-provider-activation');
    if(requireReleased&&target.operationId&&scope.activation?.status!=='released')fail('provider-target-quarantined');
    return {scope,route};
  }
  registerProviderBinding(envelope) {
    if(typeof this.#providerRegistrationAdapter!=='function')fail('missing-private-provider-registration-adapter');
    if(this.#providerRegistrationAdapter.constructor.name==='AsyncFunction')fail('async-provider-registration-adapter');
    if(typeof this.#withLifecycleSources!=='function'||this.#withLifecycleSources.constructor.name==='AsyncFunction')fail('missing-native-source-serialization');
    let intent,result,entered=false,active=true;
    try{const wrapped=this.#withLifecycleSources(clone(envelope?.payload?.binding),()=>{
      if(!active||entered)fail('invalid-native-source-serialization');entered=true;let receipt,uncertain;
      result=this.#transaction('provider-binding',s=>{
      const p=this.verify(s,'boundary','provider-binding-registration',envelope);
      const sameRoutes=s.providerScope&&equal(s.providerScope.source,p.source)&&equal(s.providerScope.target,p.target)&&
        s.providerScope.generation===p.generation&&s.providerScope.lifecycleOperationId===p.lifecycleOperationId;
      if(typeof p.id!=='string'||!p.id||p.provider!==s.binding.provider||p.head!==s.head||p.through!==s.entries.length||
        p.revision!==(s.providerScope?.revision??0)+1||!integer(p.expiresAt)||p.expiresAt<=this.#clock())
        fail('stale-provider-registration');
      if(Object.values(s.nativeInputOperations??{}).some(op=>op.status!=='recorded'&&!(op.status==='quarantined'&&sameRoutes))||
        Object.values(s.lifecycleOperations??{}).some(op=>op.status!=='recorded')||
        Object.values(s.providerActivationOperations??{}).some(op=>!['recorded','not-released'].includes(op.status))||
        Object.values(s.providerRegistrationOperations??{}).some(op=>op.status!=='recorded'))
        fail('unreconciled-provider-registration');
      const valid=(r,pane,logical)=>r&&r.pane===pane&&r.logicalRouteSession===logical&&
        typeof r.actualSession==='string'&&r.actualSession.length>0&&nativeOwnershipValid(r.ownership)&&r.ownership.ptyId===pane;
      if(!valid(p.source,s.binding.sourcePane,s.binding.sourceSession)||p.source.actualSession!==s.binding.sourceSession)
        fail('provider-original-source-identity-mismatch');
      if(p.target===null) {
        if(p.lifecycleOperationId!==null||s.inputTarget?.operationId||!s.checkpoint||p.generation!==s.checkpoint.generation||s.checkpoint.head!==s.head)
          fail('provider-source-generation-mismatch');
      } else {
        const op=s.lifecycleOperations?.[p.lifecycleOperationId];
        if(!valid(p.target,s.binding.targetPane,s.binding.targetSession)||p.target.actualSession===p.source.actualSession||
          p.target.actualSession===s.binding.targetSession||!op||op.status!=='recorded'||p.generation!==op.generation||
          s.inputTarget?.operationId!==op.id||s.inputTarget.generation!==p.generation)
          fail('provider-target-generation-mismatch');
      }
      if(sameRoutes&&s.providerScope.expiresAt>this.#clock()&&!s.providerHostUncertain)
        fail('duplicate-provider-registration');
      s.providerRegistrationOperations??={};if(s.providerRegistrationOperations[p.id])fail('provider-registration-id-conflict-or-duplicate');
      intent={id:p.id,head:p.head,through:p.through,generation:p.generation,lifecycleOperationId:p.lifecycleOperationId,
        revision:p.revision,providerBindingHash:digest(p),source:clone(p.source),target:clone(p.target),status:'committing',envelope:clone(envelope)};
      s.providerRegistrationOperations[p.id]=clone(intent);
      this.#appendProviderTransition(s,{kind:'provider-binding-intent',originalId:`provider-registration-intent:${p.id}`,acceptedAt:this.#clock(),envelope:clone(envelope)});
      return clone(intent);
      },durable=>{
        try{receipt=this.#providerRegistrationAdapter(clone(durable));
          if(receipt&&typeof receipt.then==='function'){Promise.resolve(receipt).catch(()=>{});fail('thenable-provider-registration-receipt');}
          if(!equal(receipt,this.#providerRegistrationReceipt(durable)))fail('provider-registration-receipt-unverified');
        }catch(error){uncertain=String(error.message);}
        const current=this.state(),op=current.providerRegistrationOperations[durable.id];op.status=uncertain?'uncertain':'awaiting-boundary-confirmation';
        if(uncertain)op.error=uncertain;else op.receipt=clone(receipt);this.#persistState(current);
        if(uncertain)fail('provider-registration-outcome-unverified');
        return {operationId:durable.id,providerBindingHash:durable.providerBindingHash,revision:durable.revision,generation:durable.generation,receipt:clone(receipt)};
      });return result;
    });active=false;
    if(wrapped&&typeof wrapped.then==='function'){Promise.resolve(wrapped).catch(()=>{});fail('thenable-source-serialization-unverified');}
    if(!entered||!equal(wrapped,result))fail('native-source-serialization-unverified');
    const published=this.#transaction('provider-binding',s=>{const op=s.providerRegistrationOperations[intent.id];
      if(op.status!=='awaiting-boundary-confirmation')fail('provider-registration-confirmation-unverified');op.status='recorded';
      return this.#appendProviderTransition(s,{kind:'provider-binding-registration',originalId:`provider-registration:${op.id}`,
        operationId:op.id,acceptedAt:this.#clock(),envelope:clone(op.envelope),receipt:clone(op.receipt)});
    });return {...published,...result,status:'registered-quarantined'};
    }catch(error){if(intent){try{this.#transaction('denial',s=>{const op=s.providerRegistrationOperations[intent.id];op.status='uncertain';op.error=String(error.message);
      this.#invalidateProviderReadiness(s);});}catch{}fail(`uncertain-provider-registration:${intent.id}; reconcile without retry`);}throw error;
    }finally{active=false;}
  }
  #providerRegistrationReceipt(i) {
    const {id,head,through,generation,lifecycleOperationId,revision,providerBindingHash,source,target}=i;
    return {operationId:id,head,through,generation,lifecycleOperationId,revision,providerBindingHash,source,target,status:'bound-native-provider-projection'};
  }
  reconcileProviderRegistration(envelope) {
    return this.#transaction('provider-reconcile',s=>{
      const p=this.verify(s,'boundary','provider-binding-reconciliation',envelope),op=s.providerRegistrationOperations?.[p.operationId];
      if(!op||!['committing','uncertain','awaiting-boundary-confirmation'].includes(op.status)||p.head!==s.head||p.through!==s.entries.length||
        p.providerBindingHash!==op.providerBindingHash||!integer(p.expiresAt)||p.expiresAt<=this.#clock()||p.outcome!=='bound'||
        !equal(p.receipt,this.#providerRegistrationReceipt(op)))fail('provider-binding-reconciliation-unverified');
      const original=this.verify(s,'boundary','provider-binding-registration',op.envelope);
      if(original.expiresAt<=this.#clock())fail('expired-provider-registration');
      if(s.entries.some(e=>e.event.kind==='provider-binding-registration'&&e.event.operationId===op.id)&&s.providerScope?.hash!==op.providerBindingHash)
        fail('provider-binding-reconciliation-scope-changed');
      op.status='recorded';op.receipt=clone(p.receipt);
      const already=s.entries.some(e=>e.event.kind==='provider-binding-registration'&&e.event.operationId===op.id);
      const event=already?{kind:'provider-binding-confirmed',originalId:`provider-binding-confirmed:${op.id}:${digest(p)}`,acceptedAt:this.#clock(),envelope:clone(envelope)}:
        {kind:'provider-binding-registration',originalId:`provider-registration-reconciled:${op.id}:${digest(p)}`,operationId:op.id,acceptedAt:this.#clock(),envelope:clone(op.envelope),receipt:clone(p.receipt),reconciliation:clone(envelope)};
      return {operationId:op.id,...this.#appendProviderTransition(s,event),providerBindingHash:op.providerBindingHash,status:'registered-quarantined'};
    });
  }
  registerProviderQuestion(envelope) {
    return this.#transaction('provider-question',s=>{
      const p=this.verify(s,'boundary','provider-question-registration',envelope),{scope}=this.#providerTarget(s,false);
      const route=[scope.source,scope.target].find(r=>r&&r.logicalRouteSession===p.logicalRouteSession);
      if(typeof p.id!=='string'||!p.id||!route||p.head!==s.head||p.through!==s.entries.length||p.providerBindingHash!==scope.hash||p.generation!==scope.generation||
        !integer(p.expiresAt)||p.expiresAt<=this.#clock()||p.actualSession!==route.actualSession||!equal(p.ownership,route.ownership))
        fail('provider-question-current-scope-mismatch');
      const question=validateProviderQuestion(s.binding.provider,p.question);
      const old=scope.questions[p.logicalRouteSession];
      if(old&&old.callId===question.callId)fail('provider-question-id-conflict-or-duplicate');
      return {...this.#appendProviderTransition(s,{kind:p.type,originalId:`provider-question:${p.id}`,
        acceptedAt:this.#clock(),envelope:clone(envelope)}),questionOwnership:providerQuestionOwnership(scope.hash,route,p.question)};
    });
  }
  markNativeInputUncertain(operationId,reason) {
    // Denial-only hook for the private outer host's final receipt publication failure.
    return this.#transaction('denial',s=>{
      const op=s.nativeInputOperations?.[operationId];if(!op)fail('unknown-native-input-operation');
      op.status='uncertain';op.error=String(reason);
      return this.#appendProviderTransition(s,{kind:'native-input-publication-uncertain',originalId:`native-input-uncertain:${operationId}:${randomUUID()}`,
        acceptedAt:this.#clock(),operationId,reason:String(reason)});
    });
  }
  #nativeInputReceipt(i) {
    const {id,originalId,eventHash,acceptedHead,through,sourcePane,sourceSession,targetPane,targetSession,lifecycleOperationId,generation,
      sourceOwnership,targetOwnership,sourceLogicalRouteSession,targetLogicalRouteSession,providerBindingHash,questionOwnership,frame}=i;
    return {operationId:id,originalId,eventHash,acceptedHead,through,sourcePane,sourceSession,targetPane,targetSession,lifecycleOperationId,generation,
      sourceOwnership,targetOwnership,sourceLogicalRouteSession,targetLogicalRouteSession,providerBindingHash,questionOwnership,
      wireBytes:frame.wireBytes,wireSha256:frame.wireSha256,status:'written-to-bound-pty'};
  }
  reconcileNativeInput(envelope) {
    // A trusted receipt proves an already completed write. This method never writes.
    return this.#transaction('provider-reconcile',s=>{
      const p=this.verify(s,'boundary','native-input-reconciliation',envelope),op=s.nativeInputOperations?.[p.operationId];
      if(!op||!['committing','uncertain','awaiting-boundary-confirmation'].includes(op.status)||p.head!==s.head||p.through!==s.entries.length||
        p.outcome!=='written'||!integer(p.expiresAt)||p.expiresAt<=this.#clock()||p.providerBindingHash!==op.providerBindingHash||
        !equal(p.receipt,this.#nativeInputReceipt(op)))fail('native-input-reconciliation-unverified');
      const owner=s.entries.find(e=>e.event.originalId===op.originalId)?.event;
      if(!owner||digest(owner)!==op.eventHash)fail('native-input-reconciliation-original-mismatch');
      op.status='recorded';op.receipt=clone(p.receipt);
      const published=this.#appendProviderTransition(s,{kind:'native-input-reconciled',originalId:`native-input-reconciled:${op.id}:${digest(p)}`,
        acceptedAt:this.#clock(),operationId:op.id,envelope:clone(envelope)});
      return {...published,operationId:op.id,receipt:clone(op.receipt),acknowledged:true,forwarded:false,comprehension:'unverified'};
    });
  }
  markHostOperationUncertain(kind,operationId,reason) {
    return this.#transaction('denial',s=>{
      if(kind==='handoff') {const op=s.lifecycleOperations?.[operationId];if(!op)fail('unknown-lifecycle-operation');op.status='uncertain';op.error=String(reason);}
      else if(kind==='provider-startup') {const op=s.providerActivationOperations?.[operationId];if(!op)fail('unknown-provider-startup-operation');op.status='uncertain';op.error=String(reason);}
      else if(kind==='provider-binding'){const op=s.providerRegistrationOperations?.[operationId];if(op){op.status='uncertain';op.error=String(reason);}}
      else if(kind!=='provider-question')fail('unknown-host-operation-kind');
      return this.#appendProviderTransition(s,{kind:'provider-host-uncertain',originalId:`host-uncertain:${randomUUID()}`,
        acceptedAt:this.#clock(),operationKind:kind,operationId:operationId??null,reason:String(reason)});
    });
  }
  #providerActivationReceipt(intent) {
    const {id,head,through,checkpointHash,decisionHash,decisionRevision,epoch,generation,providerBindingGeneration,
      providerBindingHash,providerBindingRevision,lifecycleOperationId,targetPane,targetSession,targetLogicalRouteSession,targetOwnership,startupTask,frame}=intent;
    return {operationId:id,head,through,checkpointHash,decisionHash,decisionRevision,epoch,generation,providerBindingGeneration,
      providerBindingHash,providerBindingRevision,lifecycleOperationId,targetPane,targetSession,targetLogicalRouteSession,targetOwnership,
      startupTask:{bytes:startupTask.bytes,sha256:startupTask.sha256},wireBytes:frame.wireBytes,wireSha256:frame.wireSha256,
      status:'released-to-bound-provider'};
  }
  activateProviderBinding(envelope) {
    if(typeof this.#providerActivationAdapter!=='function')fail('missing-private-provider-activation-adapter');
    if(this.#providerActivationAdapter.constructor.name==='AsyncFunction')fail('async-provider-activation-adapter');
    if(typeof this.#withLifecycleSources!=='function'||this.#withLifecycleSources.constructor.name==='AsyncFunction')
      fail('missing-native-source-serialization');
    let intent,result,entered=false,active=true;
    try {
      const wrapped=this.#withLifecycleSources(clone(envelope?.payload?.binding),()=>{
        if(!active||entered)fail('invalid-native-source-serialization');entered=true;
        let receipt,uncertain;
        result=this.#transaction('provider-startup',s=>{
          const p=this.verify(s,'boundary','provider-startup-activation',envelope),{scope,route}=this.#providerTarget(s,false);
          const cp=s.checkpoint,d=s.decision,op=s.lifecycleOperations?.[scope.lifecycleOperationId];
          if(!op||!scope.target||scope.activation||p.providerBindingHash!==scope.hash||p.providerBindingGeneration!==scope.generation||
            p.providerBindingRevision!==scope.revision||p.lifecycleOperationId!==op.id||p.head!==s.head||p.through!==s.entries.length||
            !cp||cp.head!==s.head||cp.decisionHash!==d?.hash||p.generation!==cp.generation||p.checkpointHash!==cp.hash||
            p.decisionHash!==d.hash||p.decisionRevision!==d.revision||p.epoch!==s.epoch||!integer(p.expiresAt)||p.expiresAt<=this.#clock())
            fail('stale-provider-activation-scope');
          if(this.#nativeFramesPending(s,true))fail('pending-unjournaled-native-input');
          if(Object.values(s.nativeInputOperations??{}).some(o=>!['recorded','quarantined'].includes(o.status)))fail('unreconciled-native-input');
          if(d.cancelled||d.unknowns.length||d.pendingQuestions.some(q=>q.status!=='answered'))fail('unresolved-provider-startup-scope');
          const action=p.action,task=op.action.startupTask,frame=validateProviderTaskDelivery(task,action?.delivery);
          if(action?.kind!=='provider-startup'||action.targetPane!==route.pane||action.targetSession!==route.actualSession||
            action.targetLogicalRouteSession!==route.logicalRouteSession||!equal(action.targetOwnership,route.ownership)||
            !equal(action.startupTask,task)||action.providerBindingHash!==scope.hash||
            d.startupScope?.permission!=='granted'||!equal(d.startupScope.action,action)||
            !Array.isArray(d.startupScope.sourceEventIds)||!d.startupScope.sourceEventIds.length||
            d.startupScope.sourceEventIds.some(id=>!d.sourceEventIds.includes(id)||!s.entries.some(e=>e.event.originalId===id&&e.event.kind==='owner'&&e.event.verifiedHuman===true)))
            fail('missing-current-semantic-provider-startup-scope');
          if(!s.activation||s.activation.head!==s.head||s.activation.providerBindingHash!==scope.hash)fail('missing-provider-startup-reader-barrier');
          for(const [id,doc]of Object.entries(s.documents)) {
            if(digest(readFileSync(doc.path))!==doc.hash||!covered(s.reads.filter(r=>r.epoch===s.epoch&&r.head===s.head),this.resource(s,id)))
              fail('provider-startup-document-not-fully-served');
          }
          if(!covered(s.reads.filter(r=>r.epoch===s.epoch&&r.head===s.head),this.resource(s,'context')))fail('provider-startup-context-not-fully-served');
          s.providerActivationOperations??={};
          if(Object.values(s.providerActivationOperations).some(o=>o.lifecycleOperationId===op.id))fail('provider-startup-already-reserved; reconcile without retry');
          intent={id:randomUUID(),kind:p.type,head:s.head,through:s.entries.length,checkpointHash:cp.hash,decisionHash:d.hash,
            decisionRevision:d.revision,epoch:s.epoch,generation:cp.generation,providerBindingGeneration:scope.generation,
            providerBindingHash:scope.hash,providerBindingRevision:scope.revision,lifecycleOperationId:op.id,
            targetPane:route.pane,targetSession:route.actualSession,targetLogicalRouteSession:route.logicalRouteSession,
            targetOwnership:clone(route.ownership),startupTask:clone(task),frame,status:'committing',envelope:clone(envelope)};
          s.providerActivationOperations[intent.id]=clone(intent);
          this.#appendProviderTransition(s,{kind:'provider-startup-intent',originalId:`provider-startup-intent:${intent.id}`,
            acceptedAt:this.#clock(),operationId:intent.id,envelope:clone(envelope)});
          return clone(intent);
        },durable=>{
          try{receipt=this.#providerActivationAdapter(clone(durable));
            if(receipt&&typeof receipt.then==='function'){Promise.resolve(receipt).catch(()=>{});fail('thenable-provider-activation-receipt');}
            if(!equal(receipt,this.#providerActivationReceipt(durable)))fail('provider-activation-receipt-unverified');
          }catch(error){uncertain=String(error.message);}
          const current=this.state(),op=current.providerActivationOperations[durable.id];
          op.status=uncertain?'uncertain':'awaiting-boundary-confirmation';
          if(uncertain)op.error=uncertain;else op.receipt=clone(receipt);
          this.#persistState(current);
          if(uncertain)fail('provider-activation-outcome-unverified');
          return {operationId:durable.id,receipt:clone(receipt),comprehension:'unverified'};
        });
        return result;
      });active=false;
      if(wrapped&&typeof wrapped.then==='function'){Promise.resolve(wrapped).catch(()=>{});fail('thenable-source-serialization-unverified');}
      if(!entered||!equal(wrapped,result))fail('native-source-serialization-unverified');
      this.#transaction('provider-startup',s=>{const op=s.providerActivationOperations[intent.id];
        if(op.status!=='awaiting-boundary-confirmation')fail('provider-activation-confirmation-unverified');
        op.status='recorded';
        this.#appendProviderTransition(s,{kind:'provider-startup-released',originalId:`provider-startup-released:${op.id}`,
          acceptedAt:this.#clock(),operationId:op.id,providerBindingHash:op.providerBindingHash,receipt:clone(op.receipt),envelope:clone(op.envelope)});
      });return result;
    }catch(error){if(intent){try{this.#transaction('provider-startup',s=>{const op=s.providerActivationOperations[intent.id];op.status='uncertain';op.error=String(error.message);
      this.#invalidateProviderReadiness(s);});}catch{}fail(`uncertain-provider-activation:${intent.id}; reconcile without retry`);}throw error;
    }finally{active=false;}
  }
  reconcileProviderActivation(envelope) {
    return this.#transaction('provider-reconcile',s=>{
      const p=this.verify(s,'boundary','provider-startup-reconciliation',envelope),op=s.providerActivationOperations?.[p.operationId];
      if(!op||!['committing','uncertain','awaiting-boundary-confirmation'].includes(op.status)||p.head!==s.head||
        p.through!==s.entries.length||p.providerBindingHash!==s.providerScope?.hash||p.providerBindingHash!==op.providerBindingHash||
        !integer(p.expiresAt)||p.expiresAt<=this.#clock()||!['released','definitively-not-released'].includes(p.outcome))
        fail('provider-activation-reconciliation-unverified');
      if(p.outcome==='released') {
        if(!equal(p.receipt,this.#providerActivationReceipt(op)))fail('provider-activation-reconciliation-receipt-mismatch');
        op.status='recorded';op.receipt=clone(p.receipt);
        return {operationId:op.id,...this.#appendProviderTransition(s,{kind:'provider-startup-released',originalId:`provider-startup-reconciled:${op.id}:${digest(p)}`,
          acceptedAt:this.#clock(),operationId:op.id,providerBindingHash:op.providerBindingHash,receipt:clone(p.receipt),envelope:clone(op.envelope),reconciliation:clone(envelope)})};
      }
      op.status='not-released';
      return {operationId:op.id,...this.#appendProviderTransition(s,{kind:'provider-startup-not-released',originalId:`provider-startup-not-released:${op.id}:${digest(p)}`,
        acceptedAt:this.#clock(),operationId:op.id,envelope:clone(envelope)})};
    });
  }
  #appendAcceptedState(s,envelope) {
    if(Object.values(s.nativeInputOperations??{}).some(op=>!['recorded','quarantined'].includes(op.status)))
      fail('native-input-confirmation-unverified; retain input without forwarding or acknowledgement');
    if(Object.values(s.lifecycleOperations ?? {}).some(op=>op.status!=='recorded'))
      fail('lifecycle-routing-unconfirmed; retain input without forwarding or acknowledgement');
    if(Object.values(s.providerActivationOperations??{}).some(op=>!['recorded','not-released'].includes(op.status)))
      fail('provider-activation-unconfirmed; retain input without forwarding or acknowledgement');
    const p=this.verify(s,'ingress','accepted-event',envelope), e=p.event;
    if (!e?.originalId || !['owner','tool-result','provider-user-role','assistant-delivery'].includes(e.kind) || !integer(e.acceptedAt)) fail('missing-original-provenance');
    if (e.kind === 'owner' && e.verifiedHuman !== true) fail('unverified-owner');
    completeOriginal(e);
    const old=s.entries.find(x => x.event.originalId === e.originalId);
    if(old) {if(!equal(old.event,e)) fail('event-id-conflict');return {seq:old.seq,duplicate:true};}
    const previous=s.entries.findLast(x=>['sourceId','channel','session','pane'].every(k=>x.event.original?.[k]===e.original[k]));
    if(previous && e.original.sequence<=previous.event.original.sequence) fail('original-source-order-conflict');
    s.head=digest({previous:s.head,event:e});s.entries.push({seq:s.entries.length+1,head:s.head,event:e});
    // Bodies/attachments/quoted tool or document instructions remain source data.
    // Every accepted tail event invalidates readiness and unused approvals.
    return {seq:s.entries.length,head:s.head,duplicate:false,acknowledgeOnlyAfterDurableWrite:true};
  }
  appendAccepted(envelope) {
    return this.transaction(s=>this.#appendAcceptedState(s,envelope));
  }
  verifyNativeInput(envelope) {
    const s=this.state(),p=this.verify(s,'ingress','accepted-event',envelope);
    completeOriginal(p.event);
    const frame=validateNativeInputFrame(s.binding,p.event);
    const o=p.event.original,b=s.binding;
    if(![[b.sourcePane,b.sourceSession],[b.targetPane,b.targetSession]].some(([pane,logical])=>o.pane===pane&&o.logicalRouteSession===logical)||
      (o.pane===b.sourcePane&&o.session!==b.sourceSession))
      fail('native-input-origin-binding-mismatch');
    return {event:clone(p.event),frame,binding:clone(b),eventHash:digest(p.event)};
  }
  #nativeFramesPending(s,allowQuarantined=false) {
    const directory=join(this.dir,'native-input-pending');
    if(!existsSync(directory))return false;
    for(const name of readdirSync(directory).filter(name=>name.endsWith('.frame.json'))) {
      let frame;try{frame=JSON.parse(readFileSync(join(directory,name),'utf8'));}catch{return true;}
      const event=frame?.payload?.event;
      if(!event||!Object.values(s.nativeInputOperations??{}).some(op=>
        (op.status==='recorded'||allowQuarantined&&op.status==='quarantined')&&op.originalId===event.originalId&&op.eventHash===digest(event)))return true;
    }
    return false;
  }
  admitFramedInput(envelope,nativeBindingEnvelope) {
    const verified=this.verifyNativeInput(envelope);
    if(typeof this.#inputAdapter!=='function')fail('missing-native-input-adapter');
    if(this.#inputAdapter.constructor.name==='AsyncFunction')fail('async-native-input-adapter');
    if(typeof this.#withLifecycleSources!=='function')fail('missing-native-source-serialization');
    if(this.#withLifecycleSources.constructor.name==='AsyncFunction')fail('async-native-source-serialization');
    let intent,receipt,result,active=true,entered=false,uncertain;
    try {
      const wrapped=this.#withLifecycleSources(clone(verified.binding),()=>{
        if(!active||entered)fail('invalid-native-source-serialization');
        entered=true;
        result=this.#transaction('native-input',s=>{
          const {scope,route}=this.#providerTarget(s,false);
          const quarantined=Boolean(scope.lifecycleOperationId&&scope.activation?.status!=='released');
          const source=[scope.source,scope.target].find(r=>r&&r.pane===verified.event.original.pane&&
            r.logicalRouteSession===verified.event.original.logicalRouteSession&&r.actualSession===verified.event.original.session&&
            equal(r.ownership,verified.event.original.nativeOwnership));
          if(!source)fail('native-input-registered-source-mismatch');
          if(Object.values(s.nativeInputOperations??{}).some(op=>!['recorded','quarantined'].includes(op.status)))
            fail('unreconciled-native-input');
          const prior=Object.values(s.nativeInputOperations??{}).find(op=>op.originalId===verified.event.originalId);
          if(prior&&prior.eventHash!==verified.eventHash)fail('native-input-id-conflict');
          const native=this.verify(s,'boundary','native-input-binding',nativeBindingEnvelope);
          const currentTarget={targetPane:route.pane,targetSession:route.actualSession};
          if(native.originalId!==verified.event.originalId||native.eventHash!==verified.eventHash||
            !integer(native.expiresAt)||native.expiresAt<=this.#clock()||
            native.sourcePane!==verified.event.original.pane||native.sourceSession!==verified.event.original.session||
            !equal(native.sourceOwnership,verified.event.original.nativeOwnership)||
            native.targetPane!==currentTarget.targetPane||native.targetSession!==currentTarget.targetSession||
            native.targetLogicalRouteSession!==route.logicalRouteSession||native.sourceLogicalRouteSession!==source.logicalRouteSession||
            native.providerBindingHash!==scope.hash||
            !nativeOwnershipValid(native.targetOwnership)||native.targetOwnership.ptyId!==currentTarget.targetPane||
            !equal(native.targetOwnership,route.ownership)||
            (native.targetPane===native.sourcePane&&native.targetSession===native.sourceSession&&
              !equal(native.targetOwnership,native.sourceOwnership))||
            (verified.frame.questionCallId&&(native.questionCallId!==verified.frame.questionCallId||
              native.questionFrameSha256!==verified.frame.questionFrameSha256||
              typeof native.questionOwnership!=='string'||!native.questionOwnership)))
            fail('native-input-ownership-attestation-unverified');
          if(verified.frame.questionCallId){const q=scope.questions[route.logicalRouteSession];
            if(!q||verified.frame.questionCallId!==q.callId||verified.frame.questionFrameSha256!==q.frameSha256||
              verified.event.questionAnswer.questionToolName!==q.toolName||!equal(verified.event.questionAnswer.question,q.question)||
              native.questionOwnership!==providerQuestionOwnership(scope.hash,route,q))
              fail('native-question-current-registration-mismatch');}
          if(prior){
            if(prior.providerBindingHash!==scope.hash&&prior.providerRouteIdentityHash!==scope.routeIdentityHash)
              fail('native-input-retained-provider-scope-changed');
            if(prior.status==='recorded')return {duplicate:clone(prior)};
            if(prior.status!=='quarantined')fail('unreconciled-native-input');
            if(quarantined)return {quarantined:clone(prior),duplicate:true};
            // Resume the same durable operation only; never create a second write intent.
            intent={...clone(prior),providerBindingHash:scope.hash,acceptedHead:s.head,through:s.entries.length,status:'committing'};
            s.nativeInputOperations[intent.id]=clone(intent);return clone(intent);
          }
          const accepted=this.#appendAcceptedState(s,envelope);
          if(accepted.duplicate)fail('native-input-recorded-without-delivery-intent; reconcile');
          const target={targetPane:route.pane,targetSession:route.actualSession,operationId:scope.lifecycleOperationId,generation:scope.generation};
          intent={id:randomUUID(),originalId:verified.event.originalId,eventHash:verified.eventHash,
            acceptedHead:s.head,through:s.entries.length,sourcePane:verified.event.original.pane,
            sourceSession:verified.event.original.session,targetPane:target.targetPane,targetSession:target.targetSession,
            lifecycleOperationId:target.operationId??null,generation:target.generation??null,
            sourceOwnership:native.sourceOwnership,targetOwnership:native.targetOwnership,
            sourceLogicalRouteSession:source.logicalRouteSession,targetLogicalRouteSession:route.logicalRouteSession,providerBindingHash:scope.hash,
            providerRouteIdentityHash:scope.routeIdentityHash,
            questionOwnership:native.questionOwnership??null,
            frame:clone(verified.frame),status:quarantined?'quarantined':'committing',retainedAt:this.#clock()};
          s.nativeInputOperations??={};s.nativeInputOperations[intent.id]=intent;
          return quarantined?{quarantined:clone(intent),duplicate:false}:clone(intent);
        },durableIntent=>{
          if(durableIntent.quarantined)return {operationId:durableIntent.quarantined.id,status:'quarantined',acknowledged:false,
            forwarded:false,duplicate:durableIntent.duplicate,comprehension:'unverified'};
          if(durableIntent.duplicate)return {operationId:durableIntent.duplicate.id,duplicate:true,
            receipt:clone(durableIntent.duplicate.receipt),acknowledged:true,comprehension:'unverified'};
          try {
            receipt=this.#inputAdapter(clone(durableIntent));
            if(receipt&&typeof receipt.then==='function'){Promise.resolve(receipt).catch(()=>{});fail('thenable-native-input-receipt');}
            const expected=this.#nativeInputReceipt(durableIntent);
            if(!equal(receipt,expected))fail('native-input-write-receipt-unverified');
          } catch(error){uncertain=String(error.message);}
          const current=this.state(),op=current.nativeInputOperations[durableIntent.id];
          op.status=uncertain?'uncertain':'awaiting-boundary-confirmation';
          if(uncertain)op.error=uncertain;else op.receipt=clone(receipt);
          this.#persistState(current);
          if(uncertain)fail('native-input-outcome-unverified');
          return {operationId:durableIntent.id,duplicate:false,receipt:clone(receipt),comprehension:'unverified'};
        });
        return result;
      });
      active=false;
      if(wrapped&&typeof wrapped.then==='function'){Promise.resolve(wrapped).catch(()=>{});fail('thenable-source-serialization-unverified');}
      if(!entered||!equal(wrapped,result))fail('native-source-serialization-unverified');
      if(result.status==='quarantined')return result;
      if(result.duplicate)return result;
      this.#transaction('native-input',s=>{const op=s.nativeInputOperations[intent.id];
        if(op.status!=='awaiting-boundary-confirmation')fail('native-input-confirmation-unverified');op.status='recorded';});
      return {...result,acknowledged:true};
    } catch(error){
      if(intent){try{this.#transaction('native-input',s=>{const op=s.nativeInputOperations[intent.id];op.status='uncertain';op.error=String(error.message);});}catch{}
        fail(`uncertain-native-input:${intent.id}; reconcile without retry`);}
      throw error;
    } finally{active=false;}
  }
  updateDecision(envelope) {
    return this.transaction(s => {
      const p=this.verify(s,'policy','decision',envelope);
      if (p.head !== s.head || p.revision !== (s.decision?.revision ?? 0)+1) fail('stale-decision');
      if (typeof p.cancelled !== 'boolean' || !['unknowns','currentConstraints','supersededConstraints','pendingJobs','pendingQuestions'].every(k => Array.isArray(p[k])) || typeof p.nextStep !== 'string') fail('incomplete-decision');
      if(typeof p.conceptId !== 'string' || !p.conceptId) fail('missing-current-concept');
      if (p.pendingQuestions.some(q => !q.id || !['unanswered','answered'].includes(q.status) || !s.entries.some(e => e.event.originalId === q.sourceEventId && e.event.kind === 'owner'))) fail('question-provenance-missing');
      if (!Array.isArray(p.sourceEventIds) || !p.sourceEventIds.length || p.sourceEventIds.some(id => !s.entries.some(e => e.event.originalId === id))) fail('missing-decision-provenance');
      for (const [id,d] of Object.entries(s.documents)) if (p.documentHashes?.[id] !== d.hash) fail('decision-document-mismatch');
      // This structured view records current/superseded constraints, unknowns,
      // revocations, pending jobs and next step; it never supplies approval itself.
      s.decision={...p,hash:digest(p)};return {revision:p.revision,hash:s.decision.hash};
    });
  }
  activate(envelope) {
    return this.#transaction('reader-activation',s => {
      const p=this.verify(s,'boundary','activation',envelope);
      const {scope,route}=this.#providerTarget(s,false);
      if(p.providerBindingHash!==scope.hash||p.providerBindingGeneration!==scope.generation||p.providerBindingRevision!==scope.revision||
        p.providerSession!==route.actualSession||!equal(p.providerNativeOwnership,route.ownership))fail('startup-provider-registration-mismatch');
      if (!s.checkpoint || s.checkpoint.head !== s.head || s.checkpoint.decisionHash !== s.decision?.hash || p.generation !== s.checkpoint.generation || p.checkpointHash !== s.checkpoint.hash) fail('stale-or-missing-handoff');
      if (p.epoch !== s.epoch+1 || p.head !== s.head || p.startupSucceeded !== true || p.ingressSerialized !== true || p.documentsSerialized !== true || p.paidRoutes !== 'broker-only' || p.providerCostCapEnforced !== true) fail('missing-enforcement-boundary');
      if (!integer(p.expiresAt) || p.expiresAt <= this.#clock() || s.requiredCapabilities.some(k => p.capabilities?.[k] !== 'verified-success')) fail('startup-capability-missing');
      s.epoch=p.epoch;s.activation=p;s.reads=[];s.pendingReads={};return {epoch:s.epoch,head:s.head};
    });
  }
  seal() {
    return this.transaction(s => {
      if (!s.decision || s.decision.head !== s.head) fail('stale-decision');
      const checkpoint={generation:randomUUID(),binding:s.binding,head:s.head,through:s.entries.length,
        decisionHash:s.decision.hash,documentHashes:s.decision.documentHashes,
        cutoff:{lastEventId:s.entries.at(-1)?.event.originalId ?? null,acceptedAt:s.entries.at(-1)?.event.acceptedAt ?? null}};
      s.checkpoint={...checkpoint,hash:digest(checkpoint)};return clone(s.checkpoint);
    });
  }
  commitHandoff(envelope) {
    // This callback is owned by the trusted native host, never a tool argument.
    // Obvious async adapters cannot enter the durable lifecycle boundary.
    if(typeof this.#lifecycleAdapter !== 'function') fail('missing-native-lifecycle-boundary');
    if(this.#lifecycleAdapter.constructor.name === 'AsyncFunction') fail('async-native-lifecycle-boundary');
    // Private host ownership closure, not a signed agent assertion: every writer
    // of source frames, cancellation controls, documents and protected assets must
    // participate. Canonical PTY/control writers currently provide no such lease.
    if(typeof this.#withLifecycleSources !== 'function') fail('missing-native-source-serialization');
    if(this.#withLifecycleSources.constructor.name === 'AsyncFunction') fail('async-native-source-serialization');
    let entered=false,active=true,result,newIntent;
    try {
      const wrapped=this.#withLifecycleSources(clone(envelope?.payload?.binding),()=>{
        if(!active || entered) fail('invalid-native-source-serialization');
        entered=true;result=this.#commitHandoffOwned(envelope,id=>{newIntent=id;});return result;
      });
      active=false;
      if(wrapped && typeof wrapped.then==='function') {
        Promise.resolve(wrapped).catch(()=>{});
        fail('thenable-source-serialization-unverified');
      }
      if(!entered || !equal(wrapped,result)) fail('native-source-serialization-unverified');
      this.#transaction('handoff',s=>{
        const op=s.lifecycleOperations[newIntent];
        if(op.status!=='awaiting-boundary-confirmation')fail('native-lifecycle-confirmation-unverified');
        op.status='recorded';s.inputTarget=clone(op.pendingInputTarget);delete op.pendingInputTarget;
      });
      return result;
    } catch(error) {
      // A wrapper can initiate a synchronous effect then throw/return a thenable.
      // Its ownership outcome is uncertain even if the inner callback succeeded.
      if(newIntent) {
        try{this.#transaction('handoff',s=>{const op=s.lifecycleOperations[newIntent];op.status='uncertain';
          op.error=`native source ownership unverified: ${String(error.message)}`;});}catch{/* retained blocking status; no input ack or retry */}
        fail(`uncertain-lifecycle-outcome:${newIntent}; reconcile without retry`);
      }
      throw error;
    } finally {active=false;}
  }
  #commitHandoffOwned(envelope,onIntent) {
    let intent, outcome, uncertainty;
    this.#transaction('handoff',s => {
      const p=this.verify(s,'boundary','handoff-lifecycle-commit',envelope);
      this.#providerTarget(s);
      const checkpoint=s.checkpoint, decision=s.decision;
      if(this.#nativeFramesPending(s))fail('pending-native-input-frame; admit retained originals before handoff');
      if(Object.values(s.nativeInputOperations??{}).some(op=>op.status!=='recorded'))fail('unreconciled-native-input');
      if(!checkpoint || checkpoint.head!==s.head || checkpoint.through!==s.entries.length ||
        checkpoint.decisionHash!==decision?.hash || p.head!==s.head || p.through!==s.entries.length ||
        p.generation!==checkpoint.generation || p.checkpointHash!==checkpoint.hash ||
        p.decisionHash!==decision?.hash || p.decisionRevision!==decision?.revision)
        fail('stale-lifecycle-generation');
      if(!integer(p.expiresAt) || p.expiresAt<=this.#clock()) fail('expired-lifecycle-authority');
      if(decision.cancelled || decision.unknowns?.length || decision.pendingQuestions?.some(q=>q.status!=='answered'))
        fail('unresolved-lifecycle-scope');
      const h=p.action?.descriptor;
      if(!h || typeof h.path!=='string' || !h.path.startsWith('/') || h.path.includes('\0') ||
        !/^[a-f0-9]{64}$/.test(h.sha256??'') || !/^[a-f0-9-]{36}$/.test(h.generation??'') ||
        p.action.kind!=='self-handoff' || p.action.effect!=='start-and-archive' ||
        p.action.requestId!==s.binding.requestId || p.action.sourceSession!==s.binding.sourceSession ||
        p.action.sourcePane!==s.binding.sourcePane || p.action.targetSession!==s.binding.targetSession ||
        p.action.targetPane!==s.binding.targetPane) fail('wrong-lifecycle-action-binding');
      const draft=p.action.unsentDraft;
      if(!draft || typeof draft.text!=='string' || draft.submitted!==false || draft.bytes!==Buffer.byteLength(draft.text) ||
        draft.sha256!==digest(draft.text)) fail('unverified-unsent-draft');
      const startup=p.action.startupTask;
      if(!startup||typeof startup.text!=='string'||!startup.text||startup.bytes!==Buffer.byteLength(startup.text)||
        startup.sha256!==digest(startup.text))fail('unverified-withheld-startup-task');
      const capsule=readHandoffCapsule(h);
      if(capsule.manifest.provider!==s.binding.provider || capsule.manifest.parentPaneId!==s.binding.sourcePane ||
        capsule.manifest.source?.sessionId!==s.binding.sourceSession || !capsuleFreshness(capsule.manifest).ok)
        fail('unverified-native-capsule-binding');
      // Signed current policy supplies semantic scope. Source prose/agent flags cannot grant it.
      const scope=decision.lifecycleScope;
      if(scope?.permission!=='granted' || !equal(scope.action,p.action) || !Array.isArray(scope.sourceEventIds) ||
        !scope.sourceEventIds.length || scope.sourceEventIds.some(id=>!decision.sourceEventIds.includes(id) ||
          !s.entries.some(e=>e.event.originalId===id && e.event.kind==='owner' && e.event.verifiedHuman===true)))
        fail('missing-current-lifecycle-scope');
      for(const d of Object.values(s.documents)) if(digest(readFileSync(d.path))!==d.hash) fail('required-document-changed');
      s.lifecycleOperations ??= {};
      if(Object.values(s.lifecycleOperations).some(op=>op.action.requestId===p.action.requestId))
        fail('lifecycle-already-reserved; reconcile retained intent without retry');
      intent={id:randomUUID(),action:clone(p.action),actionHash:digest(p.action),head:s.head,through:s.entries.length,
        generation:checkpoint.generation,checkpointHash:checkpoint.hash,decisionHash:decision.hash,epoch:s.epoch,
        decisionRevision:decision.revision,status:'committing',committedAt:this.#clock()};
      s.lifecycleOperations[intent.id]=intent;return clone(intent);
    }, durableIntent => {
      onIntent(durableIntent.id);
      // appendAccepted cannot acknowledge or forward while this same lock is held.
      // The host must commit launch ownership AND archive ownership synchronously.
      try {
        outcome=this.#lifecycleAdapter(clone(durableIntent.action),clone(durableIntent));
        if(outcome && typeof outcome.then==='function') {
          Promise.resolve(outcome).catch(()=>{});
          fail('thenable-native-outcome-unverified');
        }
        const required={operationId:durableIntent.id,actionHash:durableIntent.actionHash,
          sourcePane:durableIntent.action.sourcePane,targetPane:durableIntent.action.targetPane,
          sourceSession:durableIntent.action.sourceSession,targetSession:durableIntent.action.targetSession,
          descriptor:durableIntent.action.descriptor,generation:durableIntent.generation,
          head:durableIntent.head,through:durableIntent.through,epoch:durableIntent.epoch,
          checkpointHash:durableIntent.checkpointHash,decisionHash:durableIntent.decisionHash,
          decisionRevision:durableIntent.decisionRevision,startOwnership:'committed',archiveOwnership:'committed',
          startupTask:{bytes:durableIntent.action.startupTask.bytes,sha256:durableIntent.action.startupTask.sha256,status:'withheld',submitted:false},
          unsentDraft:{sha256:durableIntent.action.unsentDraft.sha256,bytes:durableIntent.action.unsentDraft.bytes,
            targetPane:durableIntent.action.targetPane,targetSession:durableIntent.action.targetSession,
            status:'retained-unsent',submitted:false}};
        if(!equal(outcome,required))fail('native-lifecycle-outcome-unverified');
      } catch(error) {uncertainty=String(error.message);}
      // Persist outcome and authoritative input routing BEFORE releasing ingress lock.
      const current=this.state(),op=current.lifecycleOperations[durableIntent.id];
      op.status=uncertainty ? 'uncertain':'awaiting-boundary-confirmation';
      if(uncertainty)op.error=uncertainty;
      else {
        op.receipt=clone(outcome);
        op.pendingInputTarget={targetPane:op.action.targetPane,targetSession:op.action.targetSession,
          descriptor:op.action.descriptor,operationId:op.id,generation:op.generation};
      }
      try {this.#persistState(current);}catch(error){uncertainty='lifecycle-outcome-persistence-unverified';}
    });
    if(uncertainty) fail(`uncertain-lifecycle-outcome:${intent.id}; reconcile without retry`);
    return {operationId:intent.id,actionHash:intent.actionHash,head:intent.head,through:intent.through,
      generation:intent.generation,checkpointHash:intent.checkpointHash,decisionHash:intent.decisionHash,
      receipt:clone(outcome),comprehension:'unverified',paidAuthorization:'none'};
  }

  #retainedCapsuleContext(s) {
    const descriptor=s.inputTarget?.descriptor;
    if(!descriptor)return null;
    const capsule=readHandoffCapsule(descriptor);
    if(!capsuleFreshness(capsule.manifest).ok)fail('stale-observed-handoff-source');
    return {descriptor,manifest:capsule.manifest,
      files:[...capsule.contents].map(([name,text])=>({name,text})),originVerified:false,authorization:'none'};
  }
  resource(s,id) {
    let bytes;
    if (id === 'context') {
      if (!s.decision) fail('missing-structured-decision');
      bytes=Buffer.from(canonical({binding:s.binding,providerScope:s.providerScope??null,epoch:s.epoch,through:s.entries.length,head:s.head,
        structuredDecision:s.decision,originalEvents:s.entries,retainedHandoff:this.#retainedCapsuleContext(s),authorization:'none; source data'}));
    } else if(s.documents[id]) bytes=Buffer.from(s.documents[id].bytes,'base64');
    else fail('unknown-resource');
    return {id,bytes,hash:digest(bytes)};
  }
  serve(envelope) {
    return this.#transaction('reader-activation',s => {
      const p=this.verify(s,'transport','read-request',envelope);
      const {scope}=this.#providerTarget(s,false);
      if(s.activation?.providerBindingHash!==scope.hash)fail('stale-provider-reader');
      if (p.epoch !== s.epoch || !s.activation || !integer(p.expiresAt) || p.expiresAt <= this.#clock()) fail('stale-reader');
      const r=this.resource(s,p.resource);
      if (!integer(p.start) || !integer(p.end) || p.start >= p.end || p.end > r.bytes.length || p.end-p.start > 32768) fail('invalid-read-range');
      const bytes=r.bytes.subarray(p.start,p.end),receiptId=randomUUID();
      s.pendingReads[receiptId]={epoch:s.epoch,head:s.head,resource:r.id,resourceHash:r.hash,start:p.start,end:p.end,bytesHash:digest(bytes)};
      return {data:{mime:'application/octet-stream',base64:bytes.toString('base64'),sourceOnly:true},receiptId,...s.pendingReads[receiptId]};
    });
  }
  acknowledgeRead(envelope) {
    return this.#transaction('reader-activation',s => {
      const p=this.verify(s,'transport','read-receipt',envelope), pending=s.pendingReads[p.receiptId];
      if (!pending || !equal(p.delivery,pending) || p.success !== true || pending.epoch !== s.epoch || pending.head !== s.head) fail('read-not-delivered-or-stale');
      if (!s.reads.some(r => r.receiptId === p.receiptId)) s.reads.push({receiptId:p.receiptId,...pending});
      // Audit receipts do not advance the original-event source frontier.
      return {servedBytes:pending.end-pending.start,comprehension:'unverified',authorization:'none'};
    });
  }
  approve(envelope) {
    return this.transaction(s => {
      const p=this.verify(s,'approval','explicit-owner-approval',envelope);
      const e=s.entries.find(e => e.event.originalId === p.ownerEventId)?.event;
      if (!e || e.kind !== 'owner' || e.verifiedHuman !== true || p.actualOwnerInteraction !== true) fail('approval-has-no-owner-provenance');
      if (p.head !== s.head || p.epoch !== s.epoch || p.decisionHash !== s.decision?.hash || !integer(p.issuedAt) || !integer(p.expiresAt) || p.issuedAt < e.acceptedAt || p.issuedAt > this.#clock() || p.expiresAt <= this.#clock()) fail('stale-or-postdated-approval');
      if (!p.id || !/^[a-f0-9]{64}$/.test(p.actionHash) || !integer(p.maxCredits) || !p.maxCredits) fail('approval-scope-missing');
      if (s.approvals[p.id] && !equal(s.approvals[p.id],p)) fail('approval-id-conflict');
      s.approvals[p.id]=p;return {id:p.id,head:p.head};
    });
  }
  checkReady(s,action,approvalId) {
    const {scope}=this.#providerTarget(s);
    const now=this.#clock(),a=s.activation,approval=s.approvals[approvalId];
    if(this.#nativeFramesPending(s))fail('pending-native-input-frame; admit retained originals before spending');
    if(Object.values(s.lifecycleOperations ?? {}).some(op=>op.status!=="recorded")) fail("unreconciled-lifecycle-intent");
    if(Object.values(s.nativeInputOperations??{}).some(op=>op.status!=='recorded'))fail('unreconciled-native-input');
    if(!a || a.head !== s.head || a.expiresAt <= now || a.providerBindingHash!==scope.hash) fail('stale-or-missing-startup-barrier');
    if(!s.checkpoint || a.generation !== s.checkpoint.generation || a.checkpointHash !== s.checkpoint.hash || s.checkpoint.decisionHash !== s.decision?.hash) fail('stale-or-missing-handoff');
    if(!s.decision || s.decision.head !== s.head || s.decision.unknowns?.length || s.decision.cancelled === true) fail('unresolved-or-stale-decision');
    if(s.decision.pendingQuestions.some(q => q.status !== 'answered' || !s.entries.some(e => e.event.originalId === q.answerEventId && e.event.kind === 'assistant-delivery' && e.seq > s.entries.find(x => x.event.originalId === q.sourceEventId).seq))) fail('questions-not-answered-with-delivery-evidence');
    if(!approval || approval.head !== s.head || approval.epoch !== s.epoch || approval.decisionHash !== s.decision.hash || approval.expiresAt <= now || approval.actionHash !== digest(action)) fail('missing-current-exact-approval');
    if(action.decisionRevision !== s.decision.revision || action.conceptId !== s.decision.conceptId) fail('action-does-not-match-current-decision');
    if(action.provider !== 'magnific' || !['video_generate','images_generate'].includes(action.tool) || !action.input || !Array.isArray(action.assets) || action.assets.some(x => !x.id || !/^[a-f0-9]{64}$/.test(x.sha256)) || !integer(action.maximumCredits) || !action.maximumCredits || action.maximumCredits > approval.maxCredits) fail('invalid-action-or-budget');
    for(const [id,d] of Object.entries(s.documents)) {
      if(digest(readFileSync(d.path)) !== d.hash) fail('required-document-changed');
      if(!covered(s.reads.filter(r => r.epoch === s.epoch && r.head === s.head),this.resource(s,id))) fail('required-document-not-fully-served');
    }
    if(!covered(s.reads.filter(r => r.epoch === s.epoch && r.head === s.head),this.resource(s,'context'))) fail('original-context-not-fully-served');
    if(Object.values(s.operations).some(o => o.approvalId === approvalId)) fail('approval-already-consumed; reconcile retained intent');
    if(s.decision.pendingJobs.some(j=>!j || typeof j!=='object' || !j.actionHash ||
       (j.actionHash===digest(action)&&j.status!=='definitively-not-created')))
      fail('existing-job-or-unknown-job-scope; reconcile without resubmission');
    const reserved=Object.values(s.operations).reduce((sum,o) => sum+o.maximumCredits,0);
    if(reserved+action.maximumCredits > s.totalBudget) fail('project-budget-exhausted');
    if(Object.values(s.operations).some(o=>o.actionHash===digest(action)))
      fail('duplicate-exact-request; reconcile retained intent');
  }
  async dispatch(action,approvalId) {
    // Clone once before async policy work to prevent payload mutation after approval.
    const exact=clone(action);
    if(typeof this.#adapter !== 'function' || typeof this.#policy !== 'function') fail('missing-dispatch-or-policy-adapter');
    let timer;
    try {
      const allowed=await Promise.race([Promise.resolve().then(() => this.#policy(clone(exact))),new Promise((_,reject) => {timer=setTimeout(() => reject(Error('policy-timeout')),this.#timeoutMs);})]);
      if(allowed !== true) fail('policy-no-valid-allow');
    } finally {clearTimeout(timer);}
    let intent, initiated;
    this.transaction(s => {
      this.checkReady(s,exact,approvalId);
      intent={id:randomUUID(),approvalId,action:exact,actionHash:digest(exact),maximumCredits:exact.maximumCredits,
        head:s.head,through:s.entries.length,epoch:s.epoch,decisionHash:s.decision.hash,status:'dispatching',committedAt:this.#clock()};
      s.operations[intent.id]=intent;return clone(intent);
    }, durableIntent => {
      // The adapter is private to the host. Direct Bash/MCP/hosted credentials must
      // be inaccessible to the agent for a real broker-only deployment.
      try {initiated=Promise.resolve(this.#adapter(clone(exact),{operationId:durableIntent.id}));}
      catch(e) {initiated=Promise.reject(e);}
    });
    let result;
    try {
      result=await Promise.race([initiated,new Promise((_,reject) => {timer=setTimeout(() => reject(Error('provider-timeout')),this.#timeoutMs);})]);
      if(!result?.jobId || !integer(result.credits) || result.credits > exact.maximumCredits) fail('provider-outcome-unverified');
    } catch(e) {
      this.transaction(s => {s.operations[intent.id].status='uncertain';s.operations[intent.id].error='response unavailable or invalid; reconcile by operation ID, never auto-retry';});
      throw Error(`uncertain-provider-outcome:${intent.id}`);
    } finally {
      clearTimeout(timer);
    }
    this.transaction(s => {s.operations[intent.id].status='recorded';s.operations[intent.id].receipt=clone(result);});
    return {operationId:intent.id,receipt:result,authorizationSource:this.state().approvals[approvalId].ownerEventId};
  }
}
