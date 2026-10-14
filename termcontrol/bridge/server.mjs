#!/usr/bin/env node
// TermControl bridge — read-only phase. Serves the fleet list, per-pane chat,
// and the phone app itself. Binds to localhost by default; TC_HOST=0.0.0.0 to
// reach it from a phone on the same network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { canvasSidebarView, listPanes, reconcileLivePanes, readWorkspace, inventoryVersion } from './inventory.mjs';
import { transcriptPath as codexTranscript } from './adapters/codex.mjs';
import { claudeTranscript } from './paths.mjs';
import { readFeed } from './feed.mjs';
import { handleAuthRoutes, currentUser, requireAuth } from './auth.mjs';
import { sendToPane, answerPrompt, sendCustomAnswer, sendKey, liveSessionIds, toggleMultiChoice, submitMultiChoice } from './send.mjs';
import { adapterFor } from './feed.mjs';
import { readPrefs, writePrefs, byProject, moveInOrder } from './prefs.mjs';
import { liveness, lastLine, screenOf } from './liveness.mjs';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';
import { pendingAsk, screenPermissionAsk, matchesAsk, questionResults } from './asks.mjs';
import { deskRoot, readDesk } from './desk.mjs';
import { ChoiceReceipts } from './choice-receipts.mjs';
import { visibleScreenOf } from './screen.mjs';
import { readSessionStatus, subscribeSessionEventHeads, applyVendorStatus, stalledFor } from './session-status.mjs';
import { commandsFor, probeCommands } from './commands.mjs';
import { visits } from './visits.mjs';
import { filesIn, matchFiles } from './files.mjs';
import { projectCatalog, resolveProject, projectLaunchArgs, projectLaunchReady, projectLaunchCapabilityPath, PROJECT_PROVIDERS, legacyProjectChoice } from './projects.mjs';
import { spawnArgs } from './spawn.mjs';
import { transcribe, prepareTranscriber, recentTranscriptionTimings, MAX_AUDIO_BYTES } from './transcribe/index.mjs';
import { safeUrl, crossSiteWrite } from './guard.mjs';
import { readBody, firstFile, saveImage } from './uploads.mjs';
import { Rooms } from './rooms.mjs';
import { createSendOnce } from './send-once.mjs';
import { contextFill } from './context-fill.mjs';
import { Routines, describeDays } from './routines.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');
const choiceReceipts = new ChoiceReceipts(path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'choice-receipts.json'));
// The deployed provider form needs consented acceptance before this path opens.
const customAnswersVerified = process.env.TC_VERIFIED_CUSTOM_ANSWERS === '1';

/** Changes whenever the app file does, so a phone can tell it is out of date. */
function appVersion() {
  try {
    const { mtimeMs, size } = fs.statSync(path.join(appDir, 'index.html'));
    return `${Math.round(mtimeMs)}-${size}`;
  } catch {
    return 'unknown';
  }
}

const PORT = Number(process.env.TC_PORT || 7810);
const HOST = process.env.TC_HOST || '127.0.0.1';
const MAX_AGE = Number(process.env.TC_MAX_AGE_HOURS || 24) * 3600 * 1000;

const json = (res, code, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
};

function speechTimingHeader(res, timings = {}) {
  const stages = { upload: 'uploadMs', queue: 'queueMs', startup: 'workerStartupMs',
    warmup: 'warmupMs', decode: 'decodeMs', detect: 'detectMs', inference: 'inferenceMs', total: 'requestMs' };
  res.setHeader('Server-Timing', Object.entries(stages)
    .filter(([, key]) => Number.isFinite(timings[key]))
    .map(([name, key]) => `${name};dur=${Math.max(0, timings[key]).toFixed(1)}`).join(', '));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// Home-screen icon + manifest: the phone fetches these without the sign-in cookie.
const PUBLIC_APP_FILES = new Set(['/app/manifest.webmanifest', '/app/icon-192.png', '/app/icon-512.png', '/app/icon-maskable-512.png', '/app/apple-touch-icon.png', '/app/favicon-32.png']);

function serveStatic(res, name) {
  const file = path.join(appDir, name);
  if (!file.startsWith(appDir) || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    // Phones hold on to a page for a long time. Without this you keep using
    // last week's app and every fix looks like it never shipped.
    'cache-control': 'no-store, must-revalidate',
    pragma: 'no-cache',
    expires: '0',
  });
  res.end(body);
}


