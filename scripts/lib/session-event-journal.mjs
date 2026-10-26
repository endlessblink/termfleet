import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {statusDir,fnv} from './agent-status-paths.mjs';
import {createSessionState} from '../../shared/sessionState.mjs';
import {reduceSessionEnvelope} from '../../shared/sessionEnvelope.mjs';
import {sessionObservationEnvelope} from '../../shared/sessionObservation.mjs';
import {recordSessionSoak} from './session-soak.mjs';

export const sessionEventHeadName=paneId=>`events-${fnv(paneId)}.json`;
const read=file=>{try{return JSON.parse(readRegularFile(file).toString('utf8'));}catch(error){if(error.code==='ENOENT' || error instanceof SyntaxError) return null;throw error;}};
const clean=value=>typeof value==='string' && value.trim() ? value.trim() : null;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const journalName=(paneId,provider,sessionId,runId)=>`events-${fnv(paneId)}-${provider}-${fnv(sessionId)}-${runId}.jsonl`;
const pendingName=(paneId,provider,captureId)=>`events-${fnv(paneId)}-${provider}-pending-${captureId}.json`;
const sameIdentity=(a,b)=>a && b && ['paneId','sessionId','runId','epoch'].every(key=>a[key]===b[key]);

/** Source data is observed and uninterpreted. It confers no human/approval trust.
 * Hook callers supply original bytes; native plugins supply an explicitly labelled
 * JSON snapshot of their complete callback object, never invented wire bytes. */
