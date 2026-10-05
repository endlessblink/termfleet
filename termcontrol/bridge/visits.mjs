import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const file=path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(),'.config','termcontrol'),'visits.json');
export class VisitHistory {
 constructor(location=file){this.file=location;}
 read(owner){try{return JSON.parse(fs.readFileSync(this.file,'utf8'))[owner] || {};}catch{return {};}}
 record(owner,pane,now=Date.now()){
  let all;try{all=JSON.parse(fs.readFileSync(this.file,'utf8'));if(!all || typeof all!=='object' || Array.isArray(all))throw new Error();}catch(e){if(e.code!=='ENOENT')throw new Error('Conversation history could not be read.');all={};}
  const visits=all[owner] || {},last=Math.max(0,...Object.values(visits).filter(Number.isFinite));
  const at=Math.max(now,last+1);visits[pane]=at;
  all[owner]=Object.fromEntries(Object.entries(visits).sort((a,b)=>b[1]-a[1]).slice(0,500));
  fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(all),{mode:0o600});fs.renameSync(tmp,this.file);return at;
 }
}
export const visits=new VisitHistory();
