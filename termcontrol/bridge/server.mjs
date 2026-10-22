#!/usr/bin/env node
// TermControl bridge — read-only phase. Serves the fleet list, per-pane chat,
// and the phone app itself. Binds to localhost by default; TC_HOST=0.0.0.0 to
// reach it from a phone on the same network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { canvasSidebarView, listPanes, reconcileLivePanes, readWorkspace, inventoryVersion } from './inventory.mjs';
import { transcriptPath as codexTranscript } from './adapters/codex.mjs';
import { claudeTranscript } from './paths.mjs';
import { readFeed } from './feed.mjs';
import { handleAuthRoutes, currentUser, requireAuth, isLocalRecoveryRequest } from './auth.mjs';
import { sendToPane, answerPrompt, answerScreenChoice, sendCustomAnswer, sendKey, liveSessionIds, toggleMultiChoice, submitMultiChoice } from './send.mjs';
import { requestClose } from '../../scripts/lib/close-request.mjs';
import { botClosePlan, closeBotItems, removeBot } from './bot-close.mjs';
import { cleanupPlan, closeIdleTerminals, descendantsOf, processTable, cardlessSessions, autoCloseFinished } from './idle-cleanup.mjs';
import { appendAction, paneLogFile } from './action-log.mjs';
import { parentsByPane } from './orchestrate.mjs';
import { agentsByPane } from './inventory.mjs';
import { unsavedWork, filesTheAgentChanged } from '../../scripts/lib/team-close.mjs';
import { adapterFor } from './feed.mjs';
import { readPrefs, writePrefs, byProject, moveInOrder } from './prefs.mjs';
import { liveness, lastLine, screenOf } from './liveness.mjs';
import { requestDaemon, defaultDaemonSocket } from '../../scripts/termfleetctl.mjs';
import { pendingAsk, screenPermissionAsk, matchesAsk, questionResults } from './asks.mjs';
import { deskRoot, readDesk } from './desk.mjs';
import { ChoiceReceipts } from './choice-receipts.mjs';
import { visibleScreenOf, liveScreenOf } from './screen.mjs';
import { readSessionStatus, subscribeSessionEventHeads, applyVendorStatus, stalledFor } from './session-status.mjs';
import { readUsageLimits } from './usage-limits.mjs';
import { commandsFor, probeCommands } from './commands.mjs';
import { visits } from './visits.mjs';
import { withSleepingLives, sweepSleep, sleepPane, wakePane, workProcesses, treeRss, readSettings, writeSettings, listSleeping, isSleeping as sleepMarked, setKeepAwake, isKeepAwake, sleepVerdict } from './sleep.mjs';
import { filesIn, matchFiles } from './files.mjs';
import { resolveLocalImage } from './local-image.mjs';
import { projectCatalog, resolveProject, projectLaunchArgs, projectLaunchReady, projectLaunchCapabilityPath, PROJECT_PROVIDERS, legacyProjectChoice } from './projects.mjs';
import { spawnArgs } from './spawn.mjs';
import { applyEnglishTerms } from './english-terms.mjs';
import { transcribe, prepareTranscriber, recentTranscriptionTimings, MAX_AUDIO_BYTES } from './transcribe/index.mjs';
import { readWordFixes, addWordFix, removeWordFix, applyWordFixes, wordFixHint } from './word-fixes.mjs';
import { safeUrl, crossSiteWrite } from './guard.mjs';
import { readBody, firstFile, saveImage } from './uploads.mjs';
import { Rooms } from './rooms.mjs';
import { createSendOnce } from './send-once.mjs';
import { contextFill } from './context-fill.mjs';
import { Routines, describeDays } from './routines.mjs';
import { profiles, rulesMessage } from './profiles.mjs';
import { Bots, PROVIDERS as BOT_PROVIDERS, modelChoices } from './bots.mjs';
import { knownFolders, startFolder, subfolders, makeFolder } from './bot-folders.mjs';
import { listSkills, approveSkill, rejectSkill, suggestSkill, checkSkill } from './skills.mjs';
import { BotBrowser, BROWSER_PORT } from './bot-browser.mjs';
import { sweepWindows, setTakeover, clearTakeover, handBackText, readWindows } from './bot-windows.mjs';
import { report as agentHealthReport } from '../../scripts/termfleet-agent-health.mjs';
import { checkBotEvents, helperState } from './bot-events.mjs';
import { Push } from './push.mjs';
import { createDockIcon } from './dock-icon.mjs';
import { collectWaiting, createWaitingNotifier } from './waiting.mjs';
import { asksForFile, isRealRequest, askTitle, dismissAsk } from '../../scripts/termfleet-asks.mjs';
import { createAsksSidecarWriter, defaultAsksDir } from './asks-sidecar.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = process.env.TC_APP_DIR || path.join(here, '..', 'app');
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

  // Sleeping terminals (their programs ended to free memory) keep their card and row.
  withSleepingLives(byId);
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
        pid: life.pid ?? null,
        startedAt: startedAt(life.pid) || null,
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
        ...(life.sleeping ? { sleeping: true, sleptAt: life.sleptAt, live: 'sleeping', turn: 'idle', producing: false } : {}),
        keepAwake: isKeepAwake(p.id),
      };
    });

  const named = profiles.all();
  return { panes: withLife.map((p) => (named[p.id] ? { ...p, profile: named[p.id] } : p)), daemon: true, ...snapshot };
}

const sleepingDir = path.join(os.homedir(), '.local', 'share', 'terminal-workspace', 'sleeping');
const isSleeping = (id) => fs.existsSync(path.join(sleepingDir, `${String(id).replace(/[^A-Za-z0-9._-]/g, '_')}.json`));