/**
 * A pane record outlives its terminal: closed panes keep their status file, so
 * the phone would list terminals that no longer exist (and, since they are also
 * gone from the workspace, without their project emoji). The daemon is the
 * authority on what is actually running, so the list is filtered against it.
 * If the daemon cannot be reached we show everything rather than an empty
 * screen, and say so.
 */
/**
 * When a conversation file was last written is the plainest "last used" there
 * is, and it exists even for agents that never wrote a status record (a Codex
 * started by hand, say). 0 when the terminal has no conversation yet.
 */
function conversationMtime(pane) {
  try {
    const file = pane.provider === 'codex' ? codexTranscript(pane)
      : pane.provider === 'claude' ? claudeTranscript(pane.cwd, pane.sessionId)
      : null;
    return file ? fs.statSync(file).mtimeMs : 0;
  } catch { return 0; }
}

/** Last resort for a terminal nothing else has news of: when its process began. */
function startedAt(pid) {
  try { return pid ? fs.statSync(`/proc/${pid}`).ctimeMs : 0; } catch { return 0; }
}

async function currentPanes() {
  // Age is now the phone's own filter (today / 3 days / week / all), applied to
  // lastActiveAt, so the bridge sends every terminal that has a card on the map.
  const workspace = readWorkspace();
  const snapshot = { view: canvasSidebarView(workspace), inventoryVersion: inventoryVersion(workspace) };
  const panes = listPanes({ maxAgeMs: null, workspace });
  const { reachable, byId } = await liveness();
  if (!reachable) {
    return {
      panes: panes.map((p) => {
        const pane = applyVendorStatus({ ...p, ...readSessionStatus(p) });
        const ask = pendingAsk(pane);
        return { ...pane, attention: ask ? { kind: ask.kind, title: ask.title } : null };
      }),
      daemon: false, ...snapshot,
    };
  }

  const withLife = reconcileLivePanes(panes, byId, workspace)
    .map((p) => {
      const life = byId.get(p.id);
      const pane = applyVendorStatus({ ...p, ...readSessionStatus(p) });
      const ask = pendingAsk(pane);
      // Last time the terminal was used: the later of what its agent last
      // reported and the last time its own output grew. 0 when unknown.
      const lastActiveAt = Math.max(Number(p.updatedAt) || 0, conversationMtime(p), life.quietForMs != null ? Date.now() - life.quietForMs : 0) || startedAt(life.pid);
      return {
        ...pane,
        alive: true,
        lastActiveAt,
        // "Working" with no output and no conversation change for a long time is
        // how a hung run looks; say so instead of showing a calm "working".
        stalledForMs: stalledFor(pane, life, lastActiveAt),
        // How full the agent's working memory is; predicts a squeeze or a handover.
        contextPercent: contextFill(pane)?.percent ?? null,
        producing: life.producing,
        quietForMs: life.quietForMs,
        // What the agent last said about itself, kept honest by what the
        // terminal is actually doing.
        live: pane.sessionAuthority ? pane.sessionViewV2.lifecycle : life.producing ? 'producing' : pane.turn === 'waiting' ? 'waiting' : 'quiet',
        // The fleet only needs enough information to lead the operator to the
        // right terminal. The full prompt and choices stay in /api/feed.
        attention: ask ? { kind: ask.kind, title: ask.title } : null,
      };
    });

  return { panes: withLife, daemon: true, ...snapshot };
}

const sendOnce = createSendOnce();

// Shared rooms deliver through the same path as a typed phone message.
const rooms = new Rooms({
  send: (pane, text) => sendToPane(pane, text),
  readFeed: (pane) => readFeed(pane, { limit: 30 }),
});
let roomPolling = false;
setInterval(async () => {
  if (roomPolling || !rooms.data.rooms.some((room) => room.pending.length)) return;
  roomPolling = true;
  try { await rooms.poll((await currentPanes()).panes); } catch (error) { console.error('[rooms]', error.message); } finally { roomPolling = false; }
}, 3000).unref();

