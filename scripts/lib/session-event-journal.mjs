import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {statusDir,fnv} from './agent-status-paths.mjs';
import {createSessionState} from '../../shared/sessionState.mjs';
import {reduceSessionEnvelope} from '../../shared/sessionEnvelope.mjs';

export const sessionEventHeadName=paneId=>`events-${fnv(paneId)}.json`;
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const clean=value=>typeof value==='string' && value.trim() ? value.trim() : null;
/** One short exclusive transaction per pane. Contention fails closed; callers never
 * steal a live lock or drop an event silently. Dead owners can be recovered. */
export async function publishSessionEvent({paneId,provider,payload,sidecar,dir=statusDir(),at=Date.now(),runId=process.env.TERMFLEET_STATUS_RUN_ID,source='hook'}) {
  if(runId && !/^[a-zA-Z0-9-]{1,64}$/.test(runId)) throw new Error('invalid status publisher run ID');
  const sessionId=clean(payload?.session_id ?? payload?.sessionId ?? sidecar?.sessionId);
  if(!clean(paneId) || !sessionId || !['codex','claude','opencode'].includes(provider)) return null;
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,sessionEventHeadName(paneId)),lock=`${file}.lock`;
  let acquired=false;
  for(let attempt=0;attempt<100;attempt++) {
    try {fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner'),String(process.pid));acquired=true;break;}
    catch(error) {
      if(error.code!=='EEXIST') throw error;
      const owner=Number(fs.existsSync(path.join(lock,'owner')) ? fs.readFileSync(path.join(lock,'owner'),'utf8'):0);
      if(owner>1) {try {process.kill(owner,0);}catch(e){if(e.code==='ESRCH'){fs.rmSync(lock,{recursive:true,force:true});continue;}}}
      await new Promise(resolve=>setTimeout(resolve,10));
    }
  }
  if(!acquired) throw new Error('session event journal busy; event not acknowledged');
  try {
    let old=read(file);
    if(old?.identity && old.identity.paneId!==paneId) throw new Error('event file binding collision');
    const eventName=payload?.hook_event_name ?? payload?.hookEventName;
    if(old && (old.identity.sessionId!==sessionId || (runId && old.identity.runId!==runId)) &&
      !['UserPromptSubmit','SessionStart'].includes(eventName)) return null;
    // Replay committed appends after a crash before snapshot rename. A new source run
    // never reuses the old log; it must report an explicit conversation boundary.
    const recoveryRun=runId ?? old?.identity?.runId;
    if(recoveryRun && /^[a-zA-Z0-9-]{1,64}$/.test(recoveryRun)) {
      const recoveryFile=path.join(dir,`events-${fnv(paneId)}-${provider}-${fnv(sessionId)}-${recoveryRun}.jsonl`);
      if(fs.existsSync(recoveryFile)) {
        const size=fs.statSync(recoveryFile).size;
        const offset=old?.journal===path.basename(recoveryFile) && old?.bytes && old.bytes<=size ? old.bytes : 0;
        const remaining=Buffer.alloc(size-offset),reader=fs.openSync(recoveryFile,'r');
        try {fs.readSync(reader,remaining,0,remaining.length,offset);}finally{fs.closeSync(reader);}
        const records=remaining.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
        for(const event of records) {
          if(!event?.identity || event.version!==2 || !Number.isSafeInteger(event.seq) || event.seq<1 || event.identity.runId!==recoveryRun || event.identity.paneId!==paneId || event.identity.sessionId!==sessionId || event.seq<=(old?.identity.runId===event.identity.runId && old?.identity.sessionId===event.identity.sessionId ? old?.seq ?? 0 : 0)) continue;
          const base=old?.state && JSON.stringify(old.state.identity)===JSON.stringify(event.identity) ? old.state : createSessionState(event.identity);
          const state=reduceSessionEnvelope(base,event,{now:event.at,wallNow:event.at});
          old={version:2,provider,identity:event.identity,seq:event.seq,event,state,journal:path.basename(recoveryFile),bytes:size};
        }
      }
    }
    const same=old?.version===2 && old.provider===provider && old.identity?.paneId===paneId && old.identity.sessionId===sessionId && (!runId || old.identity.runId===runId);
    const identity=same ? old.identity : {paneId,sessionId,runId:clean(runId) ?? randomUUID(),epoch:0};
    let state=same ? old.state : createSessionState(identity);
    if(!same && old?.identity.sessionId===sessionId) state={...state,goal:old.state.goal,task:old.state.task,tasks:old.state.tasks ?? [],now:old.state.now ? {...old.state.now,stale:true}:null};
    if(state.ended && eventName==='SessionStart') state=createSessionState({...identity,epoch:identity.epoch+1});
    const boundIdentity=state.identity;
    const seq=same ? old.seq+1 : 1;

    const callId=clean(payload?.tool_use_id ?? payload?.tool_call_id ?? payload?.call_id);
    const startsNewTurn=eventName==='UserPromptSubmit';
    let lifecycle=['Stop','VendorTurnComplete'].includes(eventName) ? 'finished' : sidecar?.turn==='waiting' ? 'waiting' : sidecar?.turn==='idle' ? 'idle' : sidecar?.turn==='unknown' ? 'unknown' : 'working';
    const reason=eventName==='PermissionRequest' || ['permission_request','permission_prompt'].includes(sidecar?.turnReason) ? 'approval' : sidecar?.turnReason==='operator_question' ? 'input' : null;
    const question=lifecycle==='waiting' && reason ? {id:callId ? `call:${callId}` : `question:${seq}`,reason,callId:callId ?? undefined} : null;
    if(lifecycle==='waiting' && !question) lifecycle='unknown';
    const resolvesQuestionId=eventName==='PostToolUse' && callId && state.question?.callId===callId ? state.question.id : undefined;
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
    const event={version:2,identity:boundIdentity,id:`${identity.runId}:${seq}`,producer:`${provider}-${source==='vendor'?'vendor':'hooks'}`,seq,at,source,kind:'report',lifecycle,
      startsNewTurn,resolvesQuestionId,question,
      task:current && (seq===1 || taskTool) ? {text:current.text,source:'task-tool'} : null,tasks:(seq===1 || taskTool) ? tasks : null,goal,
      now:!startsNewTurn && clean(sidecar?.now) ? {text:sidecar.now,source:source==='vendor' ? 'vendor':'hook'} : null,
      completionSource:eventName==='Stop' ? 'hook-stop' : eventName==='VendorTurnComplete' ? 'vendor-turn-complete':undefined,completedAt:['Stop','VendorTurnComplete'].includes(eventName) ? at : undefined};
    if(eventName==='QuestionResolved') {event.kind='question.resolved';event.questionId=state.question?.callId===callId ? state.question.id : `call:${callId}`;}
    if(eventName==='SessionEnd') {event.kind='process.gone';event.source='process';}
    if(eventName==='SessionStart') {event.lifecycle='unknown';}
    // A matched result explicitly discharges its question before reporting resumption.
    // An unmatched result keeps the question; no executable/process heuristic is used.
    state=reduceSessionEnvelope(state,event,{now:at,wallNow:at});
    const journal=path.join(dir,`events-${fnv(paneId)}-${provider}-${fnv(sessionId)}-${identity.runId}.jsonl`);
    // Delimit an incomplete crash tail without rewriting any committed event.
    if(fs.existsSync(journal)) {
      const size=fs.statSync(journal).size,last=Buffer.alloc(1),reader=fs.openSync(journal,'r');
      try {if(size) fs.readSync(reader,last,0,1,size-1);}finally{fs.closeSync(reader);}
      if(size && last[0]!==10) fs.appendFileSync(journal,'\n');
    }
    const fd=fs.openSync(journal,'a',0o600);
    try {fs.writeFileSync(fd,`${JSON.stringify(event)}\n`);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
    const head={version:2,provider,identity:boundIdentity,seq,event,state,journal:path.basename(journal),bytes:fs.statSync(journal).size};
    const temporary=`${file}.${process.pid}.tmp`;
    const snapshotFd=fs.openSync(temporary,'w',0o600);
    try {fs.writeFileSync(snapshotFd,JSON.stringify(head));fs.fsyncSync(snapshotFd);}finally{fs.closeSync(snapshotFd);}
    fs.renameSync(temporary,file);
    const directoryFd=fs.openSync(dir,'r');try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
    return head;
  } finally {fs.rmSync(lock,{recursive:true,force:true});}
}