/** What "Clean up idle terminals" offers, judged now; `starters` says who started each terminal. */
async function idleCleanupPlan() {
  const { panes: onMap } = await currentPanes();
  const table = processTable();
  const followers = new Map(), helperOf = new Map();
  for (const b of bots.list()) for (const h of b.helpers || []) if (h?.paneId) (h.followed ? followers : helperOf).set(h.paneId, b);
  const workspace = readWorkspace();
  const parents = parentsByPane(workspace);
  // Terminals still running with no card on the map: invisible to Noam, so listed too.
  const owned = new Set();
  for (const tab of workspace?.tabs || []) for (const t of tab.terminals || []) if (t?.id) owned.add(t.id);
  const { byId } = await liveness();
  const cardless = owned.size ? cardlessSessions({ liveById: byId, ownedIds: owned, agents: agentsByPane(), isSleeping,
    lastUsed: (p) => conversationMtime(p), commandOf: (pid) => table.find((x) => x.pid === pid)?.cmd || '' }) : [];
  const panes = [...onMap, ...cardless.map((p) => ({ ...p, startedAt: startedAt(p.pid) || null }))];
  const starters = new Map();
  for (const p of panes) {
    const bot = helperOf.get(p.id);
    if (bot) starters.set(p.id, { name: bot.name, botId: bot.id });
    else if (parents.get(p.id)) starters.set(p.id, { name: 'an agent', paneId: parents.get(p.id) });
    else if (p.startedBy) starters.set(p.id, { name: p.startedBy });
  }
  const plan = cleanupPlan({
    panes, isSleeping,
    startedBy: (p) => starters.get(p.id)?.name || null,
    processes: (p) => descendantsOf(p.pid, table),
    followedByBot: (p) => followers.get(p.id)?.name || null,
    // Only work the terminal itself made: an agent's own record, or for a plain shell the
    // files changed while it was in use. Others' edits in a shared folder never count.
    unsaved: (p) => unsavedWork(p.cwd, Number(p.startedAt) || 0, undefined, filesTheAgentChanged(p), (Number(p.lastActiveAt) || Date.now()) + 60_000),
  });
  return { ...plan, starters };
}

// Noam 2026-10-22 (Q1): terminals an agent or bot started close by themselves once finished and
// safe; (Q3) each close is a quiet line in the starter's activity log, never a notification.
// Only the real service sweeps: test bridges (their own config folder) never close anything.
async function sweepFinishedHelpers() {
  const plan = await idleCleanupPlan();
  return autoCloseFinished({ plan, requestClose, log: (text, item, ok) => {
    if (!ok) return;
    const who = plan.starters.get(item.id) || {};
    const entry = { at: Date.now(), actor: 'termfleet', kind: 'terminal', text, auto: true, paneId: item.id };
    try {
      if (who.botId) appendAction(path.join(bots.folder(who.botId), 'actions.jsonl'), entry);
      else appendAction(paneLogFile(who.paneId || item.id), entry);
    } catch (error) { console.error('[auto-cleanup]', error.message); }
    console.log('[auto-cleanup]', text);
  } });
}
if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_CLEANUP) {
  let sweeping = false;
  setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    sweepFinishedHelpers().catch((error) => console.error('[auto-cleanup]', error.message)).finally(() => { sweeping = false; });
  }, 5 * 60_000).unref();
}

// Sleep for idle agents (Noam 2026-10-22: 'שהם לא יגנבו הרבה זיכרון במצב idle'). Every minute,
// an agent terminal idle past the setting (20 minutes by default) that is not working, not
// waiting for Noam, not in front of him and runs nothing of its own goes to sleep; a quiet line
// in its activity log says so. Test bridges (their own config folder) never sleep anything.
const daemonAsk = (request) => requestDaemon(request, defaultDaemonSocket());
function lastVisitAt(id) {
  try { const all = JSON.parse(fs.readFileSync(visits.file, 'utf8')); return Math.max(0, ...Object.values(all).map((v) => Number(v?.[id]) || 0)); } catch { return 0; }
}
export async function sweepIdleAgents() {
  const { panes, daemon } = await currentPanes();
  if (!daemon) return { slept: [], freedBytes: 0 };
  const table = processTable();
  return sweepSleep({
    panes, visitedAt: lastVisitAt,
    processes: (p) => workProcesses(p.pid, table),
    sleep: (p) => sleepPane(p, { ask: daemonAsk, rssOf: (x) => treeRss(x.pid, table) }),
    log: (pane, r) => {
      const mb = Math.round((r.freedBytes || 0) / 1048576);
      try { appendAction(paneLogFile(pane.id), { at: Date.now(), actor: 'termfleet', kind: 'terminal', text: `Went to sleep while idle; freed about ${mb} MB. It wakes when opened or sent a message.`, auto: true, paneId: pane.id }); } catch { /* the sleep itself succeeded */ }
      console.log('[sleep]', pane.id, `${mb} MB`);
    },
  });
}
if (!process.env.TC_CONFIG_DIR && !process.env.TC_NO_AUTO_SLEEP) {
  let sleeping = false;
  setInterval(() => {
    if (sleeping) return;
    sleeping = true;
    sweepIdleAgents().catch((error) => console.error('[sleep]', error.message)).finally(() => { sleeping = false; });
  }, 60_000).unref();
}

const sendOnce = createSendOnce();

// Bots (TF-096): managers that run outside the terminals and direct terminal agents.
const push = new Push();
const botBrowser = new BotBrowser();
// Codex bots cannot open the browser from inside their safety box; they ask us.
setInterval(() => { botBrowser.serveRequests().catch(() => {}); }, 1000).unref();
// A bot's window closes when its task ends; this catches tasks that ended by a crash.
setInterval(() => { sweepWindows({ port: BROWSER_PORT }).catch(() => {}); }, 15000).unref();
// The daily agent counts are read from big conversation records, so they are updated
// in a separate low-priority process: a few minutes the first time, seconds after.
let healthRun = null;
function refreshAgentHealth() {
  if (healthRun || process.env.TC_NO_AGENT_HEALTH) return;
  healthRun = spawn('nice', ['-n', '15', process.execPath, fileURLToPath(new URL('../../scripts/termfleet-agent-health.mjs', import.meta.url))], { stdio: 'ignore' });
  healthRun.on('exit', () => { healthRun = null; });
  healthRun.on('error', () => { healthRun = null; });
}
setTimeout(refreshAgentHealth, 90_000).unref();
setInterval(refreshAgentHealth, 60 * 60_000).unref();
const bots = new Bots({ notify: (note) => { push.notify(note).catch((error) => console.error('[push]', error.message)); } });

/** Bots join group chats like terminal agents do: as members with a chat to read. */
function botMembers() {
  return bots.list().map((b) => ({ id: `bot:${b.id}`, provider: 'bot', project: b.name, title: b.name, name: b.name, job: b.job, turn: b.state === 'working' ? 'working' : 'idle', producing: false, live: b.state === 'working' ? 'working' : 'quiet' }));
}
async function roomPanes() { return [...(await currentPanes()).panes, ...botMembers()]; }
// A turn cut off by a restart is picked up again.
setTimeout(() => { try { bots.resumeInterrupted(); } catch (error) { console.error('[bots]', error.message); } }, 3000).unref?.();
// TF-096 part 7: events wake bots (helper finished, approval expired, new code).
const helperSeen = new Map();
async function botEvents() {
  if (!bots.list().length) return;
  await checkBotEvents({
    bots, panes: (await currentPanes()).panes, seen: helperSeen,
    readAsk: async (pane) => { const screen = visibleScreenOf(pane.id) ?? await screenOf(pane.id); return pendingAsk(pane, { screen }) || screenPermissionAsk(pane, screen); },
  });
}
setInterval(() => { botEvents().catch((error) => console.error('[bot events]', error.message)); }, 30_000).unref?.();
// A message that waited for a plan to reset is answered once one does.
setInterval(() => { try { bots.retryDue(); } catch (error) { console.error('[bots]', error.message); } }, 60_000).unref?.();