// Scheduled messages go out through the same checked path as a typed one.
const routines = new Routines({ send: (pane, text) => sendToPane(pane, text) });
let routineTicking = false;
setInterval(async () => {
  if (routineTicking || !routines.data.routines.some((r) => r.enabled && r.nextRunAt && r.nextRunAt <= Date.now())) return;
  routineTicking = true;
  try { await routines.tick((await currentPanes()).panes); } catch (error) { console.error('[routines]', error.message); } finally { routineTicking = false; }
}, 30000).unref();

async function readJson(req, max = 64 * 1024) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > max) throw Object.assign(new Error('Request too large.'), { code: 413 }); }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid request.'), { code: 400 }); }
}

const AGENT_PROVIDERS = new Set(['claude', 'codex', 'opencode']);

async function handleRooms(req, res, url) {
  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    const { panes } = await currentPanes();
    const agents = panes.filter((p) => AGENT_PROVIDERS.has(p.provider))
      .map((p) => ({ id: p.id, label: p.title || p.name || p.project, project: p.project, provider: p.provider, color: p.color }));
    return json(res, 200, { rooms: rooms.list(), agents });
  }
  let body;
  try { body = req.method === 'POST' ? await readJson(req) : {}; } catch (error) { return json(res, error.code || 400, { error: error.message }); }
  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    const { panes } = await currentPanes();
    const ids = Array.isArray(body.panes) ? body.panes : [];
    const chosen = ids.map((id) => panes.find((p) => p.id === id && AGENT_PROVIDERS.has(p.provider))).filter(Boolean);
    if (chosen.length !== ids.length) return json(res, 409, { error: 'One of those agents is no longer running. Refresh and pick again.' });
    const result = rooms.create(body.name, chosen);
    return json(res, result.error ? 400 : 200, result.error ? result : { ok: true, room: result.room });
  }
  if (url.pathname === '/api/rooms/delete' && req.method === 'POST') {
    const result = rooms.remove(body.id);
    return json(res, result.error ? 404 : 200, result);
  }
  if (url.pathname === '/api/room' && req.method === 'GET') {
    const room = rooms.get(url.searchParams.get('id'));
    if (!room) return json(res, 404, { error: 'That room no longer exists.' });
    const { panes } = await currentPanes();
    const members = room.members.map((m) => {
      const pane = panes.find((p) => p.id === m.pane);
      return { ...m, alive: Boolean(pane), working: Boolean(pane && (pane.producing || pane.turn === 'working')), waiting: room.pending.some((p) => p.pane === m.pane) };
    });
    return json(res, 200, { room: { id: room.id, name: room.name, members, messages: room.messages.slice(-200) } });
  }
  if (url.pathname === '/api/room/post' && req.method === 'POST') {
    const { panes } = await currentPanes();
    const result = await rooms.post(body.id, body.text, panes);
    return json(res, result.error ? 400 : 200, result);
  }
  return json(res, 404, { error: 'not found' });
}

