import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const hash=text=>createHash('sha256').update(text).digest('hex');
const uncertain=()=>({error:'This send may already have typed text. Check the terminal before creating a new message.',uncertain:true});
function syncDirectory(dir){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function writeFile(file,value){
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}

// Reserve BEFORE dispatch. An interrupted/unknown attempt stays uncertain indefinitely;
// process-local cache expiry never expires the durable receipt. No message text is stored.
export function createSendOnce({ dir = null, ttlMs = 30 * 60 * 1000, now = () => Date.now() } = {}) {
  const drafts = new Map();
  return async function sendOnce(sendId, text, run, {scope=''} = {}) {
    const key = typeof sendId === 'string' && sendId && sendId.length <= 1024 ? sendId : null;
    if (!key) return dir ? {error:'A stable message ID is required before sending. Refresh the page and try again.',notSent:true} : run();
    for (const [id, entry] of drafts) if (dir && entry.finished && now() - entry.at > ttlMs) drafts.delete(id);
    const prior = drafts.get(key);
    if (prior) {
      if (prior.text !== text) return { error: 'This message changed while it was being sent. Send it again.', notSent: true };
      if(prior.scope!==scope)return{error:'This message targets a different terminal. Create a new draft for that terminal.',notSent:true};
      return { ...(await prior.result), repeated: true };
    }
    const file=dir?path.join(dir,hash(key)+'.json'):null;
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
      let outcome;
      try{outcome=await run();}catch{outcome=uncertain();}
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