/**
 * TF-096 part 2: the operator's requests in one conversation, in his words, with
 * done / partial / open. Read from the conversation record (the last 8 MB).
 */
function asksForTranscript(file) {
  // Only chat logs (.jsonl). An OpenCode pane's record is OpenCode's whole database
  // (GBs of binary); reading it every 4 s froze the bridge, so the phone app sat on
  // its splash screen (Noam 2026-10-20 "termcontrol לא עולה לי בסלולרי").
  if (!file || !String(file).endsWith('.jsonl')) return null;
  try {
    // Removed by Noam (dismissAsk) and short follow-ups (isRealRequest) are left out; numbers stay.
    const asks = asksForFile(file).filter((a) => isRealRequest(a.text) && !a.dismissed);
    return asks.length ? asks.slice(-30).map((a) => ({ n: a.n, text: a.text.slice(0, 600), title: askTitle(a.text).slice(0, 300), status: a.status, note: String(a.note || '').slice(0, 200) })) : null;
  } catch { return null; }
}

// Shared rooms deliver through the same path as a typed phone message.
const rooms = new Rooms({
  send: (pane, text) => (String(pane.id).startsWith('bot:') ? bots.send(pane.id.slice(4), text) : sendToPane(pane, text)),
  readFeed: (pane) => (String(pane.id).startsWith('bot:')
    ? { events: bots.messages(pane.id.slice(4)).filter((m) => m.role === 'bot' || m.role === 'operator').map((m) => ({ kind: m.role === 'bot' ? 'assistant' : 'user', at: m.at, text: m.text })) }
    : readFeed(pane, { limit: 30 })),
});
let roomPolling = false;
setInterval(async () => {
  if (roomPolling || !rooms.data.rooms.some((room) => room.pending.length)) return;
  roomPolling = true;
  try { await rooms.poll(await roomPanes()); } catch (error) { console.error('[rooms]', error.message); } finally { roomPolling = false; }
}, 3000).unref();

// Scheduled messages go out through the same checked path as a typed one.
const routines = new Routines({ send: (pane, text) => (String(pane.id).startsWith('bot:') ? bots.send(pane.id.slice(4), text) : sendToPane(pane, text)) });
let routineTicking = false;
setInterval(async () => {
  if (routineTicking || !routines.data.routines.some((r) => r.enabled && r.nextRunAt && r.nextRunAt <= Date.now())) return;
  routineTicking = true;
  try { await routines.tick(await roomPanes()); } catch (error) { console.error('[routines]', error.message); } finally { routineTicking = false; }
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
    const agents = [...botMembers().map((b) => ({ id: b.id, label: b.name, project: 'bot', provider: 'bot' })), ...panes.filter((p) => AGENT_PROVIDERS.has(p.provider))
      .map((p) => ({ id: p.id, label: p.title || p.name || p.project, project: p.project, provider: p.provider, color: p.color }))];
    return json(res, 200, { rooms: rooms.list(), agents });
  }
  let body;
  try { body = req.method === 'POST' ? await readJson(req) : {}; } catch (error) { return json(res, error.code || 400, { error: error.message }); }
  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    const panes = await roomPanes();
    const ids = Array.isArray(body.panes) ? body.panes : [];
    const chosen = ids.map((id) => panes.find((p) => p.id === id && (AGENT_PROVIDERS.has(p.provider) || p.provider === 'bot'))).filter(Boolean);
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
    const panes = await roomPanes();
    const result = await rooms.post(body.id, body.text, panes);
    return json(res, result.error ? 400 : 200, result);
  }
  return json(res, 404, { error: 'not found' });
}