const handle = async (req, res) => {
  const url = safeUrl(req);
  if (!url) return json(res, 400, { error: 'Bad request.' });
  if (crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });

  if (req.method === 'GET' && PUBLIC_APP_FILES.has(url.pathname)) return serveStatic(res, url.pathname.slice(5));
  if (await handleAuthRoutes(req, res, url)) return;
  if (res.writableEnded) return;
  if (!currentUser(req)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorised' });
    return requireAuth(res);
  }

  if(req.method==='GET' && url.pathname==='/api/session-events') {
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
    res.write('data: "rescan"\n\n');
    const unsubscribe=subscribeSessionEventHeads(name=>res.write(`data: ${JSON.stringify(name)}\n\n`));
    const heartbeat=setInterval(()=>res.write(': heartbeat\n\n'),15000);
    req.on('close',()=>{unsubscribe();clearInterval(heartbeat);});return;
  }
  if (url.pathname === '/api/panes') {
    const inventory = await currentPanes();const daemon=inventory.daemon;const history=visits.read(currentUser(req).id);const panes=inventory.panes.map(p=>({...p,lastUsedAt:history[p.id] || null}));
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      version: appVersion(),
      daemon,
      view: inventory.view,
      inventoryVersion: inventory.inventoryVersion,
      panes,
      groups: byProject(panes),
    });
  }

  if (url.pathname === '/api/routines' && req.method === 'GET') {
    return json(res, 200, { routines: routines.forPane(url.searchParams.get('pane')).map((r) => ({ ...r, label: describeDays(r.days) })) });
  }
  if ((url.pathname === '/api/routines' || url.pathname === '/api/routines/delete') && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    if (url.pathname === '/api/routines/delete') { const result = routines.remove(body.id); return json(res, result.error ? 404 : 200, result); }
    const { panes } = await currentPanes();
    if (!panes.some((p) => p.id === body.pane)) return json(res, 409, { error: 'That agent is no longer running.' });
    const result = routines.create(body);
    return json(res, result.error ? 400 : 200, result);
  }

  // One inbox: every open question or permission request across the fleet, with
  // its choices, so they can be answered without opening each chat.
  if (url.pathname === '/api/inbox' && req.method === 'GET') {
    const { panes } = await currentPanes();
    const items = [];
    for (const pane of panes.filter((p) => p.attention || p.turn === 'waiting')) {
      const screen = visibleScreenOf(pane.id) ?? await screenOf(pane.id);
      const ask = pendingAsk(pane, { screen }) || screenPermissionAsk(pane, screen);
      items.push({
        pane: { id: pane.id, title: pane.title || pane.name || pane.project, project: pane.project, provider: pane.provider, color: pane.color, lastActiveAt: pane.lastActiveAt },
        ask: ask ? { id: ask.id, kind: ask.kind, title: ask.title, header: ask.header, options: ask.options || [], multiSelect: Boolean(ask.multiSelect), stage: ask.stage || null } : null,
        receipt: ask ? choiceReceipts.get(pane.id, ask.id) : null,
      });
    }
    // Oldest wait first: whoever has been waiting longest is answered first.
    items.sort((a, b) => (a.pane.lastActiveAt || 0) - (b.pane.lastActiveAt || 0));
    return json(res, 200, { items, version: appVersion() });
  }

  if (url.pathname === '/api/rooms' || url.pathname.startsWith('/api/rooms/') || url.pathname === '/api/room' || url.pathname.startsWith('/api/room/')) return handleRooms(req, res, url);

  if (url.pathname === '/api/visit' && req.method === 'POST') {
    let raw='';for await (const chunk of req){raw+=chunk;if(raw.length>1024)return json(res,413,{error:'Request too large.'});}
    let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'Invalid visit.'});}
    const {panes}=await currentPanes();if(!panes.some(p=>p.id===body.pane))return json(res,409,{error:'That conversation is no longer available.'});
    try{return json(res,200,{ok:true,lastUsedAt:visits.record(currentUser(req).id,body.pane)});}catch{return json(res,503,{error:'Recent conversation history could not be saved.'});}
  }

  if (url.pathname === '/api/prefs') {
    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 32768) req.destroy(); });
      req.on('end', async () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad request' }); }

        if (body.move && (body.direction === 'up' || body.direction === 'down')) {
          const { panes } = await currentPanes();
          const order = moveInOrder(panes, readPrefs().order, body.move, body.direction);
          return json(res, 200, writePrefs({ view: 'manual', order }));
        }
        return json(res, 200, writePrefs(body));
      });
      return;
    }
    return json(res, 200, readPrefs());
  }

  if (url.pathname === '/api/desk' && req.method === 'GET') {
    const { panes } = await currentPanes();
    const pane = panes.find(p => p.id === url.searchParams.get('pane'));
    return json(res, pane ? 200 : 404, pane ? readDesk(pane) : {error:'That terminal has been closed.'});
  }

  if (url.pathname === '/api/feed') {
    const id = url.searchParams.get('pane');
    const limit = Math.min(Number(url.searchParams.get('limit') || 60), 200);
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === id);
    if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });
    const screen = visibleScreenOf(pane.id) ?? await screenOf(pane.id);
    const transcriptAsk = pendingAsk(pane, { screen });
    const ask = transcriptAsk || screenPermissionAsk(pane, screen);
    return json(res, 200, {
      pane,
      version: appVersion(),
      live: pane.live,
      producing: pane.producing,
      ask: ask ? { ...ask, screen, customAnswerSupported: customAnswersVerified && pane.provider==='claude' && ask.stage!=='review' } : null,
      desk: Boolean(deskRoot(pane)),
      answerReceipt: ask ? choiceReceipts.get(pane.id, ask.id) : null,
      questionResults: questionResults(pane),
      ...readFeed(pane, { limit }),
    });
  }

  if(url.pathname==='/api/projects' && req.method==='GET'){
    if(!projectLaunchReady(projectLaunchCapabilityPath()))return json(res,404,{error:'Open the updated TermFleet app to enable the global project picker.',capabilityVersion:1});
    return json(res,200,{projects:projectCatalog(readWorkspace()),providers:PROJECT_PROVIDERS,ready:true,capabilityVersion:2});
  }

  // Start a new agent in a project folder the fleet already knows. It appears
  // as a normal visible card in TermFleet; nothing existing is touched.
  if (url.pathname === '/api/spawn' && req.method === 'POST') {
    let raw='';for await (const chunk of req){raw+=chunk;if(raw.length>16384)return json(res,413,{error:'Request too large.'});}
    let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'Invalid request.'});}
    const provider=PROJECT_PROVIDERS.some(p=>p.id===body.provider)?body.provider:null;
    const task=typeof body.task==='string'?body.task.trim():'';
    if(!provider)return json(res,400,{error:'Choose an available agent provider.'});
    if(!task)return json(res,400,{error:'Say what the new agent should do.'});
    let project,legacy;
    if(body.projectId===undefined && typeof body.project==='string'){
      if(!['claude','codex'].includes(provider))return json(res,400,{error:'Choose Claude or Codex for an existing project group.'});
      const workspace=readWorkspace(),{reachable,byId}=await liveness();
      if(!reachable)return json(res,503,{error:'TermFleet is unavailable. Check the app before starting another agent.'});
      // Map ownership and daemon liveness are enough for this legacy route;
      // provider process environment discovery is unnecessary here.
      const panes=reconcileLivePanes(listPanes({maxAgeMs:null,workspace}),byId,workspace,new Map());
      try{legacy=legacyProjectChoice(panes,workspace,body.project);}catch(error){return json(res,409,{error:error.message});}
    }else{
      try{project=resolveProject(readWorkspace(),body.projectId);}catch(error){return json(res,409,{error:error.message});}
      if(!projectLaunchReady(projectLaunchCapabilityPath()))return json(res,409,{error:'Open the updated TermFleet app before starting project agents.'});
    }
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-spawn-'));const file=path.join(dir,'task.md');
    fs.writeFileSync(file,task,{mode:0o600});
    const args=legacy?spawnArgs(legacy,provider,file):projectLaunchArgs(project,provider,file);
    const {execFile}=await import('node:child_process');
    return execFile('termfleet-child',args,{timeout:60000},(err,stdout,stderr)=>{
      fs.rmSync(dir,{recursive:true,force:true});
      let out={};try{out=JSON.parse(stdout);}catch{}
      if(err){
        const known={
          'provider-unavailable':'The selected agent is not available in TermFleet.',
          'unknown-project':'That project is no longer available. Refresh the list.',
          'project-changed':'That project changed. Refresh and review it again.',
          'duplicate-request':'This launch has already been handled. Check TermFleet.',
          'start-failed':'The terminal was created but the agent did not start. Check TermFleet before retrying.',
        };
        return json(res,502,{error:known[out.reason] || (stderr||err.message||'Could not start the agent.').toString().slice(0,300),uncertain:Boolean(out.childPaneId) || !out.reason});
      }
      if(out.ok!==true || !out.childPaneId)return json(res,502,{error:'The new terminal was not confirmed. Check TermFleet before retrying.',uncertain:true});
      return json(res,200,{ok:true,childPaneId:out.childPaneId});
    });
  }

  if (url.pathname === '/api/send' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 12 * 1024 * 1024) req.destroy(); });
    req.on('end', async () => {
      let payload = {};
      try { payload = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad request' }); }
      const { panes } = await currentPanes();
      const pane = panes.find((p) => p.id === payload.pane);
      if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });

      if (payload.key) {
        const result = await sendKey(pane, payload.key);
        return json(res, result.error ? 400 : 200, result);
      }

      if (payload.choice || typeof payload.answer === 'string') {
        if(typeof payload.answer==='string' && !customAnswersVerified)return json(res,409,{error:'Custom answers are disabled until this terminal form has been verified. Use its choices or the terminal.',notSent:true});
        const existing = choiceReceipts.get(pane.id, payload.askId);
        const answer = payload.choice || payload.answer;
        if (existing && existing.state !== 'not-sent' && !payload.multi) {
          const result = await choiceReceipts.send(pane.id, payload.askId, answer, () => {throw new Error('Unreachable');});
          return json(res, result.error ? 409 : 200, result);
        }
        // Re-read immediately before injecting a key. A phone can keep an old
        // prompt visible after the terminal has moved on or asked a new one.
        const fresh = (await currentPanes()).panes.find((candidate) => candidate.id === payload.pane);
        const visible = fresh ? visibleScreenOf(fresh.id) : null;
        const freshScreen = fresh ? visible ?? await screenOf(fresh.id) : '';
        const freshAsk = fresh && (pendingAsk(fresh, { screen: freshScreen }) || screenPermissionAsk(fresh, freshScreen));
        if (!fresh || !freshAsk || freshAsk.id !== payload.askId || (payload.choice && payload.choice !== 'submit-multi' && !matchesAsk(freshAsk, payload.askId, payload.choice)) || (typeof payload.answer==='string' && (freshAsk.kind!=='question' || freshAsk.stage==='review'))) {
          return json(res, 409, { error: 'That question or permission request is no longer active. Refresh and check the terminal again.' });
        }
        const adapter = adapterFor(fresh);
        // TermFleet stops refreshing the visible text of a terminal scrolled off the
        // desktop map while still stamping it as observed. When that copy lacks the
        // question, accept the daemon's live bottom rows only if they show this exact
        // question inside an open selection menu.
        const squash = (text) => String(text || '').replace(/[\u2500-\u257f\s]+/g,'');
        const showsQuestion = (text) => squash(text).includes(squash(freshAsk.title));
        let questionScreen = visible;
        if (freshAsk.kind === 'question' && !showsQuestion(visible)) {
          const live = await screenOf(fresh.id);
          if (showsQuestion(live) && /❯\s*1\.|Enter to select|Esc to cancel/.test(live)) questionScreen = live;
        }
        if (freshAsk.kind === 'question' && freshAsk.multiSelect && freshAsk.stage !== 'review' && fresh.provider === 'claude') {
          // Pick-several: ticks and typed text change the open form without answering it,
          // so they skip the one-answer receipt; only Submit is recorded as the answer.
          if (questionScreen===null || !showsQuestion(questionScreen)) return json(res,409,{error:'This question is not visible in TermFleet right now. Check the terminal before answering.',notSent:true});
          const screenFn = (options) => visibleScreenOf(fresh.id,options) || '';
          if (payload.choice === 'submit-multi') {
            const result = await choiceReceipts.send(fresh.id, freshAsk.id, 'submit', () => submitMultiChoice(fresh, freshAsk, { screen: screenFn }));
            return json(res, result.error ? 400 : 200, result);
          }
          const result = typeof payload.answer === 'string'
            ? await sendCustomAnswer(fresh, freshAsk, payload.answer, { screen: screenFn })
            : await toggleMultiChoice(fresh, freshAsk, payload.choice, { screen: screenFn });
          return json(res, result.error ? 400 : 200, result);
        }
        if (freshAsk.kind === 'question' && (questionScreen===null || freshAsk.multiSelect || !showsQuestion(questionScreen))) return json(res,409,{error:'This question needs a fresh visible single-answer field in TermFleet. Check the terminal before answering.',notSent:true});
        const result = await choiceReceipts.send(fresh.id, freshAsk.id, answer, () => typeof payload.answer==='string'
          ? sendCustomAnswer(fresh, freshAsk, payload.answer, {screen:(options) => visibleScreenOf(fresh.id,options) || ''})
          : answerPrompt(fresh, payload.choice, adapter?.approval, freshAsk.stage==='review'?'question-submit':freshAsk.kind));
        return json(res, result.error ? 400 : 200, result);
      }

      const screen = await screenOf(pane.id);
      const active = pendingAsk(pane, {screen}) || screenPermissionAsk(pane,screen);
      if (active) return json(res,409,{error:'A question is open. Use its choices or Write my answer so your reply reaches the right field.'});

      const result = await sendOnce(payload.sendId, payload.text, () => sendToPane(pane, payload.text, { force: Boolean(payload.force) }));
      return json(res, result.error && !result.busy ? 400 : 200, result);
    });
    return;
  }

  // Start cold loading while recording; no clip or text is accepted here.
  // This is only a hint: the eventual clip still selects its actual language.
  if (url.pathname === '/api/transcribe/timings' && req.method === 'GET') {
    return json(res, 200, { timings: recentTranscriptionTimings() });
  }
  if (url.pathname === '/api/transcribe/prepare' && req.method === 'POST') {
    const language = ['he', 'en'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : null;
    try { return json(res, 200, await prepareTranscriber({ language })); }
    catch { return json(res, 503, { prepared: false }); }
  }

  // Dictation: a recorded clip in, text out. Hebrew and English are told apart
  // automatically; everything runs on this machine.
  if (url.pathname === '/api/transcribe' && req.method === 'POST') {
    const received = performance.now();
    let audio;
    try { audio = await readBody(req, MAX_AUDIO_BYTES); } catch { return json(res, 413, { error: 'That recording is too long.' }); }
    const uploadMs = Math.round((performance.now() - received) * 10) / 10;
    const lang = ['he', 'en'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : null;
    try {
      const { text, language, seconds, timings: stages } = await transcribe(audio, { language: lang, uploadMs });
      const timings = { ...stages, uploadMs, requestMs: Math.round((performance.now() - received) * 10) / 10 };
      speechTimingHeader(res, timings);
      return json(res, 200, { text, language, seconds, timings });
    } catch (error) {
      const timings = { ...error.timings, uploadMs, requestMs: Math.round((performance.now() - received) * 10) / 10 };
      speechTimingHeader(res, timings);
      if (error.statusCode === 503) res.setHeader('Retry-After', '2');
      return json(res, error.statusCode === 503 ? 503 : 502, { error: error.message || 'Could not turn that into text.', timings });
    }
  }

  if (url.pathname === '/api/upload' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 413, { error: 'That image is too large.' });
    }
    const file = firstFile(body, req.headers['content-type']);
    if (!file) return json(res, 400, { error: 'No image was received.' });

    const saved = saveImage(file);
    if (saved.error) return json(res, 400, saved);
    return json(res, 200, { path: saved.path, bytes: saved.bytes, name: file.name });
  }

  if (url.pathname === '/api/commands') {
    const id = url.searchParams.get('pane');
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === id);
    if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });
    // Ask the agent what it offers, then merge with what is on disk.
    await probeCommands(pane, {
      ask: async (request) => {
        const r = await requestDaemon(request, defaultDaemonSocket());
        if (!r || r.ok !== true) throw new Error('refused');
        return r.value;
      },
      screenOf,
    }).catch(() => {});
    return json(res, 200, { provider: pane.provider, commands: commandsFor(pane.provider) });
  }

  if (url.pathname === '/api/files') {
    const id = url.searchParams.get('pane');
    const query = url.searchParams.get('q') || '';
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === id);
    if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });
    const files = await filesIn(pane.cwd);
    return json(res, 200, { cwd: pane.cwd, files: matchFiles(files, query), total: files.length });
  }

  if (url.pathname === '/api/screen') {
    const id = url.searchParams.get('pane');
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === id);
    if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });
    return json(res, 200, { screen: await screenOf(pane.id), project: pane.project });
  }

  if (url.pathname === '/api/live') {
    return liveSessionIds()
      .then((ids) => json(res, 200, { live: [...ids] }))
      .catch((e) => json(res, 200, { live: [], error: String(e.message || e) }));
  }

  if (url.pathname === '/' || url.pathname === '/index.html') return serveStatic(res, 'index.html');
  if (url.pathname.startsWith('/app/')) return serveStatic(res, url.pathname.slice(5));

  return json(res, 404, { error: 'not found' });
};

// One bad request must never take the bridge down for everyone.
const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error('bridge request failed:', error?.message || error);
    if (!res.headersSent) json(res, 500, { error: 'Something went wrong on your machine.' });
    else res.end();
  });
});

// Liveness needs two looks to know whether output moved, so the bridge takes
// them continuously rather than only when the phone asks. Without this the
// fleet shows nothing as live for the first few seconds after you open it.
setInterval(() => { liveness().catch(() => {}); }, 3000).unref?.();
liveness().catch(() => {});

server.listen(PORT, HOST, () => {
  console.log(`TermControl bridge on http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') console.log('(set TC_HOST=0.0.0.0 to open it from your phone on the same network)');
});
