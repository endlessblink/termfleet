import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=text=>createHash('sha256').update(text).digest('hex');
const uncertain=()=>({error:'This send may already have typed text. Inspect the terminal and have an operator reconcile the send before trying another draft.',uncertain:true});
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeFile(file,value){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

// Read-only recovery metadata. Never read message bodies or infer that an old
// timestamp/PID means it is safe to remove a lock.
export function inspectPaneSend(dir,scope){
 const file=path.join(dir,'pane-'+hash(scope)+'.lock');
 let lock;
 try{lock=JSON.parse(fs.readFileSync(file,'utf8'));}
 catch(error){return error.code==='ENOENT'?{present:false}:{present:true,state:'unknown'};}
 if(!lock||typeof lock!=='object'||lock.v!==1||!/^[a-f0-9]{64}$/.test(lock.draftHash)||!/^[a-f0-9-]{36}$/.test(lock.token)||!Number.isFinite(lock.at))return{present:true,state:'unknown'};
 let receipt;try{receipt=JSON.parse(fs.readFileSync(path.join(dir,lock.draftHash+'.json'),'utf8'));}catch{}
 return{present:true,draftHash:lock.draftHash,token:lock.token,at:lock.at,state:receipt?.state==='finished'?'recorded':'pending',uncertain:receipt?.outcome?.uncertain===true};
}

// Reserve BEFORE dispatch. An interrupted/unknown attempt stays uncertain indefinitely;
// process-local cache expiry never expires the durable receipt. No message text is stored.
export function createSendOnce({ dir = null, ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const drafts = new Map();
  return async function sendOnce(sendId, text, run, {scope=''} = {}) {
    const key = typeof sendId === 'string' && sendId && sendId.length <= 1024 ? sendId : null;
    if (!key) return dir ? {error:'A stable message ID is required before sending. Refresh the page and try again.',notSent:true} : run();
    if(dir && (typeof scope!=='string' || !scope))return{error:'A terminal identity is required before sending.',notSent:true};
    for (const [id, entry] of drafts) if (dir && entry.finished && now() - entry.at > ttlMs) drafts.delete(id);
    const prior = drafts.get(key);
    if (prior) {
      if (prior.text !== text) return { error: 'This message changed while it was being sent. Send it again.', notSent: true };
      if(prior.scope!==scope)return{error:'This message targets a different terminal. Create a new draft for that terminal.',notSent:true};
      return { ...(await prior.result), repeated: true };
    }
    const file=dir?path.join(dir,hash(key)+'.json'):null;
    const paneFile=dir?path.join(dir,'pane-'+hash(scope)+'.lock'):null;
    const reservation={v:1,textHash:hash(String(text)),scope,at:now(),state:'pending'};
    if(file){
      try{fs.mkdirSync(dir,{recursive:true,mode:0o700});}
      catch{return{error:'The send receipt could not be saved. Nothing was sent.',notSent:true};}
      try{writeFile(file,reservation);syncDirectory(dir);}
      catch(error){
        if(error.code!=='EEXIST')return{error:'The send receipt could not be saved. Nothing was sent.',notSent:true};
        try{
          const saved=JSON.parse(fs.readFileSync(file,'utf8'));
          if(saved.v!==1 || !['pending','finished'].includes(saved.state))return{...uncertain(),repeated:true};
          if(saved.textHash!==reservation.textHash)return{error:'This message changed while it was being sent. Send it again.',notSent:true};
          if(saved.scope!==scope)return{error:'This message targets a different terminal. Create a new draft for that terminal.',notSent:true};
          return{...(saved.state==='finished'&&saved.outcome?saved.outcome:uncertain()),repeated:true};
        }catch{return{...uncertain(),repeated:true};}
      }
    }
    const entry={text,scope,at:now(),finished:false};
    const result=Promise.resolve().then(async()=>{
      let outcome,ownsPane=false;const paneToken=randomUUID();
      if(paneFile){
        try{
          // No process may dispatch another draft into this pane while its owner
          // is running or left an uncertain attempt. Never expire/reclaim by PID.
          const fd=fs.openSync(paneFile,'wx',0o600);ownsPane=true;
          try{fs.writeFileSync(fd,JSON.stringify({v:1,token:paneToken,draftHash:hash(key),at:now()}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
          syncDirectory(dir);
        }catch(error){
          const blocked=error.code==='EEXIST'?inspectPaneSend(dir,scope):null;
          // This is not the overridable shell-busy response: the existing UI must
          // show the refusal, never offer its "Send anyway" force action.
          outcome={error:blocked?'This terminal has an active or uncertain send. Inspect the terminal; an operator must reconcile that send before another draft can be sent.':'The terminal send lock could not be saved. Nothing was sent.',notSent:true,...(blocked?{blocked:true,blockedBy:{state:blocked.state,draftHash:blocked.draftHash,at:blocked.at}}:{})};
        }
      }
      if(!outcome)try{outcome=await run();}catch{outcome=uncertain();}
      if(outcome?.uncertain){outcome={...outcome};delete outcome.ok;delete outcome.delivered;}
      // Only a proven prewrite refusal permits another attempt. Unknown failures retain
      // the pending reservation, including crashes before completion persistence.
      if(!outcome?.ok&&!outcome?.uncertain&&!outcome?.notSent)outcome={...outcome,...uncertain()};
      if(file){
        try{
          if(outcome.notSent&&!outcome.uncertain&&!outcome.ok){fs.unlinkSync(file);syncDirectory(dir);}
          else{
            const temp=file+'.'+randomUUID()+'.tmp';
            writeFile(temp,{...reservation,state:'finished',outcome});fs.renameSync(temp,file);syncDirectory(dir);
          }
          if(ownsPane && !outcome.uncertain && (outcome.ok||outcome.notSent)){
            if(JSON.parse(fs.readFileSync(paneFile,'utf8')).token!==paneToken)throw Error('Terminal send lock ownership changed.');
            fs.unlinkSync(paneFile);syncDirectory(dir);
          }
        }catch{outcome=uncertain();}
      }
      entry.finished=true;
      if(outcome?.notSent&&!outcome?.uncertain&&!outcome?.ok)drafts.delete(key);
      return outcome;
    });
    entry.result=result;drafts.set(key,entry);
    return result;
  };
}