const handle = async (req, res) => {
  const url = safeUrl(req);
  if (!url) return json(res, 400, { error: 'Bad request.' });
  if (crossSiteWrite(req)) return json(res, 403, { error: 'Cross-site request refused.' });

  // Share target without an active worker (first use): drop the upload, open the app.
  if (url.pathname === '/share' && req.method === 'POST') {
    req.resume();
    req.on('end', () => { res.writeHead(303, { location: '/?share=0', 'cache-control': 'no-store' }); res.end(); });
    return;
  }
  if (req.method === 'GET' && PUBLIC_APP_FILES.has(url.pathname)) return serveStatic(res, url.pathname.slice(5));
  // The notification worker must load before sign-in checks (it holds no data).
  if (url.pathname === '/sw.js') return serveStatic(res, 'sw.js');
  if (await handleAuthRoutes(req, res, url)) return;
  if (res.writableEnded) return;
  if (!currentUser(req)) {
    if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'unauthorised' });
    return requireAuth(res);
  }

  if(req.method==='GET' && url.pathname==='/api/session-events') {
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
    // retry: tells the browser to come back after 1 s if the stream drops (restart).
    res.write('retry: 1000\ndata: "rescan"\n\n');
    // A phone that vanished without closing leaves a socket nobody reads; drop it
    // instead of queueing events for it forever.
    const unsubscribe=subscribeSessionEventHeads(name=>{if(res.writableLength>1048576){res.destroy();return;}res.write(`data: ${JSON.stringify(name)}\n\n`);});
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
      usage: readUsageLimits(),
      panes,
      groups: byProject(panes, { groupRoots: new Map((readWorkspace()?.groups || []).filter((g) => g?.id && g.projectRoot).map((g) => [g.id, g.projectRoot])) }),
    });
  }

  if (url.pathname === '/api/routines' && req.method === 'GET') {
    return json(res, 200, { routines: routines.forPane(url.searchParams.get('pane')).map((r) => ({ ...r, label: describeDays(r.days) })) });
  }
  if ((url.pathname === '/api/routines' || url.pathname === '/api/routines/delete') && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    if (url.pathname === '/api/routines/delete') { const result = routines.remove(body.id); return json(res, result.error ? 404 : 200, result); }
    const panes = await roomPanes();
    if (!panes.some((p) => p.id === body.pane)) return json(res, 409, { error: 'That agent is no longer running.' });
    const result = routines.create(body);
    return json(res, result.error ? 400 : 200, result);
  }

  // A teammate's profile (TF-096): name, job, standing rules. New rules are
  // told to the agent once, through the same checked send as a typed message.
  if (url.pathname === '/api/profile' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === body.pane);
    if (!pane) return json(res, 409, { error: 'That agent is no longer running.' });
    const saved = profiles.save(pane.id, body);
    if (saved.error) return json(res, 400, saved);
    let told = null;
    if (saved.rulesChanged && saved.profile?.rules && AGENT_PROVIDERS.has(pane.provider)) told = await sendToPane(pane, rulesMessage(saved.profile));
    return json(res, 200, { ok: true, profile: saved.profile, told: told ? Boolean(told.ok) : null, toldError: told?.error || null });
  }

  if (url.pathname === '/api/waiting' && req.method === 'GET') {
    const items = url.searchParams.get('fresh') === '1' || !waitingLooked ? await refreshWaiting() : waitingNow;
    return json(res, 200, { items });
  }
  // Bots (TF-096). Same sign-in gate as every route below it.
  if (url.pathname === '/api/bots' && req.method === 'GET') {
    const livePanes = await currentPanes().then((r) => r.panes || []).catch(() => []);
    return json(res, 200, { bots: bots.list().map((b) => ({ ...b, ...helperState(b, livePanes) })), groups: bots.groups.list(), archived: bots.archived(), providers: BOT_PROVIDERS, models: Object.fromEntries(BOT_PROVIDERS.map((p) => [p, modelChoices(p)])), home: os.homedir(), skillsWaiting: listSkills().filter((k) => k.status === 'suggested').length });
  }
  // Where a bot works (Noam 2026-10-22): folders the fleet knows, browsing, and one empty new folder.
  if (url.pathname === '/api/bot/folders' && req.method === 'GET') {
    const under = url.searchParams.get('under');
    let known = [];
    if (!under) {
      const panes = await currentPanes().then((r) => r.panes || []).catch(() => []);
      known = knownFolders({ projects: projectCatalog(readWorkspace()), panes, bots: bots.list().filter((b) => !b.ownFolder) });
    }
    const view = subfolders(under || startFolder(known));
    if (view.error) return json(res, 400, view);
    return json(res, 200, { known, ...view, home: os.homedir() });
  }
  if (url.pathname === '/api/bot/folder/new' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 8 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const made = makeFolder(body.under, body.name);
    if (made.error) return json(res, 400, made);
    return json(res, 200, { ok: true, ...made, ...subfolders(made.folder) });
  }
  // Phone notifications (TF-096 part 7).
  if (url.pathname === '/api/push/key' && req.method === 'GET') return json(res, 200, { publicKey: push.keys().publicKey });
  if (url.pathname === '/api/push/latest' && req.method === 'GET') return json(res, 200, { note: push.latest() });
  if (url.pathname === '/api/presence' && req.method === 'POST') {
    push.seen();
    let state = {};
    try { state = await readJson(req, 2048); } catch { state = {}; }
    // Which browsers run the current page (no content): explains a phone that never signs up.
    const ua = String(req.headers['user-agent'] || '').replace(/[^\w ./;()-]/g, '').slice(0, 120);
    if (!globalThis.__presenceSeen) globalThis.__presenceSeen = new Map();
    if (Date.now() - (globalThis.__presenceSeen.get(ua) || 0) > 60_000) { globalThis.__presenceSeen.set(ua, Date.now()); console.error(`[push] page open: ${ua} | notifications supported: ${state.push ?? '?'}, permission: ${state.permission ?? '?'}, signed up: ${state.signedUp ?? '?'}, home screen app: ${state.homeScreen ?? '?'}, storage: ${state.storage ?? '?'}, tab: ${state.tab || '?'}, page: ${state.page || '?'}`); }
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/page-error' && req.method === 'POST') {
    // A script error from a page we cannot inspect (the PC app's embedded WebKit). Text only.
    let body = {};
    try { body = await readJson(req, 2048); } catch { body = {}; }
    const ua = String(req.headers['user-agent'] || '').replace(/[^\w ./;()-]/g, '').slice(0, 80);
    console.error(`[page error] ${String(body.message || '?').slice(0, 300)} @ ${String(body.where || '?').slice(0, 200)} | ${ua}`);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/push/report' && req.method === 'POST') {
    let body = {};
    try { body = await readJson(req, 4 * 1024); } catch { /* ignore a bad report */ }
    const step = String(body.step || "?").slice(0, 20);
    const line = `[push] phone ${step.startsWith("attach-") ? `picture ${step.slice(7)}: ${String(body.error || "").slice(0, 200)}` : step.startsWith("paste-") ? `pressed Paste picture: ${step.slice(6)}` : step === "tapped" ? "tapped Turn on notifications" : step === "on" ? "signed up for notifications" : `sign-up failed at "${step}": ${String(body.error || "").slice(0, 200)}`} (home screen app: ${Boolean(body.standalone)}; ${String(body.ua || '').slice(0, 160)})`;
    console.error(line);
    push.noteProblem?.(line);
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/push/subscribe' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 16 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const result = push.subscribe(body.subscription);
    return json(res, result.error ? 400 : 200, result);
  }
  // The shared skill library (TF-096 part 8): bots suggest, the operator approves.
  // The bots' browser (TF-096 part 8): watch from the phone, teach a task at the PC.
  if (url.pathname === '/api/browser' && req.method === 'GET') return json(res, 200, await botBrowser.status());
  if (url.pathname === '/api/browser/start' && req.method === 'POST') { const r = await botBrowser.start(); return json(res, r.error ? 500 : 200, r); }
  // Take over a bot's window, and hand it back with a note the bot continues from.
  if ((url.pathname === '/api/browser/takeover' || url.pathname === '/api/browser/handback') && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 16 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const botId = String(body.bot || '');
    if (!readWindows().some((w) => w.botId === botId)) return json(res, 404, { error: 'That bot has no window open now.' });
    if (url.pathname === '/api/browser/takeover') return json(res, 200, { ok: true, takeover: setTakeover(botId, { by: 'noam' }) });
    clearTakeover(botId);
    const sent = bots.read(botId) ? bots.send(botId, handBackText(body.note)) : { error: 'That bot no longer exists.' };
    return json(res, sent.error ? 400 : 200, sent.error ? sent : { ok: true });
  }
  if (url.pathname === '/api/browser/shot' && req.method === 'GET') {
    try { const shot = await botBrowser.screenshot(url.searchParams.get('page') || null); res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' }); return res.end(shot.image); }
    catch (error) { return json(res, 503, { error: error.message }); }
  }
  if (url.pathname === '/api/browser/teach/start' && req.method === 'POST') {
    try { const r = await botBrowser.teachStart(); return json(res, r.error ? 409 : 200, r); } catch (error) { return json(res, 503, { error: error.message }); }
  }
  if (url.pathname === '/api/browser/teach/stop' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 16 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    if (body.save) {
      // Check the name before stopping so a typo does not throw the recording away.
      const preview = checkSkill(body);
      if (preview.error) return json(res, 400, preview);
    }
    const stopped = botBrowser.teachStop();
    if (stopped.error) return json(res, 409, stopped);
    if (!body.save) return json(res, 200, { ok: true, steps: stopped.steps.length });
    if (stopped.steps.length < 2) return json(res, 400, { error: 'Nothing was recorded. Teach it again and click through the task in the bots\' browser.' });
    const made = suggestSkill({ name: body.name, description: body.description, body: stopped.body, by: 'Noam (taught in the browser)' });
    return json(res, made.error ? 400 : 200, made.error ? { ...made, draft: stopped.body } : { ...made, steps: stopped.steps.length });
  }
  // Which version of the page the bridge serves now; the page reloads itself when it changes.
  if (url.pathname === '/api/app-version' && req.method === 'GET') {
    const stamp = (f) => { try { const st = fs.statSync(path.join(appDir, f)); return `${Math.round(st.mtimeMs)}-${st.size}`; } catch { return '0'; } };
    return json(res, 200, { v: `${stamp('index.html')}.${stamp('sw.js')}` });
  }
  // How the agents are doing, day by day (TF-096 goal item 5).
  if (url.pathname === '/api/agent-health' && req.method === 'GET') return json(res, 200, agentHealthReport());
  if (url.pathname === '/api/skills' && req.method === 'GET') return json(res, 200, { skills: listSkills() });
  if ((url.pathname === '/api/skills/approve' || url.pathname === '/api/skills/reject') && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 8 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const result = url.pathname.endsWith('approve') ? approveSkill(body.name) : rejectSkill(body.name);
    return json(res, result.error ? 400 : 200, result);
  }
  if (url.pathname === '/api/search' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').slice(0, 200);
    return json(res, 200, { hits: q.trim() ? bots.search(q) : [] });
  }
  // Bot groups: a bot answers in a group only when Noam tags it (@name or @all).
  if (url.pathname === '/api/bot-groups' && req.method === 'GET') return json(res, 200, { groups: bots.groups.list() });
  if (url.pathname === '/api/bot-group' && req.method === 'GET') {
    let view = null;
    try { view = bots.groupView(url.searchParams.get('id')); } catch { view = null; }
    return view ? json(res, 200, view) : json(res, 404, { error: 'That group no longer exists.' });
  }
  if (['/api/bot-groups', '/api/bot-group/update', '/api/bot-group/delete', '/api/bot-group/send'].includes(url.pathname) && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    let result;
    try {
      result = url.pathname === '/api/bot-groups' ? bots.groups.create(body)
        : url.pathname === '/api/bot-group/update' ? bots.groups.update(body.id, body)
          : url.pathname === '/api/bot-group/send' ? bots.sendGroup(body.id, body.text)
            : bots.groups.remove(body.id);
    } catch (error) { result = { error: error.message || 'That did not work.' }; }
    return json(res, result.error ? 400 : 200, result);
  }
  if (url.pathname === '/api/bot' && req.method === 'GET') {
    let view = null;
    // read=1: the chat is on screen, so what it shows counts as read (unread badge in the list).
    try { if (url.searchParams.get('read') === '1') bots.markRead(url.searchParams.get('id')); view = bots.view(url.searchParams.get('id')); } catch { view = null; }
    if (view && view.bot.helpers?.length) {
      const { panes } = await currentPanes();
      view.bot.helpers = view.bot.helpers.map((h) => { const p = panes.find((x) => x.id === h.paneId); return { ...h, state: !p ? 'closed' : p.turn === 'waiting' ? 'needs-you' : (p.producing || p.turn === 'working') ? 'working' : 'idle', title: p?.title || p?.project || null, live: (p?.sessionAuthority && p.sessionViewV2?.now && !p.sessionViewV2.now.stale ? String(p.sessionViewV2.now.label || '') : '') || null, task: p?.task || null }; });
    }
    if (view && view.bot.provider !== 'codex') {
      const raw = bots.read(view.bot.id);
      if (raw?.sessions?.claude?.started) view.asks = asksForTranscript(claudeTranscript(raw.cwd, raw.sessions.claude.id));
    }
    return json(res, view ? 200 : 404, view || { error: 'That bot no longer exists.' });
  }
  // A bot's Activity (TF-098): what it and its terminal agents did, who approved it. Record only.
  if (url.pathname === '/api/bot/activity' && req.method === 'GET') {
    let view = null;
    try { view = bots.activity(url.searchParams.get('id'), { only: url.searchParams.get('only') === 'approval' ? 'approval' : null, receipts: (() => { try { return JSON.parse(fs.readFileSync(choiceReceipts.file, 'utf8')) || {}; } catch { return choiceReceipts.records; } })() }); } catch { view = null; }
    return json(res, view ? 200 : 404, view || { error: 'That bot no longer exists.' });
  }
  // A bot's memory card: entries it proposed wait here for the operator.
  if (url.pathname === '/api/bot/memory' && req.method === 'GET') {
    try { return json(res, 200, { entries: bots.memory(url.searchParams.get('id')).entries().filter((e) => e.status !== 'forgotten') }); }
    catch { return json(res, 404, { error: 'That bot no longer exists.' }); }
  }
  if (url.pathname === '/api/bot/memory' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    let result;
    try {
      const memory = bots.memory(body.id);
      result = body.action === 'approve' ? memory.approve(body.entryId, body.text)
        : body.action === 'forget' ? memory.forget(body.entryId)
          : body.action === 'add' ? memory.add({ text: body.text, kind: body.kind })
            : { error: 'Unknown memory action.' };
    } catch (error) { result = { error: error.message || 'That did not work.' }; }
    return json(res, result.error ? 400 : 200, result);
  }
  // Noam removes a request from a bot's or terminal's list himself (2026-10-20). The agent then
  // sees it as dropped; the number stays, so its other marks still land right.
  if (url.pathname === '/api/asks/dismiss' && req.method === 'POST') {
    let body = {};
    try { body = await readJson(req, 1024); } catch { body = {}; }
    const n = Number(body.n);
    if (!Number.isInteger(n) || n < 1) return json(res, 400, { error: 'Which request?' });
    let file = null;
    if (body.bot) { const raw = bots.read(String(body.bot)); file = raw?.sessions?.claude?.started ? claudeTranscript(raw.cwd, raw.sessions.claude.id) : null; }
    else if (body.pane) { const pane = (await currentPanes()).panes.find((p) => p.id === String(body.pane)); file = pane ? adapterFor(pane)?.transcriptPath(pane) : null; }
    if (!file || !String(file).endsWith('.jsonl')) return json(res, 404, { error: 'That conversation has no request list.' });
    dismissAsk(file, n);
    return json(res, 200, { ok: true });
  }
  if (['/api/bots', '/api/bot/send', '/api/bot/update', '/api/bot/delete', '/api/bot/retry', '/api/bot/profile/accept', '/api/bot/profile/dismiss'].includes(url.pathname) && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    let result;
    try {
      result = url.pathname === '/api/bots' ? bots.create(body)
        : url.pathname === '/api/bot/send' ? bots.send(body.id, body.text, { images: body.images, owner: true, answerTo: body.answerTo, replyTo: body.replyTo, listTo: body.listTo, choices: body.choices })
          : url.pathname === '/api/bot/update' ? bots.update(body.id, body)
            : url.pathname === '/api/bot/retry' ? bots.retry(body.id)
              : url.pathname === '/api/bot/profile/accept' ? bots.acceptProfile(body.id, body)
                : url.pathname === '/api/bot/profile/dismiss' ? bots.dismissProfile(body.id)
            : bots.remove(body.id);
    } catch (error) { result = { error: error.message || 'That did not work.' }; }
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

  if (url.pathname.startsWith('/api/sleep')) {
    let body = {};
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return json(res, 413, { error: 'Request too large.' }); }
      try { body = raw ? JSON.parse(raw) : {}; } catch { return json(res, 400, { error: 'Invalid request.' }); }
    }
    if (url.pathname === '/api/sleep' && req.method === 'GET') {
      const { panes } = await currentPanes();
      const table = processTable();
      const why = Object.fromEntries(panes.filter((p) => !p.sleeping).map((p) => [p.id, sleepVerdict(p, { visitedAt: lastVisitAt, processes: (x) => workProcesses(x.pid, table) })]));
      return json(res, 200, { settings: readSettings(), sleeping: listSleeping(), awakeBecause: why });
    }
    if (url.pathname === '/api/sleep/settings' && req.method === 'POST') return json(res, 200, { settings: writeSettings(undefined, body) });
    const id = String(body.pane || '');
    if (!id.startsWith('terminal-')) return json(res, 400, { error: 'That is not a terminal.' });
    if (url.pathname === '/api/sleep/keep-awake' && req.method === 'POST') return json(res, 200, { ok: true, keepAwake: setKeepAwake(id, Boolean(body.on)) });
    if (url.pathname === '/api/sleep/wake' && req.method === 'POST') {
      const r = await wakePane(id, { ask: daemonAsk });
      return json(res, r.ok ? 200 : 502, r.ok ? r : { error: r.error });
    }
    return json(res, 404, { error: 'Not found' });
  }

  if (url.pathname === '/api/visit' && req.method === 'POST') {
    let raw='';for await (const chunk of req){raw+=chunk;if(raw.length>1024)return json(res,413,{error:'Request too large.'});}
    let body;try{body=JSON.parse(raw);}catch{return json(res,400,{error:'Invalid visit.'});}
    // Opening a sleeping terminal on the phone wakes it; its conversation shows meanwhile.
    if (sleepMarked(String(body?.pane || ''))) wakePane(String(body.pane), { ask: daemonAsk }).catch(() => {});
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
      asks: asksForTranscript(adapterFor(pane)?.transcriptPath(pane)),
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

  // Close a terminal card (Noam 2026-10-20), after he confirmed it in the page. The
  // TermFleet app closes it exactly as the card's X does; nothing here kills a process.
  // "Close this bot": what it is running, then close only what Noam ticked.
  if (url.pathname === '/api/bot-close' && (req.method === 'GET' || req.method === 'POST')) {
    const botId = req.method === 'GET' ? url.searchParams.get('bot') : null;
    let body = {};
    if (req.method === 'POST') { try { body = await readJson(req, 16 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); } }
    const id = botId || body.bot;
    const bot = bots.list().find((b) => b.id === id);
    if (!bot) return json(res, 404, { error: 'That bot no longer exists.' });
    const plan = botClosePlan({ bot, panes: (await currentPanes()).panes, routines: routines.forPane(`bot:${bot.id}`), watches: bots.watches(bot.id) });
    if (req.method === 'GET') return json(res, 200, plan);
    const result = await closeBotItems({ botId: bot.id, ids: Array.isArray(body.items) ? body.items.map(String) : [], plan, bots, routines, requestClose });
    return json(res, 200, result);
  }

  if ((url.pathname === '/api/bot-remove' || url.pathname === '/api/bot/restore') && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 4 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    if (url.pathname === '/api/bot/restore') { const r = bots.restore(body.id); return json(res, r.ok ? 200 : 409, r); }
    const bot = bots.list().find((b) => b.id === body.bot);
    if (!bot) return json(res, 404, { error: 'That bot no longer exists.' });
    const plan = botClosePlan({ bot, panes: (await currentPanes()).panes, routines: routines.forPane(`bot:${bot.id}`), watches: bots.watches(bot.id) });
    const result = await removeBot({ bot, plan, bots, routines, requestClose, confirmManager: body.confirmManager === true });
    return json(res, result.ok ? 200 : 409, result);
  }

  // "Clean up idle terminals" (Noam 2026-10-22): GET lists what is safe to close and why the
  // rest stays; POST closes the ticked ones after a fresh look, never one that became unsafe.
  if (url.pathname === '/api/cleanup' && (req.method === 'GET' || req.method === 'POST')) {
    let body = {};
    if (req.method === 'POST') { try { body = await readJson(req, 64 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); } }
    const plan = await idleCleanupPlan();
    if (req.method === 'GET') return json(res, 200, { offer: plan.offer, keep: plan.keep, checkedAt: plan.checkedAt });
    const result = await closeIdleTerminals({ ids: Array.isArray(body.items) ? body.items : [], plan, requestClose, by: `phone:cleanup:${currentUser(req).id}` });
    return json(res, 200, result);
  }

  if (url.pathname === '/api/close' && req.method === 'POST') {
    let body;
    try { body = await readJson(req, 4 * 1024); } catch (error) { return json(res, error.code || 400, { error: error.message }); }
    const { panes } = await currentPanes();
    if (!panes.some((p) => p.id === body.pane)) return json(res, 404, { error: 'That terminal is no longer open.' });
    const result = await requestClose(body.pane, { by: `phone:${currentUser(req).id}` });
    return json(res, result.ok ? 200 : result.uncertain ? 202 : 409, result);
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
        // A typed answer whose question is gone (answered at the PC, or withdrawn) still
        // reaches the agent, as a normal message. If another question is open instead, it
        // is refused and the page keeps the draft.
        if (fresh && !freshAsk && typeof payload.answer === 'string') {
          const result = await sendOnce(`answer-${payload.askId}`, payload.answer, () => sendToPane(fresh, payload.answer));
          return json(res, result.error && !result.busy ? 400 : 200, { ...result, sentAsMessage: true });
        }
        if (fresh && freshAsk && freshAsk.id !== payload.askId && typeof payload.answer === 'string') {
          return json(res, 409, { error: 'A different question is open in that terminal now. Your draft is kept; answer the new question first.', notSent: true });
        }
        if (!fresh || !freshAsk || freshAsk.id !== payload.askId || (payload.choice && payload.choice !== 'submit-multi' && !matchesAsk(freshAsk, payload.askId, payload.choice)) || (typeof payload.answer==='string' && (freshAsk.kind!=='question' || freshAsk.stage==='review'))) {
          return json(res, 409, { error: 'That question or permission request is no longer active. Refresh and check the terminal again.' });
        }
        const adapter = adapterFor(fresh);
        // The screen a typed answer is checked against: the desktop's copy while it shows
        // the question, else the live terminal drawn here (the desktop stops updating cards
        // that are off screen, and sometimes writes no terminal text at all).
        const questionScreenFn = async (options) => {
          const desk = visibleScreenOf(fresh.id, options);
          if (desk && showsQuestion(desk)) return desk;
          return (await liveScreenOf(fresh.id)) ?? desk ?? '';
        };
        // TermFleet stops refreshing the visible text of a terminal scrolled off the
        // desktop map while still stamping it as observed. When that copy lacks the
        // question, accept the daemon's live bottom rows only if they show this exact
        // question inside an open selection menu.
        const squash = (text) => String(text || '').replace(/[\u2500-\u257f\s]+/g,'');
        const showsQuestion = (text) => squash(text).includes(squash(freshAsk.title));
        let questionScreen = visible;
        if (freshAsk.kind === 'question' && !showsQuestion(visible)) {
          const live = await liveScreenOf(fresh.id) ?? await screenOf(fresh.id);
          if (showsQuestion(live) && /❯\s*1\.|Enter to select|Esc to cancel/.test(live)) questionScreen = live;
        }
        if (freshAsk.kind === 'question' && freshAsk.multiSelect && freshAsk.stage !== 'review' && fresh.provider === 'claude') {
          // Pick-several: ticks and typed text change the open form without answering it,
          // so they skip the one-answer receipt; only Submit is recorded as the answer.
          if (questionScreen===null || !showsQuestion(questionScreen)) return json(res,409,{error:'This question is not visible in TermFleet right now. Check the terminal before answering.',notSent:true});
          const screenFn = questionScreenFn;
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
          ? sendCustomAnswer(fresh, freshAsk, payload.answer, {screen:questionScreenFn})
          : freshAsk.screenChoice ? answerScreenChoice(fresh, freshAsk, payload.choice)
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

  // The owner's own "heard -> correct" list for dictation, shared by PC and phone.
  if (url.pathname === '/api/word-fixes') {
    if (req.method === 'GET') return json(res, 200, { fixes: readWordFixes() });
    if (req.method === 'POST' || req.method === 'DELETE') {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 4096) return json(res, 413, { error: 'Request too large.' }); }
      let body; try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad request' }); }
      try {
        const result = req.method === 'POST' ? addWordFix(body.heard, body.correct) : removeWordFix(body.heard);
        return json(res, result.error ? 400 : 200, result);
      } catch { return json(res, 503, { error: 'The word list could not be saved.' }); }
    }
    return json(res, 405, { error: 'Method not allowed.' });
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
      const fixes = readWordFixes();
      const { text: heard, language, seconds, timings: stages } = await transcribe(audio, { language: lang, uploadMs, hint: wordFixHint(fixes) });
      const own = applyWordFixes(heard, fixes);   // his own list first: it wins, and "fixed" counts it
      const { text } = applyEnglishTerms(own.text);   // Hebrew dictation keeps English words in English
      const { changed } = own;
      const timings = { ...stages, uploadMs, requestMs: Math.round((performance.now() - received) * 10) / 10 };
      speechTimingHeader(res, timings);
      return json(res, 200, { text, language, seconds, fixed: changed, timings });
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

  // The PC app shows this page inside a frame that drops "open in a new tab", so a link
  // clicked there opens in the PC's own browser (Noam: "ללחוץ על זה לא פותח את הלינקים").
  // Only from this machine itself, and only a web address or a picture this page may show.
  if (url.pathname === '/api/open-link' && req.method === 'POST') {
    if (!isLocalRecoveryRequest(req, url)) return json(res, 403, { error: 'Links open on the PC only from the PC app.' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 8192) return json(res, 413, { error: 'too long' }); }
    let target = '';
    try { target = String(JSON.parse(body).url || ''); } catch {}
    const picture = target.startsWith('/api/local-image?') ? resolveLocalImage(new URL(target, 'http://x').searchParams.get('path')) : null;
    let open = picture?.file || '';
    if (!open) { try { const u = new URL(target); if (u.protocol === 'http:' || u.protocol === 'https:') open = u.href; } catch {} }
    if (!open) return json(res, 400, { error: 'That is not a link that can be opened.' });
    const child = spawn('xdg-open', [open], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return json(res, 200, { ok: true });
  }

  // A screenshot path in an agent's message opens as the picture (signed-in only).
  if (url.pathname === '/api/local-image' && req.method === 'GET') {
    const image = resolveLocalImage(url.searchParams.get('path'));
    if (!image) return json(res, 404, { error: 'That picture is not available.' });
    res.writeHead(200, { 'content-type': image.type, 'content-length': image.size, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
    return fs.createReadStream(image.file).pipe(res);
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

// Requests still being answered. A restart waits for these (event streams are
// long-lived and are told to reconnect instead), so a deploy never cuts a reply.
let inFlight = 0;
const streams = new Set();
let stopping = false;

// One bad request must never take the bridge down for everyone.
const server = http.createServer((req, res) => {
  const stream = req.url?.startsWith('/api/session-events');
  if (stream) { streams.add(res); res.on('close', () => streams.delete(res)); }
  else { inFlight++; res.on('close', () => { inFlight--; }); }
  if (stopping) res.setHeader('connection', 'close');
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
// Requests per terminal for the desktop app's side panel (see asks-sidecar.mjs).
const writeAsksSidecars = createAsksSidecarWriter({ asksOf: (pane) => asksForTranscript(adapterFor(pane)?.transcriptPath(pane)) });
setInterval(async () => {
  try { writeAsksSidecars((await currentPanes()).panes); } catch (error) { console.error('[asks sidecar]', error.message); }
}, 4000).unref?.();
liveness().catch(() => {});

/**
 * A restart (deploy, or the memory guard below) is invisible to the phone: stop
 * taking new connections, tell open event streams to reconnect in a second, let
 * every in-flight reply finish (up to 10 s), then exit. systemd starts the new
 * bridge and the phone reconnects on its own.
 */
async function shutdownGracefully(reason, { exitCode = 0, graceMs = 10000 } = {}) {
  if (stopping) return;
  stopping = true;
  console.log(`[bridge] stopping (${reason}); ${inFlight} request(s) in flight, ${streams.size} stream(s) open`);
  // Bot replies finish first (the phone keeps working meanwhile); new ones wait for the new bridge.
  if (bots.running.size) console.log(`[bridge] waiting for ${bots.running.size} bot repl${bots.running.size === 1 ? 'y' : 'ies'} to finish`);
  const { unfinished } = await bots.closeDown({ maxMs: Number(process.env.TC_RESTART_WAIT_MS) || 5 * 60 * 1000 });
  if (unfinished.length) console.log(`[bridge] ${unfinished.length} bot reply still running; it is re-run after the restart`);
  server.close();
  for (const res of streams) { try { res.write('retry: 1000\n\n'); res.end(); } catch { /* already gone */ } }
  const deadline = Date.now() + graceMs;
  while (inFlight > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  server.closeIdleConnections?.();
  process.exit(exitCode);
}
process.on('SIGTERM', () => { shutdownGracefully('SIGTERM'); });
process.on('SIGINT', () => { shutdownGracefully('SIGINT'); });

// Memory guard: a bridge past the limit twice in a row restarts itself through the
// same gentle path (systemd brings it straight back). Default 1.5 GB.
const MEMORY_LIMIT_MB = Number(process.env.TC_MEMORY_LIMIT_MB) || 1536;
let overLimit = 0;
setInterval(() => {
  const mb = process.memoryUsage().rss / 1048576;
  overLimit = mb > MEMORY_LIMIT_MB ? overLimit + 1 : 0;
  if (overLimit >= 2) shutdownGracefully(`memory ${Math.round(mb)} MB over ${MEMORY_LIMIT_MB} MB`, { exitCode: 75 });
}, 30000).unref?.();

// "Waiting for you" (Noam 2026-10-20): everything waiting on him from every bot and terminal,
// kept fresh here; the page reads /api/waiting. Notifications (phone + desktop) only from the
// live service: tests and copies set TC_CONFIG_DIR.
let waitingNow = [];
const notifyWaiting = !process.env.TC_CONFIG_DIR && process.env.TC_NO_WAITING_NOTIFY !== '1'
  ? createWaitingNotifier({ file: path.join(os.homedir(), '.config', 'termcontrol', 'waiting-seen.json'), push: (note) => push.notify(note) })
  : null;
let waitingBusy = false;
// Until the first look a fresh bridge knows nothing; it must not answer "nothing waits" (TF-099).
let waitingLooked = false;
// The desktop app's side list reads the same list from its status folder (Noam: "this must be
// reachable on the computer too"), written only when it changes.
let waitingWritten = '';
function writeWaitingSidecar(items) {
  const body = JSON.stringify({ items: items.map(({ key, kind, source, who, what, todo, go }) => ({ key, kind, source, who, what, todo, go })) });
  if (body === waitingWritten) return;
  try {
    const file = path.join(defaultAsksDir(), 'waiting-for-you.json'), tmp = `${file}.${process.pid}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, body, { mode: 0o600 }); fs.renameSync(tmp, file);
    waitingWritten = body;
  } catch (error) { console.error('[waiting sidecar]', error.message); }
}
async function refreshWaiting() {
  if (waitingBusy) return waitingNow;
  waitingBusy = true;
  try {
    const { panes, daemon } = await currentPanes();
    const byId = new Map(panes.map((p) => [p.id, p]));
    const asksOf = ({ kind, id }) => {
      if (kind === 'terminal') return asksForTranscript(adapterFor(byId.get(id))?.transcriptPath(byId.get(id)));
      const raw = bots.read(id);
      return raw?.sessions?.claude?.started ? asksForTranscript(claudeTranscript(raw.cwd, raw.sessions.claude.id)) : null;
    };
    waitingNow = collectWaiting({ panes, bots: bots.list(), asksOf, daemon, previous: waitingNow });
    if (daemon !== false) waitingLooked = true;
    if (notifyWaiting) { await notifyWaiting(waitingNow); writeWaitingSidecar(waitingNow); }
  } catch (error) { console.error('[waiting]', error.message); } finally { waitingBusy = false; }
  return waitingNow;
}
setInterval(refreshWaiting, 5000).unref?.();
setTimeout(refreshWaiting, 1500).unref?.();

// Dock icon counts (Noam 2026-10-20): bots unread in orange, terminals waiting for him in
// blue, as two small dots (Noam's pick). TC_NO_DOCK_ICON=1 turns it off. Live service only:
// tests and copies set TC_CONFIG_DIR and never touch the launcher.
if (!process.env.TC_CONFIG_DIR && process.env.TC_NO_DOCK_ICON !== '1') {
  const updateDock = createDockIcon();
  let dockBusy = false;
  const dockTick = async () => {
    if (dockBusy) return;
    dockBusy = true;
    try {
      const unread = bots.list().filter((b) => !b.hidden).reduce((n, b) => n + (Number(b.unread) || 0), 0);   // ready-to-try items wait quietly in the list, no dot (Noam 2026-10-20)
      const { panes } = await currentPanes();
      await updateDock(unread, panes.filter((p) => p.attention).length);   // a real question or approval, not a finished turn
    } catch (error) { console.error('[dock]', error.message); } finally { dockBusy = false; }
  };
  setInterval(dockTick, 5000).unref?.();
  setTimeout(dockTick, 2000).unref?.();
}

// The phone reaches us through a tunnel that keeps idle connections for about 90 s. Node
// closes them after 5 s, so a request sent after a slow photo upload went down a closed
// connection and was reset ("I can't send the message", Noam 2026-10-20). Outlast the tunnel.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;

server.listen(PORT, HOST, () => {
  console.log(`TermControl bridge on http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') console.log('(set TC_HOST=0.0.0.0 to open it from your phone on the same network)');
});