function captureSource(payload,rawSource,nativeSource,observation) {
 let bytes,format;
 if(rawSource!==undefined) {
  if(!Buffer.isBuffer(rawSource)) throw new Error('source bytes must be a Buffer');
  bytes=Buffer.from(rawSource);format='hook-stdin-bytes';
  let decoded;try {decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch {throw new Error('source bytes are not complete UTF-8 JSON');}
  if(JSON.stringify(decoded)!==JSON.stringify(payload)) throw new Error('source bytes/payload mismatch');
 } else {
  const value=nativeSource!==undefined ? nativeSource : observation!==undefined ? {payload,observation} : payload;
  const serialized=JSON.stringify(value);
  if(typeof serialized!=='string') throw new Error('source object is not serializable');
  bytes=Buffer.from(serialized,'utf8');
  format=nativeSource!==undefined ? 'native-plugin-object-json' : observation!==undefined ? 'native-observation-object-json' : 'parsed-payload-object-json';
 }
 return {version:1,trust:'observed',interpretation:'uninterpreted',format,bytes:bytes.length,sha256:digest(bytes),data:{encoding:'base64',base64:bytes.toString('base64')}};
}
// A structured failed tool result remains retained source data and cannot
// discharge the current question. No answer words or approval keywords are parsed.
function hasToolResultError(value) {
 if(!value || typeof value!=='object') return false;
 if(['error','is_error','isError'].some(key=>value[key]!=null && value[key]!==false && value[key]!=='' && value[key]!==0)) return true;
 return ['tool_response','tool_result','rawResult','result'].some(key=>hasToolResultError(value[key]));
}
function captureMetadata(capture) {
 if(!capture) return undefined;
 const {data,...metadata}=capture;return metadata;
}
function projection(event) {
 return {...event,...(event.sourceCapture ? {sourceCapture:captureMetadata(event.sourceCapture)} : {})};
}
const recoveryKind='source.recovery-boundary';
function completeLines(bytes,offset=0) {
 const all=[];let start=0;
 for(let end=bytes.indexOf(10,start);end>=0;end=bytes.indexOf(10,start)) {
  const raw=bytes.subarray(start,end+1);let event;
  try {event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch {}
  all.push({event,offset:start,raw});start=end+1;
 }
 const rows=[];
 for(let index=0;index<all.length;index++) {
  const row=all[index],marker=row.event;
  if(marker?.kind!==recoveryKind) {if(marker)rows.push(row);continue;}
  const prior=all[index-1],r=marker.recovery;
  if(marker.version!==1 || !['codex','claude','opencode'].includes(marker.provider) || !clean(marker.journalIdentity?.paneId) || !clean(marker.journalIdentity?.sessionId) ||
   !/^[a-zA-Z0-9-]{1,64}$/.test(marker.journalIdentity?.runId??'') || !prior || !r || !Number.isSafeInteger(r.offset) || r.offset<0 ||
   !Number.isSafeInteger(r.bytes) || r.bytes<1 || !/^[a-f0-9]{64}$/.test(r.sha256??'') || r.offset!==prior.offset || !Number.isSafeInteger(marker.precedingThroughSeq) || marker.precedingThroughSeq<0)
   throw new Error('source recovery boundary invalid');
  if(marker.status==='quarantined-incomplete') {
   const unknown=prior.raw.subarray(0,-1);
   if(marker.completeOriginal!==false || marker.sourceCaptured!==false || r.bytes!==unknown.length || r.offset+r.bytes+1!==row.offset || digest(unknown)!==r.sha256 ||
    marker.nextSeq!==marker.precedingThroughSeq+1) throw new Error('source quarantine bytes/binding invalid');
   // Even syntactically valid JSON without a committed newline is uncommitted.
   // The explicit boundary suppresses that row instead of silently replaying it.
   if(rows.at(-1)?.offset===prior.offset)rows.pop();
   rows.push({...row,quarantine:{version:1,status:'quarantined-incomplete',completeOriginal:false,sourceCaptured:false,offset:r.offset,bytes:unknown.length,sha256:r.sha256,data:{encoding:'base64',base64:unknown.toString('base64')}}});
  } else if(marker.status==='reconstructed-from-retained-original') {
   const originalPrefix=prior.raw.subarray(0,r.bytes),event=prior.event;
   if(marker.completeOriginal!==true || marker.sourceCaptured!==true || r.bytes>=prior.raw.length-1 || digest(originalPrefix)!==r.sha256 ||
    event?.captureId!==r.captureId || event?.seq!==marker.precedingThroughSeq || !event.sourceCapture ||
    !['paneId','sessionId','runId'].every(key=>event.identity?.[key]===marker.journalIdentity[key]) || event.provider!==marker.provider ||
    !originalPrefix.includes(Buffer.from('"captureId":"'+r.captureId+'"'))) throw new Error('source reconstruction bytes/binding invalid');
   rows.push({...row,reconstruction:{version:1,status:marker.status,completeOriginal:true,sourceCaptured:true,captureId:r.captureId,offset:r.offset,bytes:r.bytes,sha256:r.sha256,data:{encoding:'base64',base64:originalPrefix.toString('base64')}}});
  } else throw new Error('source recovery status invalid');
 }
 return rows.filter(row=>row.offset>=offset);
}
function sourceReference(event,journal,offset,raw) {
 if(!event.sourceCapture) return undefined;
 return {version:1,provider:event.provider ?? event.producer.split('-')[0],identity:event.identity,id:event.id,seq:event.seq,
  journal,offset,recordBytes:raw.length,recordSha256:digest(raw),...(event.captureId ? {captureId:event.captureId}:{}),...captureMetadata(event.sourceCapture)};
}
function appendRecord(dir,event) {
 const name=journalName(event.identity.paneId,event.provider ?? event.producer.split('-')[0],event.identity.sessionId,event.identity.runId),file=path.join(dir,name);
 const fd=fs.openSync(file,fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_RDWR|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK,0o600);
 const raw=Buffer.from(JSON.stringify(event)+'\n','utf8');let offset,throughBytes;
 try {
  const stat=fs.fstatSync(fd);if(!stat.isFile()) throw new Error('source journal is not a regular file');
  const last=Buffer.alloc(1);if(stat.size)fs.readSync(fd,last,0,1,stat.size-1);
  if(stat.size && last[0]!==10) {
   const all=fs.readFileSync(fd),after=fs.fstatSync(fd);
   if(all.length!==stat.size || after.size!==stat.size || after.mtimeMs!==stat.mtimeMs)throw new Error('source recovery changed or incomplete');
   const prefixBytes=all.lastIndexOf(10)+1,torn=all.subarray(prefixBytes);
   // A retained proposal can complete its own exact append only when the torn
   // prefix contains its exact capture ID and matches the full proposed row.
   // A short/unattributed prefix is unknown source, never inferred owner intent.
   const reconstructed=!!event.captureId && torn.length<raw.length-1 && raw.subarray(0,torn.length).equals(torn) && torn.includes(Buffer.from('"captureId":"'+event.captureId+'"'));
   const boundary={version:1,kind:recoveryKind,provider:event.provider,journalIdentity:{paneId:event.identity.paneId,sessionId:event.identity.sessionId,runId:event.identity.runId},
    status:reconstructed ? 'reconstructed-from-retained-original':'quarantined-incomplete',completeOriginal:reconstructed,sourceCaptured:reconstructed,
    precedingThroughSeq:reconstructed ? event.seq:event.seq-1,...(!reconstructed ? {nextSeq:event.seq}:{}),
    recovery:{offset:prefixBytes,bytes:torn.length,sha256:digest(torn),...(reconstructed ? {captureId:event.captureId}:{})}};
   const marker=Buffer.from(JSON.stringify(boundary)+'\n');
   offset=reconstructed ? prefixBytes:all.length+1+marker.length;
   const replacement=reconstructed ? Buffer.concat([all.subarray(0,prefixBytes),raw,marker]):Buffer.concat([all,Buffer.from('\n'),marker,raw]);
   // Publish the whole repaired file atomically. A crash before rename leaves
   // the original torn bytes and immutable pending source untouched; a crash
   // after rename leaves one complete source row plus a verifiable boundary.
   const temporary=`${file}.${process.pid}.${randomUUID()}.recovery.tmp`;
   const out=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
   try {fs.writeFileSync(out,replacement);fs.fsyncSync(out);}finally {fs.closeSync(out);}
   const current=fs.lstatSync(file);
   if(!current.isFile() || current.ino!==after.ino || current.dev!==after.dev || current.size!==after.size || current.mtimeMs!==after.mtimeMs)throw new Error('source recovery path changed');
   fs.renameSync(temporary,file);throughBytes=replacement.length;
  } else {
   offset=stat.size;fs.writeFileSync(fd,raw);fs.fsyncSync(fd);throughBytes=offset+raw.length;
  }
 } finally {fs.closeSync(fd);}
 syncDirectory(dir);
 return {journal:name,bytes:throughBytes,reference:sourceReference(event,name,offset,raw)};
}
function readRegularFile(file) {
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try {
  const before=fs.fstatSync(fd);
  if(!before.isFile()) throw Object.assign(new Error('source path is not a regular file'),{code:'EJOURNALTYPE'});
  const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
  if(bytes.length!==before.size || before.size!==after.size || before.mtimeMs!==after.mtimeMs) throw Object.assign(new Error('source read changed or incomplete'),{code:'EJOURNALINCOMPLETE'});
  return bytes;
 } finally {fs.closeSync(fd);}
}
async function acquirePaneJournalLock(dir,paneId) {
 fs.mkdirSync(dir,{recursive:true});
 const lock=path.join(dir,sessionEventHeadName(paneId))+'.lock';
 for(let attempt=0;attempt<100;attempt++) {
  try {
   fs.mkdirSync(lock);
   try {fs.writeFileSync(path.join(lock,'owner'),String(process.pid));}catch(error){fs.rmSync(lock,{recursive:true,force:true});throw error;}
   return ()=>fs.rmSync(lock,{recursive:true,force:true});
  } catch(error) {
   if(error.code!=='EEXIST') throw error;
   const owner=Number(fs.existsSync(path.join(lock,'owner')) ? fs.readFileSync(path.join(lock,'owner'),'utf8'):0);
   if(owner>1) {try {process.kill(owner,0);}catch(e){if(e.code==='ESRCH'){fs.rmSync(lock,{recursive:true,force:true});continue;}}}
   await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 throw Object.assign(new Error('session event journal busy; event not acknowledged'),{code:'EJOURNALBUSY'});
}

/** Exact full-record reader inside the existing journal namespace. Every failure
 * returns an explicit incomplete/error receipt with no data, never a partial read.
 * A complete receipt verifies record bytes, identity, source bytes and both hashes. */
export function readSessionSourceRecord({paneId,provider,reference,dir=statusDir()}) {
 const error=reason=>({version:1,ok:false,complete:false,truncated:false,status:'error',error:reason,trust:'observed'});
 let fd;
 try {
  const r=reference;
  if(!r || r.version!==1 || !['codex','claude','opencode'].includes(provider) || r.provider!==provider ||
   r.identity?.paneId!==paneId || !clean(paneId) || !clean(r.identity?.sessionId) || !/^[a-zA-Z0-9-]{1,64}$/.test(r.identity?.runId ?? '') ||
   !Number.isSafeInteger(r.identity.epoch) || r.identity.epoch<0 || !Number.isSafeInteger(r.seq) || r.seq<1 || !clean(r.id) ||
   !Number.isSafeInteger(r.offset) || r.offset<0 || !Number.isSafeInteger(r.recordBytes) || r.recordBytes<1 ||
   !Number.isSafeInteger(r.bytes) || r.bytes<0 || !/^[a-f0-9]{64}$/.test(r.recordSha256 ?? '') || !/^[a-f0-9]{64}$/.test(r.sha256 ?? '') ||
   r.journal!==journalName(paneId,provider,r.identity.sessionId,r.identity.runId)) return error('invalid-source-reference');
  fd=fs.openSync(path.join(dir,r.journal),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile() || r.offset+r.recordBytes>stat.size || !Number.isSafeInteger(r.offset+r.recordBytes)) return error('source-record-incomplete');
  const journalBytes=fs.readFileSync(fd),after=fs.fstatSync(fd);
  if(journalBytes.length!==stat.size || after.size!==stat.size || after.mtimeMs!==stat.mtimeMs) return error('source-journal-changed-or-incomplete');
  // A reference cannot make a quarantined, formerly unterminated JSON row
  // into a committed original by stopping before its recovery boundary.
  if(!completeLines(journalBytes).some(row=>row.offset===r.offset && row.raw.length===r.recordBytes && row.event.kind!==recoveryKind)) return error('source-record-not-committed');
  const raw=Buffer.alloc(r.recordBytes);let copied=0;
  while(copied<raw.length) {const n=fs.readSync(fd,raw,copied,raw.length-copied,r.offset+copied);if(!n) return error('source-record-incomplete');copied+=n;}
  if(raw[raw.length-1]!==10 || digest(raw)!==r.recordSha256) return error('source-record-hash-mismatch');
  const event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const c=event.sourceCapture;
  if(!sameIdentity(event.identity,r.identity) || event.id!==r.id || event.seq!==r.seq || event.provider!==provider || (r.captureId!==undefined && event.captureId!==r.captureId) ||
   !c || c.version!==1 || !['hook-stdin-bytes','native-plugin-object-json','native-observation-object-json','parsed-payload-object-json'].includes(c.format) || c.trust!=='observed' || c.interpretation!=='uninterpreted' || c.format!==r.format ||
   c.bytes!==r.bytes || c.sha256!==r.sha256 || c.data?.encoding!=='base64' || typeof c.data.base64!=='string') return error('source-record-binding-mismatch');
  const bytes=Buffer.from(c.data.base64,'base64');
  if(bytes.toString('base64')!==c.data.base64 || bytes.length!==r.bytes || digest(bytes)!==r.sha256) return error('source-bytes-hash-mismatch');
  // Reject invalid/truncated JSON/UTF-8 even when a caller supplied matching hashes.
  JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  return {version:1,ok:true,complete:true,truncated:false,status:'complete',trust:'observed',interpretation:'uninterpreted',
   provider,identity:event.identity,id:event.id,seq:event.seq,at:event.at,...(event.captureId ? {captureId:event.captureId}:{}),format:c.format,bytes:bytes.length,sha256:c.sha256,
   recordBytes:raw.length,recordSha256:r.recordSha256,data:{encoding:'base64',base64:c.data.base64}};
 } catch(e) {return error(e.code ?? 'source-record-error');}
 finally {if(fd!==undefined) fs.closeSync(fd);}
}
/** Read a complete committed prefix with an explicit sequence/byte watermark.
 * Legacy or broken rows cannot become a claim that their original was fully read.
 * This uses the same journal namespace and individual exact-byte receipts. */
export function readSessionSourceJournal({paneId,provider,identity,throughSeq,throughBytes,dir=statusDir()}) {
 const error=reason=>({version:1,ok:false,complete:false,truncated:false,status:'error',error:reason,trust:'observed'});
 let fd;
 try {
  if(!['codex','claude','opencode'].includes(provider) || identity?.paneId!==paneId || !clean(paneId) || !clean(identity?.sessionId) ||
   !/^[a-zA-Z0-9-]{1,64}$/.test(identity?.runId ?? '') || !Number.isSafeInteger(identity.epoch) || identity.epoch<0 ||
   !Number.isSafeInteger(throughSeq) || throughSeq<1 || !Number.isSafeInteger(throughBytes) || throughBytes<1) return error('invalid-source-watermark');
  const name=journalName(paneId,provider,identity.sessionId,identity.runId);
  fd=fs.openSync(path.join(dir,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  const stat=fs.fstatSync(fd);if(!stat.isFile() || throughBytes>stat.size) return error('source-journal-incomplete');
  const all=fs.readFileSync(fd),after=fs.fstatSync(fd);
  if(all.length!==stat.size || after.size!==stat.size || after.mtimeMs!==stat.mtimeMs) return error('source-journal-changed-or-incomplete');
  const bytes=all.subarray(0,throughBytes);
  if(bytes[bytes.length-1]!==10) return error('source-journal-incomplete');
  const rows=completeLines(all).filter(row=>row.offset+row.raw.length<=throughBytes),receipts=[],quarantines=[],reconstructions=[];let end=0;
  for(const row of rows) {
   if(row.event.kind===recoveryKind) {
    const marker=row.event;
    if(marker.provider!==provider || !['paneId','sessionId','runId'].every(key=>marker.journalIdentity?.[key]===identity[key]) || marker.precedingThroughSeq!==receipts.length) return error('source-recovery-scope-or-sequence');
    if(row.quarantine) {if(row.quarantine.offset!==end || row.quarantine.offset+row.quarantine.bytes+1!==row.offset)return error('source-quarantine-gap-or-binding');quarantines.push(row.quarantine);}
    else {if(row.offset!==end)return error('source-reconstruction-gap-or-binding');reconstructions.push(row.reconstruction);}
    end=row.offset+row.raw.length;continue;
   }
   if(row.offset!==end || row.event.version!==2 || row.event.provider!==provider ||
    !['paneId','sessionId','runId'].every(key=>row.event.identity?.[key]===identity[key]) || row.event.seq!==receipts.length+1 || row.event.seq>throughSeq) return error('source-journal-gap-or-binding');
   const reference=sourceReference(row.event,name,row.offset,row.raw);
   if(!reference) return error('legacy-source-not-captured');
   const receipt=readSessionSourceRecord({paneId,provider,reference,dir});if(!receipt.ok || !receipt.complete) return error(receipt.error);
   receipts.push({...receipt,reference});end=row.offset+row.raw.length;
  }
  if(end!==bytes.length || receipts.length!==throughSeq) return error('source-journal-gap-or-binding');
  const completeOriginalHistory=quarantines.length===0;
  return {version:1,ok:true,complete:completeOriginalHistory,truncated:!completeOriginalHistory,status:completeOriginalHistory ? 'complete':'quarantined-history-gap',trust:'observed',interpretation:'uninterpreted',
   coverage:'committed-source-records',completeCapturedSources:true,completeOriginalHistory,provider,identity,throughSeq,throughBytes,journal:name,bytes:bytes.length,sha256:digest(bytes),records:receipts,quarantines,reconstructions};
 } catch(e) {return error(e.code ?? 'source-journal-error');}
 finally {if(fd!==undefined) fs.closeSync(fd);}
}
/** Snapshot every existing source journal for an exact pane/provider under the
 * publisher's existing per-pane lock. Content identity, full bytes and ordered
 * record receipts are validated; filenames alone never establish coverage.
 * Known previous watermarks can expose a removed journal as an explicit gap. */
export async function enumerateSessionSourceJournals(options) {
 let release;
 try {
  release=await acquirePaneJournalLock(options.dir ?? statusDir(),options.paneId);
  return snapshotSessionSourceJournals(options);
 } catch(e) {return {version:1,ok:false,complete:false,truncated:false,status:'error',error:e.code ?? 'source-journal-enumeration-error',trust:'observed'};}
 finally {release?.();}
}
// Synchronous exact-byte observation for existing consumer fences. This is not
// ownership: the private native host still holds the participating source lease.
export function snapshotSessionSourceJournals({paneId,provider,expectedWatermarks=[],dir=statusDir()}) {
 const error=reason=>({version:1,ok:false,complete:false,truncated:false,status:'error',error:reason,trust:'observed'});
 if(!clean(paneId) || !['codex','claude','opencode'].includes(provider) || !Array.isArray(expectedWatermarks)) return error('invalid-source-scope');
 try {
  const pendingBefore=pendingSnapshot({paneId,provider,dir});
  if(pendingBefore.entries.length) return {...error('pending-source-unadmitted'),pendingWatermark:pendingBefore.watermark};
  const headPath=path.join(dir,sessionEventHeadName(paneId)),head=read(headPath);
  if(fs.existsSync(headPath) && !head) return error('source-head-invalid');
  if(head?.identity?.paneId && head.identity.paneId!==paneId) return error('source-head-binding-collision');
  const expected=[...expectedWatermarks,...[head?.sourceRecord,head?.lastRetainedSource].filter(r=>r?.provider===provider)];
  const names=fs.readdirSync(dir).filter(name=>name.startsWith(`events-${fnv(paneId)}-${provider}-`) && name.endsWith('.jsonl')).sort();
  const journals=[];
  for(const name of names) {
   if(!new RegExp(`^events-${fnv(paneId)}-${provider}-[a-f0-9]{8}-[a-zA-Z0-9-]{1,64}\\.jsonl$`).test(name)) return error('invalid-source-journal-name');
   let fd,bytes;
   try {
    fd=fs.openSync(path.join(dir,name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=fs.fstatSync(fd);if(!before.isFile()) return error('source-journal-not-regular');
    bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd);
    if(bytes.length!==before.size || before.size!==after.size || before.mtimeMs!==after.mtimeMs) return error('source-journal-changed-or-incomplete');
   } finally {if(fd!==undefined) fs.closeSync(fd);}
   if(!bytes.length || bytes[bytes.length-1]!==10) return error('source-journal-incomplete');
   const rows=completeLines(bytes),last=rows.filter(row=>row.event.kind!==recoveryKind).at(-1)?.event;
   if(!last?.identity || last.identity.paneId!==paneId || last.provider!==provider || name!==journalName(paneId,provider,last.identity.sessionId,last.identity.runId)) return error('source-journal-binding-mismatch');
   const receipt=readSessionSourceJournal({paneId,provider,identity:last.identity,throughSeq:last.seq,throughBytes:bytes.length,dir});
   if(!receipt.ok || !receipt.completeCapturedSources) return error(receipt.error);
   journals.push(receipt);
  }
  for(const r of expected) {
   const reference=r.reference ?? r;
   if(reference.identity?.paneId!==paneId || reference.provider!==provider) return error('expected-source-scope-mismatch');
   if(!journals.some(j=>j.journal===reference.journal)) return error('expected-source-journal-missing');
   if(reference.throughSeq!==undefined || reference.throughBytes!==undefined) {
    const receipt=readSessionSourceJournal({paneId,provider,identity:reference.identity,throughSeq:reference.throughSeq,throughBytes:reference.throughBytes,dir});
    if(!receipt.ok) return error(receipt.error);
    if(receipt.journal!==reference.journal || receipt.sha256!==reference.sha256) return error('expected-source-watermark-mismatch');
   } else {
    const receipt=readSessionSourceRecord({paneId,provider,reference,dir});if(!receipt.ok) return error(receipt.error);
   }
  }
  const pendingAfter=pendingSnapshot({paneId,provider,dir});
  if(pendingAfter.entries.length || pendingAfter.watermark.sha256!==pendingBefore.watermark.sha256) return {...error('pending-source-arrived-during-snapshot'),pendingWatermark:pendingAfter.watermark};
  const completeOriginalHistory=journals.every(j=>j.completeOriginalHistory);
  return {version:1,ok:true,complete:completeOriginalHistory,truncated:!completeOriginalHistory,status:completeOriginalHistory ? 'complete':'quarantined-history-gap',trust:'observed',interpretation:'uninterpreted',pendingWatermark:pendingAfter.watermark,completeCapturedSources:true,completeOriginalHistory,
   coverage:'existing-journal-captures-only',directory:path.resolve(dir),paneId,provider,journals,watermarks:journals.map(j=>({provider,identity:j.identity,journal:j.journal,throughSeq:j.throughSeq,throughBytes:j.throughBytes,sha256:j.sha256}))};
 } catch(e) {return error(e.code ?? 'source-journal-enumeration-error');}
}
function persistHead(file,head,dir) {
 const temporary=`${file}.${process.pid}.${randomUUID()}.tmp`,fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try {fs.writeFileSync(fd,JSON.stringify(head));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temporary,file);
 const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
/** Immutable observed retention lives beside the existing source journals. It is
 * not admission, delivery, human proof or approval. Publication precedes the pane
 * admission lock so a busy or exiting hook cannot discard a complete original. */
function syncDirectory(dir) {
 const fd=fs.openSync(dir,'r');try {fs.fsyncSync(fd);}finally {fs.closeSync(fd);}
}
function retainPendingSource(record,dir) {
 fs.mkdirSync(dir,{recursive:true});
 const name=pendingName(record.identity.paneId,record.identity.provider,record.captureId);
 const file=path.join(dir,name),temporary=`${file}.${process.pid}.${randomUUID()}.tmp`;
 const raw=Buffer.from(JSON.stringify(record)+'\n','utf8');
 const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
 try {fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally {fs.closeSync(fd);}
 try {fs.linkSync(temporary,file);syncDirectory(dir);}finally {fs.unlinkSync(temporary);syncDirectory(dir);}
 return {version:1,status:'retained-unadmitted',retained:true,admitted:false,acknowledged:false,forwarded:false,
  trust:'observed',interpretation:'uninterpreted',captureId:record.captureId,identity:record.identity,at:record.at,retainedAt:record.retainedAt,
  pending:name,pendingBytes:raw.length,pendingSha256:digest(raw),...captureMetadata(record.sourceCapture)};
}
function pendingSnapshot({paneId,provider,dir}) {
 const prefix=`events-${fnv(paneId)}-${provider}-pending-`;
 const names=fs.readdirSync(dir).filter(name=>name.startsWith(prefix) && name.endsWith('.json')).sort();
 const entries=[];
 for(const name of names) {
  const raw=readRegularFile(path.join(dir,name));
  if(!raw.length || raw.at(-1)!==10) throw new Error('pending source incomplete');
  const record=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),c=record.sourceCapture,i=record.identity;
  if(record.version!==1 || record.kind!=='session-source-pending' || record.trust!=='observed' || record.interpretation!=='uninterpreted' ||
   !/^[a-f0-9-]{36}$/.test(record.captureId ?? '') || i?.paneId!==paneId || i.provider!==provider || !clean(i.sessionId) ||
   (i.runId!==null && !/^[a-zA-Z0-9-]{1,64}$/.test(i.runId ?? '')) || !Number.isFinite(record.at) || !Number.isFinite(record.retainedAt) ||
   name!==pendingName(paneId,provider,record.captureId) || !c || c.version!==1 || c.trust!=='observed' || c.interpretation!=='uninterpreted' ||
   c.data?.encoding!=='base64' || typeof c.data.base64!=='string' || !Number.isSafeInteger(c.bytes) || c.bytes<0 || !/^[a-f0-9]{64}$/.test(c.sha256 ?? '')) throw new Error('pending source binding invalid');
  const bytes=Buffer.from(c.data.base64,'base64');
  if(bytes.toString('base64')!==c.data.base64 || bytes.length!==c.bytes || digest(bytes)!==c.sha256) throw new Error('pending source bytes invalid');
  // Re-check the captured source and its status projection before recovery.
  const decoded=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!['hook-stdin-bytes','native-plugin-object-json','native-observation-object-json','parsed-payload-object-json'].includes(c.format) ||
   (c.format==='hook-stdin-bytes' || c.format==='parsed-payload-object-json') && JSON.stringify(decoded)!==JSON.stringify(record.payload)) throw new Error('pending source payload mismatch');
  entries.push({record,name,bytes:raw.length,sha256:digest(raw)});
 }
 const files=entries.map(({name,bytes,sha256})=>({name,bytes,sha256}));
 return {entries,watermark:{version:1,paneId,provider,files,sha256:digest(Buffer.from(JSON.stringify(files)))}};
}
/** A pending snapshot returns complete observed bytes but never an admitted
 * journal sequence. The exact immutable file frontier is available for fencing. */
export function readSessionSourcePending({paneId,provider,dir=statusDir()}) {
 try {
  if(!clean(paneId) || !['codex','claude','opencode'].includes(provider)) throw new Error('invalid pending source scope');
  const {entries,watermark}=pendingSnapshot({paneId,provider,dir});
  return {version:1,ok:true,complete:true,status:'retained-unadmitted',admitted:false,acknowledged:false,forwarded:false,trust:'observed',interpretation:'uninterpreted',watermark,
   records:entries.map(({record,name,bytes,sha256})=>({captureId:record.captureId,identity:record.identity,at:record.at,retainedAt:record.retainedAt,pending:name,pendingBytes:bytes,pendingSha256:sha256,...record.sourceCapture}))};
 } catch(error) {return {version:1,ok:false,complete:false,status:'error',error:error.code ?? error.message,trust:'observed'};}
}
function findCommittedCapture(record,dir) {
 const {paneId,provider,sessionId}=record.identity;let found;
 const names=fs.readdirSync(dir).filter(name=>name.startsWith(`events-${fnv(paneId)}-${provider}-`) && name.endsWith('.jsonl'));
 for(const name of names) {
  for(const row of completeLines(readRegularFile(path.join(dir,name)))) {
   const event=row.event;if(event.captureId!==record.captureId) continue;
   if(found || event.identity?.paneId!==paneId || event.identity.sessionId!==sessionId || event.provider!==provider || (record.identity.runId!==null && event.identity.runId!==record.identity.runId) ||
    name!==journalName(paneId,provider,event.identity.sessionId,event.identity.runId) ||
    event.sourceCapture?.sha256!==record.sourceCapture.sha256 || event.sourceCapture?.bytes!==record.sourceCapture.bytes || event.at!==record.at) throw new Error('committed capture conflict');
   const reference=sourceReference(event,name,row.offset,row.raw),receipt=readSessionSourceRecord({paneId,provider,reference,dir});
   if(!receipt.ok) throw new Error('committed capture unreadable');
   found={...row,name,reference};
  }
 }
 return found;
}
function recoverCommittedCapture(record,committed,dir) {
 const {paneId,provider}=record.identity,file=path.join(dir,sessionEventHeadName(paneId));
 const journalFd=fs.openSync(path.join(dir,committed.name),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try {if(!fs.fstatSync(journalFd).isFile())throw new Error('committed capture journal not regular');fs.fsyncSync(journalFd);}finally {fs.closeSync(journalFd);}
 const verified=readSessionSourceRecord({paneId,provider,reference:committed.reference,dir});if(!verified.ok)throw new Error('committed capture changed before recovery');
 let old=read(file);const base=committed.event.projectionBase;
 const matches=old?.provider===provider && sameIdentity(old?.identity,committed.event.identity);
 const predecessor=base && old?.provider===base.provider && sameIdentity(old.identity,base.identity) && old.seq===base.seq && old.event?.id===base.id;
 if(!old || matches || predecessor) {
  for(const row of completeLines(readRegularFile(path.join(dir,committed.name)))) {
   const event=row.event;
   if(event.provider!==provider || !sameIdentity(event.identity,committed.event.identity) || event.seq<=(matches ? old?.seq ?? 0:0)) continue;
   const state=reduceSessionEnvelope(sameIdentity(old?.state?.identity,event.identity) ? old.state:createSessionState(event.identity),event,{now:event.at,wallNow:event.at});
   old={version:2,provider,identity:state.identity,seq:event.seq,event:projection(event),state,journal:committed.name,bytes:row.offset+row.raw.length,sourceRecord:sourceReference(event,committed.name,row.offset,row.raw),...(old?.lastRetainedSource ? {lastRetainedSource:old.lastRetainedSource}:{})};
  }
 } else old={...old,lastRetainedSource:committed.reference};
 persistHead(file,old,dir);
 return {...old,captureReceipt:{ok:true,complete:true,status:'admitted',retained:true,admitted:true,acknowledged:false,forwarded:false,trust:'observed',captureId:record.captureId,projected:matches || predecessor || !base,reference:committed.reference}};
}
function admitCapturedLocked(record,dir,soakDir) {
 const {paneId,provider,sessionId}=record.identity,runId=record.identity.runId ?? undefined;
 const {payload,sidecar,at,source,observation,sourceCapture,captureId,retainedAt}=record;
 const nativeSource=sourceCapture.format==='native-plugin-object-json' ? JSON.parse(Buffer.from(sourceCapture.data.base64,'base64').toString('utf8')):undefined;
 let {captureOnly}=record;
 const file=path.join(dir,sessionEventHeadName(paneId));
    let old=read(file);
    if(old?.identity && old.identity.paneId!==paneId) throw new Error('event file binding collision');
    const eventName=payload?.hook_event_name ?? payload?.hookEventName;
    if(old && (old.provider!==provider || old.identity.sessionId!==sessionId || (runId && old.identity.runId!==runId)) &&
      !['UserPromptSubmit','SessionStart'].includes(eventName)) {
      // Late answers belong to their captured source, not the current pane head.
      // Retain them in the same per-session journal without changing current status.
      const capturedRun=clean(runId) ?? randomUUID();
      const name=journalName(paneId,provider,sessionId,capturedRun),lateJournalFile=path.join(dir,name);
      const previous=fs.existsSync(lateJournalFile) ? completeLines(readRegularFile(lateJournalFile)).map(row=>row.event).filter(e=>e.version===2 && e.identity?.paneId===paneId && e.identity.sessionId===sessionId && e.identity.runId===capturedRun && Number.isSafeInteger(e.seq) && e.seq>0) : [];
      const last=previous.reduce((a,b)=>!a || b.seq>a.seq ? b:a,null);
      const identity=last?.identity ?? {paneId,sessionId,runId:capturedRun,epoch:0},seq=(last?.seq ?? 0)+1;
      const event={version:2,provider,identity,id:`${capturedRun}:${seq}`,producer:`${provider}-hooks`,seq,at,source,kind:'source.observed',sourceCapture,captureId,retainedAt};
      const appended=appendRecord(dir,event);
      const retainedHead={...old,lastRetainedSource:appended.reference};
      persistHead(file,retainedHead,dir); // Notify head watchers; lifecycle/question/current seq stay unchanged.
      return {...retainedHead,captureReceipt:{ok:true,complete:true,trust:'observed',projected:false,reference:appended.reference}};
    }
    // Replay committed appends after a crash before snapshot rename. A new source run
    // never reuses the old log; it must report an explicit conversation boundary.
    let replayed=false;
    const recoveryRun=runId ?? old?.identity?.runId;
    if(recoveryRun && /^[a-zA-Z0-9-]{1,64}$/.test(recoveryRun)) {
      const recoveryFile=path.join(dir,`events-${fnv(paneId)}-${provider}-${fnv(sessionId)}-${recoveryRun}.jsonl`);
      if(fs.existsSync(recoveryFile)) {
        const all=readRegularFile(recoveryFile),size=all.length;
        const offset=old?.journal===path.basename(recoveryFile) && old?.bytes && old.bytes<=size ? old.bytes : 0;
        for(const {event,raw,offset:recordOffset} of completeLines(all,offset)) {
          if(!event?.identity || event.version!==2 || !Number.isSafeInteger(event.seq) || event.seq<1 || event.identity.runId!==recoveryRun || event.identity.paneId!==paneId || event.identity.sessionId!==sessionId || event.seq<=(old?.identity.runId===event.identity.runId && old?.identity.sessionId===event.identity.sessionId ? old?.seq ?? 0 : 0)) continue;
          const base=old?.state && JSON.stringify(old.state.identity)===JSON.stringify(event.identity) ? old.state : createSessionState(event.identity);
          const state=reduceSessionEnvelope(base,event,{now:event.at,wallNow:event.at});
          old={version:2,provider,identity:state.identity,seq:event.seq,event:projection(event),state,journal:path.basename(recoveryFile),bytes:recordOffset+raw.length,
            sourceRecord:sourceReference(event,path.basename(recoveryFile),recordOffset,raw),...(old?.lastRetainedSource ? {lastRetainedSource:old.lastRetainedSource}:{})};replayed=true;
        }
      }
    }
    if(replayed) persistHead(file,old,dir); // Repair even when the incoming observation is rejected.
    if(observation && (!old || old.provider!==provider)) captureOnly=true;
    const same=old?.version===2 && old.provider===provider && old.identity?.paneId===paneId && old.identity.sessionId===sessionId && (!runId || old.identity.runId===runId);
    const identity=same ? old.identity : {paneId,sessionId,runId:clean(runId) ?? randomUUID(),epoch:0};
    let state=same ? old.state : createSessionState(identity);
    if(!same && old?.identity.sessionId===sessionId) state={...state,goal:old.state.goal,task:old.state.task,tasks:old.state.tasks ?? [],now:old.state.now ? {...old.state.now,stale:true}:null};
    if(state.ended && eventName==='SessionStart') state=createSessionState({...identity,epoch:identity.epoch+1});
    const boundIdentity=state.identity;
    const seq=same ? old.seq+1 : 1;

    const callId=clean(payload?.tool_use_id ?? payload?.tool_call_id ?? payload?.call_id);
    const failedResult=hasToolResultError(payload) || hasToolResultError(nativeSource?.properties) || hasToolResultError(nativeSource?.output) || hasToolResultError(nativeSource?.output?.metadata);
    const startsNewTurn=eventName==='UserPromptSubmit';
    const explicitInput=eventName==='PreToolUse' && ['AskUserQuestion','request_user_input'].includes(payload?.tool_name);
    let lifecycle=explicitInput ? 'waiting' : ['Stop','VendorTurnComplete'].includes(eventName) ? 'finished' : sidecar?.turn==='waiting' ? 'waiting' : sidecar?.turn==='idle' ? 'idle' : sidecar?.turn==='unknown' ? 'unknown' : 'working';
    const reason=eventName==='PermissionRequest' || ['permission_request','permission_prompt'].includes(sidecar?.turnReason) ? 'approval' : explicitInput || sidecar?.turnReason==='operator_question' ? 'input' : null;
    const question=lifecycle==='waiting' && reason ? {id:callId ? `call:${callId}` : `question:${seq}`,reason,callId:callId ?? undefined} : null;
    if(lifecycle==='waiting' && !question) lifecycle='unknown';
    const resolvesQuestionId=eventName==='PostToolUse' && !failedResult && callId && state.question?.callId===callId ? state.question.id : undefined;
    const taskTool=['TodoWrite','TaskCreate','TaskUpdate','update_plan'].includes(payload?.tool_name);
    let tasks=state.tasks ?? [];
    if(taskTool && Array.isArray(sidecar?.todos)) {
      let incoming=sidecar.todos.map((item,index)=>({id:String(item.id ?? `task-${index}`),text:item.content,activeForm:item.activeForm,status:item.status}));
      if(payload.tool_name==='TaskUpdate') incoming=incoming.filter(item=>item.id===String(payload.tool_input?.taskId ?? ''));
      if(payload.tool_name==='TaskCreate') incoming=incoming.filter(item=>item.text===String(payload.tool_input?.subject ?? '').trim() || !tasks.some(previous=>previous.id===item.id));
      tasks=['TodoWrite','update_plan'].includes(payload.tool_name) ? incoming : [...tasks.map(item=>incoming.find(next=>next.id===item.id) ?? item),...incoming.filter(item=>!tasks.some(previous=>previous.id===item.id))];
    } else if(seq===1) tasks=(sidecar?.todos ?? []).map((item,index)=>({id:String(item.id ?? `task-${index}`),text:item.content,activeForm:item.activeForm,status:item.status}));
    const current=tasks.find(item=>item.status==='in_progress') ?? (tasks.length && tasks.every(item=>item.status==='completed') ? tasks[tasks.length-1] : null);
    const goalSource=sidecar?.mainTaskSource==='goal-task' ? 'agent-goal' : sidecar?.mainTaskSource;
    const goal=clean(sidecar?.mainTask) && !/(?:^|\s)\/(?:tmp|home|media|var|usr|opt)\//i.test(sidecar.mainTask) && ['about-what','opening-request','agent-goal'].includes(goalSource) ? {text:sidecar.mainTask,source:goalSource} : null;
    let event={version:2,provider,identity:boundIdentity,id:`${identity.runId}:${seq}`,producer:`${provider}-${source==='vendor'?'vendor':'hooks'}`,seq,at,source,kind:'report',lifecycle,
      startsNewTurn,resolvesQuestionId,question,
      task:current && (seq===1 || taskTool) ? {text:current.text,source:'task-tool'} : null,tasks:(seq===1 || taskTool) ? tasks : null,goal,
      now:!startsNewTurn && clean(sidecar?.now) ? {text:sidecar.now,source:source==='vendor' ? 'vendor':'hook'} : null,
      completionSource:eventName==='Stop' ? 'hook-stop' : eventName==='VendorTurnComplete' ? 'vendor-turn-complete':undefined,completedAt:['Stop','VendorTurnComplete'].includes(eventName) ? at : undefined};
    if(eventName==='QuestionResolved' && !failedResult) {event.kind='question.resolved';event.questionId=state.question?.callId===callId ? state.question.id : `call:${callId}`;}
    if(eventName==='SessionEnd') {event.kind='process.gone';event.source='process';}
    if(eventName==='SessionStart') {event.lifecycle='unknown';}
    if(observation) {
      event=captureOnly ? {} : sessionObservationEnvelope(state,observation,seq);
      if(!event) {captureOnly=true;event={};}
    }
    if(captureOnly) event={version:2,provider,identity:boundIdentity,id:`${identity.runId}:${seq}`,producer:`${provider}-${source==='vendor'?'vendor':'hooks'}`,seq,at,source,kind:'source.observed'};
    event={...event,provider,sourceCapture,captureId,retainedAt,projectionBase:old ? {provider:old.provider,identity:old.identity,seq:old.seq,id:old.event?.id}:null};
    // A matched result explicitly discharges its question before reporting resumption.
    // An unmatched result keeps the question; no executable/process heuristic is used.
    const reduced=reduceSessionEnvelope(state,event,{now:at,wallNow:at});
    // Rejected/stale observations are still source records; the reducer stays unchanged.
    state=reduced;
    const appended=appendRecord(dir,event);
    const head={version:2,provider,identity:state.identity,seq,event:projection(event),state,journal:appended.journal,bytes:appended.bytes,sourceRecord:appended.reference,...(old?.lastRetainedSource ? {lastRetainedSource:old.lastRetainedSource}:{})};
    persistHead(file,head,dir);
    if(soakDir) {try {recordSessionSoak(head,{dir:soakDir,at:Date.now(),legacyStatus:sidecar?.turn});}catch(error){console.error('termfleet soak recorder:',error.message);}}
    return head;

}
function drainPendingLocked({paneId,provider,dir,soakDir}) {
 const snapshot=pendingSnapshot({paneId,provider,dir}),results=new Map();
 for(const entry of snapshot.entries.sort((a,b)=>a.record.retainedAt-b.record.retainedAt || a.record.captureId.localeCompare(b.record.captureId))) {
  const committed=findCommittedCapture(entry.record,dir);
  const result=committed ? recoverCommittedCapture(entry.record,committed,dir):admitCapturedLocked(entry.record,dir,soakDir);
  if(!result) throw new Error('retained source was not admitted');
  const reference=result.captureReceipt?.reference ?? result.sourceRecord;
  const receipt=readSessionSourceRecord({paneId,provider,reference,dir});
  if(!receipt.ok || receipt.captureId!==entry.record.captureId) throw new Error('admitted source receipt mismatch');
  fs.unlinkSync(path.join(dir,entry.name));syncDirectory(dir);
  results.set(entry.record.captureId,{...result,captureReceipt:{...result.captureReceipt,ok:true,complete:true,status:'admitted',retained:true,admitted:true,acknowledged:false,forwarded:false,trust:'observed',captureId:entry.record.captureId,reference}});
 }
 return results;
}
/** Recover existing observed proposals under the existing admission lock. It
 * neither forwards input nor grants approval; replay reuses committed capture IDs. */
export async function recoverSessionSourcePending({paneId,provider,dir=statusDir()}) {
 let release;
 try {
  if(!clean(paneId) || !['codex','claude','opencode'].includes(provider)) throw new Error('invalid pending source scope');
  release=await acquirePaneJournalLock(dir,paneId);
  const results=drainPendingLocked({paneId,provider,dir});
  return {version:1,ok:true,status:'admitted',trust:'observed',acknowledged:false,forwarded:false,receipts:[...results.values()].map(r=>r.captureReceipt),pending:readSessionSourcePending({paneId,provider,dir})};
 } catch(error) {return {version:1,ok:false,status:'error',error:error.code ?? error.message,trust:'observed',acknowledged:false,forwarded:false};}
 finally {release?.();}
}
/** Retain complete originals before attempting the existing admission lock. A
 * busy lock leaves an immutable observed proposal; later recovery uses the same
 * capture ID and original timestamp, assigning a journal sequence only on admit. */
export async function publishSessionEvent({paneId,provider,payload,sidecar,dir=statusDir(),at=Date.now(),runId=process.env.TERMFLEET_STATUS_RUN_ID,source='hook',observation,rawSource,nativeSource,captureOnly=false,soakDir=process.env.TERMFLEET_SESSION_SOAK_DIR}) {
 if(runId && !/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('invalid status publisher run ID');
 const sessionId=clean(payload?.session_id ?? payload?.sessionId ?? sidecar?.sessionId);
 if(!clean(paneId) || !sessionId || !['codex','claude','opencode'].includes(provider)) return null;
 const sourceCapture=captureSource(payload,rawSource,nativeSource,observation);
 const record=JSON.parse(JSON.stringify({version:1,kind:'session-source-pending',trust:'observed',interpretation:'uninterpreted',captureId:randomUUID(),identity:{paneId,provider,sessionId,runId:clean(runId)},at,retainedAt:Date.now(),payload,sidecar,source,observation,sourceCapture,captureOnly}));
 const retained=retainPendingSource(record,dir);let release;
 try {
  release=await acquirePaneJournalLock(dir,paneId);
  const results=drainPendingLocked({paneId,provider,dir,soakDir});
  const result=results.get(record.captureId);
  if(result) return result;
  const committed=findCommittedCapture(record,dir);
  if(!committed) throw new Error('retained source missing after admission');
  return recoverCommittedCapture(record,committed,dir);
 } catch(error) {
  if(error.code==='EJOURNALBUSY') return {version:1,captureReceipt:retained};
  error.captureReceipt=retained;throw error;
 } finally {release?.();}
}

/** Trusted source seam. A missing head is not an invitation to guess a binding.
 * All writes use the same per-pane lock, fsync journal and crash replay as hooks. */
export async function publishSessionObservation({observation,...options}) {
 if(!observation?.identity) return null;
 return publishSessionEvent({...options,paneId:observation.identity.paneId,runId:observation.identity.runId,
  at:observation.at,payload:{session_id:observation.identity.sessionId,hook_event_name:'RuntimeObservation'},observation});
}
