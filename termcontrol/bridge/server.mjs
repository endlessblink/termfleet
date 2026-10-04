#!/usr/bin/env node
// TermControl bridge — read-only phase. Serves the fleet list, per-pane chat,
// and the phone app itself. Binds to localhost by default; TC_HOST=0.0.0.0 to
// reach it from a phone on the same network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { canvasSidebarView, listPanes, reconcileLivePanes } from './inventory.mjs';
import { transcriptPath as codexTranscript } from './adapters/codex.mjs';
import { claudeTranscript } from './paths.mjs';
import { readFeed } from './feed.mjs';
import { handleAuthRoutes, currentUser, requireAuth } from './auth.mjs';
import { sendToPane, answerPrompt, sendCustomAnswer, sendKey, liveSessionIds } from './send.mjs';
import { adapterFor } from './feed.mjs';
import { readPrefs, writePrefs, byProject, moveInOrder } from './prefs.mjs';
import { liveness, lastLine, screenOf } from './liveness.mjs';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';
import { pendingAsk, screenPermissionAsk, matchesAsk, questionResults } from './asks.mjs';
import { deskRoot, readDesk } from './desk.mjs';
import { ChoiceReceipts } from './choice-receipts.mjs';
import { visibleScreenOf } from './screen.mjs';
import { readSessionStatus } from './session-status.mjs';
import { commandsFor, probeCommands } from './commands.mjs';
import { visits } from './visits.mjs';
import { filesIn, matchFiles } from './files.mjs';
import { readBody, firstFile, saveImage } from './uploads.mjs';

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

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };

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
  const panes = listPanes({ maxAgeMs: null });
  const { reachable, byId } = await liveness();
  if (!reachable) {
    return {
      panes: panes.map((p) => {
        const pane = { ...p, ...readSessionStatus(p) };
        const ask = pendingAsk(pane);
        return { ...pane, attention: ask ? { kind: ask.kind, title: ask.title } : null };
      }),
      daemon: false,
    };
  }

  const withLife = reconcileLivePanes(panes, byId)
    .map((p) => {
      const life = byId.get(p.id);
      const pane = { ...p, ...readSessionStatus(p) };
      const ask = pendingAsk(pane);
      return {
        ...pane,
        alive: true,
        // Last time the terminal was used: the later of what its agent last
        // reported and the last time its own output grew. 0 when unknown.
        lastActiveAt: Math.max(Number(p.updatedAt) || 0, conversationMtime(p), life.quietForMs != null ? Date.now() - life.quietForMs : 0) || startedAt(life.pid),
        producing: life.producing,
        quietForMs: life.quietForMs,
        // What the agent last said about itself, kept honest by what the
        // terminal is actually doing.
        live: life.producing ? 'producing' : p.turn === 'waiting' ? 'waiting' : 'quiet',
        // The fleet only needs enough information to lead the operator to the
        // right terminal. The full prompt and choices stay in /api/feed.
        attention: ask ? { kind: ask.kind, title: ask.title } : null,
      };
    });

  return { panes: withLife, daemon: true };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (await handleAuthRoutes(req, res, url)) return;
  if (res.writableEnded) return;
  if (!currentUser(req)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorised' });
    return requireAuth(res);
  }

  if (url.pathname === '/api/panes') {
    const inventory = await currentPanes();const daemon=inventory.daemon;const history=visits.read(currentUser(req).id);const panes=inventory.panes.map(p=>({...p,lastUsedAt:history[p.id] || null}));
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      version: appVersion(),
      daemon,
      view: canvasSidebarView(),
      panes,
      groups: byProject(panes),
    });
  }

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
      ask: ask ? { ...ask, screen, customAnswerSupported: customAnswersVerified && pane.provider==='claude' && !ask.multiSelect } : null,
      desk: Boolean(deskRoot(pane)),
      answerReceipt: ask ? choiceReceipts.get(pane.id, ask.id) : null,
      questionResults: questionResults(pane),
      ...readFeed(pane, { limit }),
    });
  }

  if (url.pathname === '/api/send' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 32768) req.destroy(); });
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
        if (existing && existing.state !== 'not-sent') {
          const result = await choiceReceipts.send(pane.id, payload.askId, answer, () => {throw new Error('Unreachable');});
          return json(res, result.error ? 409 : 200, result);
        }
        // Re-read immediately before injecting a key. A phone can keep an old
        // prompt visible after the terminal has moved on or asked a new one.
        const fresh = (await currentPanes()).panes.find((candidate) => candidate.id === payload.pane);
        const visible = fresh ? visibleScreenOf(fresh.id) : null;
        const freshScreen = fresh ? visible ?? await screenOf(fresh.id) : '';
        const freshAsk = fresh && (pendingAsk(fresh, { screen: freshScreen }) || screenPermissionAsk(fresh, freshScreen));
        if (!fresh || !freshAsk || freshAsk.id !== payload.askId || (payload.choice && !matchesAsk(freshAsk, payload.askId, payload.choice)) || (typeof payload.answer==='string' && freshAsk.kind!=='question')) {
          return json(res, 409, { error: 'That question or permission request is no longer active. Refresh and check the terminal again.' });
        }
        const adapter = adapterFor(fresh);
        if (freshAsk.kind === 'question' && (visible===null || freshAsk.multiSelect || !String(freshScreen).replace(/\s+/g,' ').includes(freshAsk.title.replace(/\s+/g,' ')))) return json(res,409,{error:'This question needs a fresh visible single-answer field in TermFleet. Check the terminal before answering.',notSent:true});
        const result = await choiceReceipts.send(fresh.id, freshAsk.id, answer, () => typeof payload.answer==='string'
          ? sendCustomAnswer(fresh, freshAsk, payload.answer, {screen:(options) => visibleScreenOf(fresh.id,options) || ''})
          : answerPrompt(fresh, payload.choice, adapter?.approval, freshAsk.kind));
        return json(res, result.error ? 400 : 200, result);
      }

      const screen = await screenOf(pane.id);
      const active = pendingAsk(pane, {screen}) || screenPermissionAsk(pane,screen);
      if (active) return json(res,409,{error:'A question is open. Use its choices or Write my answer so your reply reaches the right field.'});

      const result = await sendToPane(pane, payload.text, { force: Boolean(payload.force) });
      return json(res, result.error && !result.busy ? 400 : 200, result);
    });
    return;
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
