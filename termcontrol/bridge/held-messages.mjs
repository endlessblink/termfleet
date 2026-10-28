// Messages from other agents to a Codex agent that is mid-turn wait here and are delivered together,
// as one message, when its turn ends (Noam 2026-10-26, approved). Codex folds a message typed
// mid-turn into the running turn and keeps going: 1,972 of 2,098 agent messages on 24-26 Oct
// arrived that way, about 17 per turn, and the work after them was 37% of all Codex tokens.
// Off: TERMFLEET_HOLD_BUSY=0. A busy agent gets them at most HOLD_WINDOW_MS after the first one
// (Noam 2026-10-27 #9): holding until the turn ended left 65 messages waiting 1.5 hours.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { adapterFor } from './feed.mjs';
import { scanDeliveryReceipt } from './delivery-reconciliation.mjs';

export const heldDir = (env = process.env) => path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'terminal-workspace', 'held-messages');
const fileOf = (dir, id) => path.join(dir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.jsonl`);

export const HOLD_WINDOW_MS = 3 * 60_000;

/**
 * Hold only when switched on (TERMFLEET_HOLD_BUSY=1). Off by default since 2026-10-27 17:50: with it on, five
 * corrections from Noam to a working helper were held, the helper closed before the window ended, and the bot
 * had told him they were passed on. A saving in tokens is never worth losing his words.
 */
export function shouldHold(pane, env = process.env) {
  return env.TERMFLEET_HOLD_BUSY === '1' && pane?.provider === 'codex' && pane.turn === 'working';
}

function syncDir(dir) { const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);} }
function appendRows(file, rows) {
  const fd=fs.openSync(file,'a',0o600);
  try { fs.writeFileSync(fd,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(path.dirname(file));
}
function withQueueLock(file,fn) {
  const lock=file+'.mutation';const fd=fs.openSync(lock,'wx',0o600);
  try{fs.fsyncSync(fd);return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);syncDir(path.dirname(file));}
}

export function holdMessage(paneId, text, { dir = heldDir(), now = Date.now(), target = null } = {}) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const row={id:randomUUID(),at:now,pane:paneId,text,
    ...(target?.id===paneId?{sessionId:target.sessionId||null,provider:target.provider||null}:{})};
  const file=fileOf(dir,paneId);withQueueLock(file,()=>{
    if(fs.existsSync(file+'.quarantine'))throw Error('Held target is quarantined; explicit recovery is required. New message was not queued.');
    appendRows(file,[row]);
  });
  return row;
}

/** Take every held message for a terminal (the file is moved away first, so a new one is never lost). */
export function takeHeld(paneId, { dir = heldDir() } = {}) {
  const file = fileOf(dir, paneId);
  if(fs.existsSync(file+'.quarantine'))return [];
  const taking = `${file}.${process.pid}.${Date.now()}.taking`;
  try { fs.renameSync(file, taking); } catch { return []; }
  let rows = [];
  try { rows = fs.readFileSync(taking, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } finally { fs.rmSync(taking, { force: true }); }
  return rows;
}

/** Put messages back (a delivery failed). */
export function putBack(paneId, rows, { dir = heldDir() } = {}) {
  fs.mkdirSync(dir,{recursive:true,mode:0o700});
  const file=fileOf(dir,paneId);if(rows.length)withQueueLock(file,()=>{
    if(fs.existsSync(file+'.quarantine'))throw Error('Held target is quarantined; explicit recovery is required.');
    appendRows(file,rows);
  });
}

export function heldPanes({ dir = heldDir() } = {}) {
  try { return [...new Set(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')||f.endsWith('.jsonl.inflight')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').split('\n')[0]).pane; } catch { return null; } }).filter(Boolean))]; } catch { return []; }
}

export function hasHeld(paneId,{dir=heldDir()}={}) {
  return fs.existsSync(fileOf(dir,paneId))||fs.existsSync(fileOf(dir,paneId)+'.inflight')||fs.existsSync(fileOf(dir,paneId)+'.quarantine');
}

function sameTarget(pane,rows) {
  return pane?.alive&&!pane.sleeping&&!pane.attention&&pane.turn!=='waiting'&&
    ['codex','claude','opencode'].includes(pane.provider)&&typeof pane.sessionId==='string'&&!!pane.sessionId&&
    rows.length>0&&rows.every(r=>r.pane===pane.id&&r.provider===pane.provider&&r.sessionId===pane.sessionId);
}

function receiptOf(pane,row) {
  // framedMessage appends this send's marker last. Quoted earlier markers are not receipts.
  const delivery=/\[delivery (D-[0-9a-f]{8})\]\s*$/.exec(String(row.text||''))?.[1];
  if(!delivery)return false;
  let file;try{file=adapterFor(pane)?.transcriptPath(pane);}catch{return false;}
  return !!scanDeliveryReceipt({file,provider:pane.provider,sessionId:pane.sessionId,delivery,since:row.at});
}

const reported=new Set();
function reportRows(pane,rows,reason,notify,log) {
  const key=[pane,reason,...rows.map(r=>r.id||r.at)].join('|');
  if(reported.has(key))return;
  log(`held batch for ${pane}: ${reason}; retained without automatic replay`);
  try {
    for(const sender of new Set(rows.map(r=>senderOf(r.text)).filter(Boolean)))notify({sender,pane,rows:rows.filter(r=>senderOf(r.text)===sender),reason});
    reported.add(key);
  }catch{ /* Retain words; retry the report next pass. */ }
}

/** A durable inflight file is also the per-pane process exclusion. Never reclaim by age/PID.
 * An attempted batch stays intact until exact structured user-input receipts prove every row.
 */
export async function deliverHeldTo(pane,{send,dir=heldDir(),resolveTarget=async()=>null,receipt=receiptOf,notify=()=>{},log=()=>{}}={}) {
  const file=fileOf(dir,pane.id),claim=file+'.inflight';
  const dispatch=file+'.dispatch';let dispatchFD;
  try{dispatchFD=fs.openSync(dispatch,'wx',0o600);fs.fsyncSync(dispatchFD);syncDir(dir);}
  catch{return {held:true,notSent:true,blocked:true,error:'Held dispatch is reserved or storage unavailable; no automatic recovery.'};}
  try {
  if(fs.existsSync(file+'.quarantine'))return {held:true,notSent:true,blocked:true,error:'Held target is quarantined; explicit recovery required.'};
  let rows=readRows(fs.existsSync(claim)?claim:file);
  let fresh;try{fresh=await resolveTarget(pane.id);}catch{fresh=null;}
  if(!sameTarget(fresh,rows)) {
    if(rows.length)reportRows(pane.id,rows,fresh?.sleeping?'sleeping':'target-unverified',notify,log);
    return {held:true,notSent:true,blocked:true,error:'Held messages retained: intended conversation/provider is unavailable, changed, waiting or asleep.'};
  }
  if(fs.existsSync(claim)) {
    // Re-read after acquiring the process guard; never settle a different batch.
    rows=readRows(claim);
    if(!sameTarget(fresh,rows))return {held:true,notSent:true,blocked:true,error:'Unknown held claim retained for reconciliation.'};
    if(rows.every(r=>receipt(fresh,r))) {
      fs.renameSync(claim,claim+'.'+randomUUID()+'.received');syncDir(dir);
      return {received:true,pane:pane.id,count:rows.length};
    }
    const digest=createHash('sha256').update(fs.readFileSync(claim)).digest('hex');
    let retry;try{retry=JSON.parse(fs.readFileSync(claim+'.retryable','utf8'));}catch{}
    if(retry?.digest!==digest) {
      reportRows(pane.id,rows,'unconfirmed',notify,log);
      return {held:true,uncertain:true,error:'Previous held delivery is unconfirmed; retained without replay.'};
    }
    // Consume proof of zero writes BEFORE retry; crash at any later point fails closed.
    fs.unlinkSync(claim+'.retryable');syncDir(dir);
  } else {
    // Enqueue and claim rename share a short filesystem lock: an append cannot follow
    // an already-open descriptor into a batch after its rows have been selected.
    withQueueLock(file,()=>{fs.renameSync(file,claim);syncDir(dir);});
  }
  rows=readRows(claim);
  try{fresh=await resolveTarget(pane.id);}catch{fresh=null;}
  if(!sameTarget(fresh,rows)) {
    reportRows(pane.id,rows,'target-unverified',notify,log);
    return {held:true,notSent:true,blocked:true,error:'Target changed before held dispatch; batch retained.'};
  }
  let outcome;
  try{outcome=await send(fresh,bundle(rows.map(r=>r.text)));}
  catch(error){outcome={uncertain:true,error:String(error?.message||error)};}
  if(outcome?.notSent===true&&!outcome?.uncertain) {
    // Keep ONE batch in ONE location. Never copy-back then unlink (crash duplicates).
    const proof={digest:createHash('sha256').update(fs.readFileSync(claim)).digest('hex')};
    const fd=fs.openSync(claim+'.retryable','wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(proof));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    syncDir(dir);
    reportRows(pane.id,rows,'not-sent',notify,log);
    return {...outcome,held:true};
  }
  if(rows.every(r=>receipt(fresh,r))) {
    fs.renameSync(claim,claim+'.'+randomUUID()+'.received');syncDir(dir);
    return {received:true,pane:pane.id,count:rows.length};
  }
  reportRows(pane.id,rows,'unconfirmed',notify,log);
  return {held:true,uncertain:true,error:'Held text attempted but receipt is unconfirmed; batch retained without replay.'};
  } catch(error) {
    return {held:true,uncertain:true,error:'Held storage/dispatch could not be verified; retained for reconciliation.'};
  } finally {
    fs.closeSync(dispatchFD);fs.unlinkSync(dispatch);syncDir(dir);
  }
}

/** Has the first held message for this terminal waited the whole window? */
function oldestDue(paneId, { dir, now, windowMs }) {
  try {
    const first = fs.readFileSync(fileOf(dir, paneId), 'utf8').split('\n').find(Boolean);
    return now - Number(JSON.parse(first).at || 0) >= windowMs;
  } catch { return true; }
}

/** Several messages read as one: each in full, oldest first. */
export function bundle(texts) {
  if (texts.length === 1) return texts[0];
  return `[${texts.length} messages arrived while you were working. Read all of them, then act on them together.]\n\n${texts.map((t, i) => `--- message ${i + 1} of ${texts.length} ---\n${t}`).join('\n\n')}`;
}

/**
 * One pass: every held terminal that is now idle gets its messages as one. Never typed into a
 * question or approval (waiting), a stuck or a closed terminal: those keep waiting.
 */
export async function deliverHeld({ panes, send, dir = heldDir(), log = () => {}, now = Date.now(), windowMs = HOLD_WINDOW_MS, resolveTarget, receipt, notify }) {
  const out = [];
  for (const id of heldPanes({ dir })) {
    const pane = panes.find((p) => p.id === id);
    // A working agent takes them too (it folds them into its turn): waiting for its turn to end left
    // messages undelivered for hours. Never into a question/approval or a closed terminal.
    if (!pane || !pane.alive || pane.sleeping || pane.turn === 'waiting' || pane.attention) continue;
    // A working agent gets them together once the first has waited the window; an idle one at once.
    if (pane.turn === 'working' && !oldestDue(id, { dir, now, windowMs })) continue;
    const res=await deliverHeldTo(pane,{send,dir,log,resolveTarget,receipt,notify});
    if(res.received)out.push(res);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Held messages must never be lost without the sender knowing (Noam 2026-10-27: five corrections were held
// for a helper that was closed 3 minutes later, and the bot had told him they were passed on).

export const STRAND_GRACE_MS = 15_000;      // a terminal gone this long: its held messages cannot go in
export const STRAND_STUCK_MS = 5 * 60_000;  // a terminal waiting on a person this long: tell the sender once
export const STRAND_STALE_MS = 30 * 60_000; // legacy export; age never authorizes expiry or deletion
export const QUARANTINE_AFTER_MS = 60 * 60_000; // old AND authoritatively absent; never expiry

const told = new Set();

/** The bot a framed message came from ("(bot:<id>)" in its first line), or null. */
export function senderOf(text) {
  const m = /\(bot:([0-9a-f]{6,})\)/.exec(String(text || '').slice(0, 400));
  return m ? m[1] : null;
}

function readRows(file) {
  try {
    const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
    return rows.every(r=>r&&typeof r==='object'&&typeof r.pane==='string'&&typeof r.text==='string')?rows:[];
  }catch{return [];}
}

function writeExclusive(file,data) {
  const fd=fs.openSync(file,'wx',0o600);
  try{fs.writeFileSync(fd,JSON.stringify(data)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  syncDir(path.dirname(file));
}

// Caller has an authoritative dead-pane inventory. Cooperates with enqueue and dispatch.
// Reservation is durable BEFORE any move: interrupted quarantine always blocks replay.
function quarantineBatch(file,now) {
  const dir=path.dirname(file),marker=file+'.quarantine';
  if(fs.existsSync(marker))return marker;
  let guard;try{guard=fs.openSync(file+'.dispatch','wx',0o600);fs.fsyncSync(guard);syncDir(dir);}catch{return null;}
  try{return withQueueLock(file,()=>{
    if(fs.existsSync(marker))return marker;
    const entries=[];let rows=[];
    for(const [source,saved] of [[file,'queued.jsonl'],[file+'.inflight','inflight.jsonl'],[file+'.inflight.retryable','retryable.json']]){
      if(!fs.existsSync(source))continue;
      const bytes=fs.readFileSync(source);
      if(saved!=='retryable.json'){
        const parsed=readRows(source);if(!parsed.length)throw Error('Unreadable held rows retained in place.');rows.push(...parsed);
      }
      entries.push({source:path.basename(source),saved,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
    }
    if(!rows.length||now-Math.max(...rows.map(r=>Number(r.at)||now))<QUARANTINE_AFTER_MS)return null;
    const id=randomUUID(),parent=path.join(dir,'quarantine'),root=path.join(parent,id);
    fs.mkdirSync(parent,{recursive:true,mode:0o700});syncDir(dir);
    fs.mkdirSync(root,{mode:0o700});syncDir(parent);
    const data={version:1,id,pane:rows[0].pane,quarantinedAt:now,reason:'old-dead-target',
      receiptState:entries.some(e=>e.saved==='inflight.jsonl')?'unconfirmed':'not-attempted',
      targets:rows.map(r=>({rowId:r.id||null,at:r.at,pane:r.pane,provider:r.provider||null,sessionId:r.sessionId||null,
        sender:senderOf(r.text),delivery:/\[delivery (D-[0-9a-f]{8})\]\s*$/.exec(r.text)?.[1]||null})),
      files:entries,recovery:'Explicit maintenance only: quiesce senders, verify hashes and exact target/receipt. Never automatic replay, expiry or deletion.'};
    writeExclusive(path.join(root,'manifest.json'),data);
    writeExclusive(marker,{version:1,id,pane:data.pane});
    for(const entry of entries)fs.renameSync(path.join(dir,entry.source),path.join(root,entry.saved));
    syncDir(root);syncDir(dir);return marker;
  });}catch{return fs.existsSync(marker)?marker:null;}
  finally{fs.closeSync(guard);fs.unlinkSync(file+'.dispatch');syncDir(dir);}
}

function reportQuarantine(marker,status,out) {
  if(!status)return;
  try{
    const reservation=JSON.parse(fs.readFileSync(marker,'utf8'));
    if(!/^[0-9a-f-]{36}$/.test(reservation.id))return;
    const root=path.join(path.dirname(marker),'quarantine',reservation.id);
    const data=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    // Interrupted moves preserve bytes at their original location; status never calls it received.
    for(const entry of data.files){
      if(!['queued.jsonl','inflight.jsonl','retryable.json'].includes(entry.saved)||path.basename(entry.source)!==entry.source)return;
      const archived=path.join(root,entry.saved),original=path.join(path.dirname(marker),entry.source);
      const bytes=fs.readFileSync(fs.existsSync(archived)?archived:original);
      if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)return;
    }
    for(const sender of new Set(data.targets.map(r=>r.sender).filter(Boolean))){
      const ack=path.join(root,'status-'+sender+'.json');
      const id='held-quarantine:'+data.id+':'+sender;
      try{const saved=JSON.parse(fs.readFileSync(ack,'utf8'));if(saved.id===id&&saved.recorded===true)continue;}catch{}
      const event={id,sender,pane:data.pane,receiptState:data.receiptState,
        quarantineId:data.id,targets:data.targets.filter(r=>r.sender===sender)};
      try{
        status(event);
        const temp=ack+'.'+randomUUID();writeExclusive(temp,{id:event.id,recorded:true});
        fs.renameSync(temp,ack);syncDir(root);
        out.push({pane:data.pane,sender,reason:'quarantined',id:event.id});
      }catch{/* Stable event ID makes storage retries idempotent. */}
    }
  }catch{/* Unknown manifest/bytes remain reserved; explicit maintenance only. */}
}

/** Internal delivery evidence only; no message, bot wake, task completion or receipt claim. */
export function recordHeldQuarantineStatus(event,record) {
  record({bot_id:event.sender,source_id:event.id,action_id:event.id,kind:'delivery',state:'interrupted',
    terminal_id:event.pane,session_id:event.targets.every(t=>t.sessionId===event.targets[0]?.sessionId)?event.targets[0]?.sessionId:null,
    result_code:event.receiptState==='unconfirmed'?'held_quarantined_unconfirmed':'held_quarantined_not_attempted',
    source_ref:'held-quarantine/'+event.quarantineId});
}

/**
 * One pass over the hold queue. Dead or old rows remain recoverable in place and each sender is told.
 * No automatic expiry, replay or destructive archival. A terminal waiting on a person for a long time:
 * the sender is told once and the messages stay held.
 * `notify({ sender, pane, rows, reason })` does the telling. Returns what it did, for tests and the log.
 */
export function sweepStranded({ panes, notify=()=>{}, status, dir = heldDir(), now = Date.now() }) {
  const out = [];
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')||f.endsWith('.jsonl.inflight')); } catch { return out; }
  for(const name of fs.readdirSync(dir).filter(n=>n.endsWith('.jsonl.quarantine')))reportQuarantine(path.join(dir,name),status,out);
  for (const name of names) {
    const file = path.join(dir, name);
    const queue=file.endsWith('.inflight')?file.slice(0,-'.inflight'.length):file;
    if(fs.existsSync(queue+'.quarantine'))continue;
    const rows = readRows(file);
    if (!rows.length) continue;
    const paneId = rows[0].pane;
    const pane = panes.find((p) => p.id === paneId);
    const newest = Math.max(...rows.map((r) => Number(r.at) || 0));
    const oldest = Math.min(...rows.map((r) => Number(r.at) || now));
    const gone = !pane || (!pane.alive&&!pane.sleeping);
    if(gone&&now-newest>=QUARANTINE_AFTER_MS){
      const marker=quarantineBatch(queue,now);if(marker)reportQuarantine(marker,status,out);
      continue;
    }
    const waiting = !gone && (pane.turn === 'waiting' || pane.attention) && now - oldest >= STRAND_STUCK_MS;
    const reason=gone&&now-newest>=STRAND_GRACE_MS
      ?(name.endsWith('.inflight')?'unconfirmed':'closed')
      :waiting?(name.endsWith('.inflight')?'unconfirmed':'waiting'):null;
    if(!reason)continue;
    const senders=new Set(rows.map(r=>senderOf(r.text)).filter(Boolean));
    const batch=createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    for(const sender of senders.size?senders:[null]){
      const key=[file,batch,reason,sender].join('|');if(told.has(key))continue;
      const mine=sender?rows.filter(r=>senderOf(r.text)===sender):rows;
      try{if(sender)notify({sender,pane:paneId,rows:mine,reason});}catch{continue;}
      told.add(key);out.push({pane:paneId,sender,count:mine.length,reason});
    }
  }
  return out;
}

/** The plain sentence the sending bot is woken with. */
export function strandedText({ pane, rows, reason }) {
  const first = String(rows[0]?.text || '').replace(/^\[Message from[^\]]*\]\s*/, '').replace(/\s+/g, ' ').slice(0, 160);
  const count = rows.length === 1 ? 'Your message' : `Your ${rows.length} messages`;
  if(['unconfirmed','target-unverified','sleeping','not-sent'].includes(reason))return `Delivery unconfirmed: ${count} to terminal ${pane} remain stored (${reason}; first one: "${first}"). Do not replay them or start a replacement. Reconcile the exact conversation and recorded receipt first.`;
  return reason === 'closed'
    ? `NOT delivered: ${count} to terminal ${pane} remain stored because that terminal was closed (first one: "${first}"). Do not send them again automatically; reconcile the intended conversation and receipt first. Nothing was expired or deleted.`
    : `NOT delivered yet: ${count} to terminal ${pane} still wait, because that terminal has been waiting for a person for over 5 minutes (a question or a menu) and cannot read them (first one: "${first}"). Check the exact conversation and what it is asking. Do not replay or replace it automatically.`;
}
