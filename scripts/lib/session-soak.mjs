import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const statuses=new Set(['working','waiting','idle','finished','interrupted','ended','crashed','unknown']);
const kinds=new Set(['report','question.resolved','process.observed','process.gone','process.crashed','process.interrupted','interruption.intent','turn.interrupted','transport.disconnected','transport.reconnected']);
const hash=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,24);
/** Opt-in bounded metadata recorder. Never serializes the source object, prompt,
 * Task/Goal/Now, question IDs, process tokens, paths, or free-form reasons.
 * Contention fails explicitly; it must not delay/fail the primary event journal. */
export function recordSessionSoak(head,{dir,maxBytes=1024*1024,slots=4,at=Date.now(),legacyStatus}={}) {
 if(!dir) return false;
 if(!Number.isSafeInteger(maxBytes) || maxBytes<1024 || !Number.isSafeInteger(slots) || slots<1 || slots>16) throw new Error('invalid soak budget');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const lock=path.join(dir,'.recorder-lock');
 try {fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),String(process.pid));}
 catch(error) {
  if(error.code==='EEXIST') {
   let owner=0;try{owner=Number(fs.readFileSync(path.join(lock,'owner'),'utf8'));}catch{}
   if(owner>1) {try{process.kill(owner,0);}catch(dead){if(dead.code==='ESRCH'){fs.rmSync(lock,{recursive:true,force:true});return recordSessionSoak(head,{dir,maxBytes,slots,at,legacyStatus});}}}
   throw new Error('soak recorder busy; evidence not acknowledged');
  }
  throw error;
 }
 try {
  const record={version:1,binding:hash(JSON.stringify(head.identity)),provider:['codex','claude','opencode'].includes(head.provider) ? head.provider:'unknown',
   seq:Number.isSafeInteger(head.seq) ? head.seq:null,at:Number.isFinite(at) ? at:null,
   source:['hook','vendor','operator','process','transport'].includes(head.event?.source) ? head.event.source:'unknown',
   kind:kinds.has(head.event?.kind) ? head.event.kind:'unknown',
   lifecycle:statuses.has(head.state?.lifecycle) ? head.state.lifecycle:'unknown',
   legacyStatus:statuses.has(legacyStatus) ? legacyStatus:null,
   disagrees:statuses.has(legacyStatus) ? legacyStatus!==(['finished','ended'].includes(head.state?.lifecycle) ? 'idle':head.state?.lifecycle):null,
   delayMs:Number.isFinite(at) && Number.isFinite(head.event?.at) ? Math.max(0,at-head.event.at):null};
  const line=JSON.stringify(record)+'\n',cursor=path.join(dir,'cursor.json');
  let slot=0;try{const saved=JSON.parse(fs.readFileSync(cursor,'utf8'));if(Number.isInteger(saved.slot) && saved.slot>=0 && saved.slot<slots) slot=saved.slot;}catch{}
  let file=path.join(dir,`soak-${slot}.jsonl`),size=0,badTail=false;
  try{size=fs.statSync(file).size;const fd=fs.openSync(file,'r'),last=Buffer.alloc(1);try{if(size)fs.readSync(fd,last,0,1,size-1);}finally{fs.closeSync(fd);}badTail=Boolean(size && last[0]!==10);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(size+Buffer.byteLength(line)>maxBytes || badTail) {slot=(slot+1)%slots;file=path.join(dir,`soak-${slot}.jsonl`);const fd=fs.openSync(file,'w',0o600);fs.closeSync(fd);}
  const fd=fs.openSync(file,'a',0o600);try{fs.writeFileSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const temporary=cursor+'.tmp',meta=fs.openSync(temporary,'w',0o600);try{fs.writeFileSync(meta,JSON.stringify({version:1,slot,maxBytes,slots}));fs.fsyncSync(meta);}finally{fs.closeSync(meta);}
  fs.renameSync(temporary,cursor);const directory=fs.openSync(dir,'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  return true;
 }finally{fs.rmSync(lock,{recursive:true,force:true});}
}
