import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Each bot gets its own window in the shared bots' browser (TF-096, ideas from Xiryn
 * without its per-agent desktops). The browser and its sign-ins stay shared; what a bot
 * can see and touch is limited to the windows it opened itself.
 *
 * A bot's browser tools connect here instead of to Chrome. This small go-between passes
 * the browser's control messages through, but hides every page that is not this bot's,
 * opens the bot's first page in a window of its own, and closes the bot's windows when
 * its task ends. While Noam has taken a bot's window over, the bot cannot click, type or
 * navigate there; when he hands it back, his note goes to the bot as a message.
 */
export const stateDir = () => process.env.TC_BOT_WINDOWS_DIR || path.join(process.env.HOME || '', '.local', 'share', 'terminal-workspace', 'bot-browser');
export const safeId = (id) => String(id || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'unknown';
const windowsFile = (botId, dir = stateDir()) => path.join(dir, 'windows', `${safeId(botId)}.json`);
const takeoverFile = (botId, dir = stateDir()) => path.join(dir, 'takeover', `${safeId(botId)}.json`);

const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
const writeJson = (file, data) => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(data)); fs.renameSync(tmp, file); } catch { /* the windows still work; only the list is stale */ } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** Which bot windows exist, and who has them now. */
export function readWindows(dir = stateDir()) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, 'windows')).filter((n) => n.endsWith('.json')); } catch { /* none yet */ }
  return names.map((n) => readJson(path.join(dir, 'windows', n))).filter((w) => w?.botId)
    .map((w) => ({ ...w, live: alive(w.pid), takeover: readTakeover(w.botId, dir) }));
}
export const readTakeover = (botId, dir = stateDir()) => readJson(takeoverFile(botId, dir));
/** A bot asks Noam to do a step (by: 'bot'), or Noam takes the window (by: 'noam'). */
export function setTakeover(botId, { ask = '', by = 'noam', now = Date.now() } = {}, dir = stateDir()) {
  const current = readTakeover(botId, dir);
  const record = { botId, ask: String(ask || current?.ask || '').slice(0, 500), by: current?.by === 'noam' ? 'noam' : by, at: current?.at || now };
  writeJson(takeoverFile(botId, dir), record);
  return record;
}
export function clearTakeover(botId, dir = stateDir()) {
  const was = readTakeover(botId, dir);
  try { fs.unlinkSync(takeoverFile(botId, dir)); } catch { /* already handed back */ }
  return was;
}

/** The message a bot receives when Noam hands its window back. */
export function handBackText(note) {
  const said = String(note || '').trim().slice(0, 2000);
  return said
    ? `[Noam took over your window in the bots' browser and has handed it back. His note: "${said}"]\nContinue from where that window is now: look at the page first (take a snapshot), then carry on with your task.`
    : '[Noam took over your window in the bots\' browser and has handed it back, without a note.]\nLook at the page first (take a snapshot) to see what he did, then carry on with your task.';
}

/**
 * Close the windows of bots whose task ended without cleaning up (a crash or a hard
 * stop). A window Noam has, or that a bot asked him to use, stays open until handed back.
 */
export async function sweepWindows({ port, dir = stateDir(), fetchImpl = fetch } = {}) {
  const closed = [];
  for (const w of readWindows(dir)) {
    if (w.live || w.takeover) continue;
    for (const id of w.targets || []) {
      try { await fetchImpl(`http://127.0.0.1:${port}/json/close/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(2000) }); closed.push(id); } catch { /* already gone */ }
    }
    try { fs.unlinkSync(windowsFile(w.botId, dir)); } catch { /* another sweep took it */ }
  }
  return closed;
}

// ---- A minimal WebSocket server side (the client side is Node's own WebSocket). ----
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  socket.setNoDelay(true);
  const handlers = { message: () => {}, close: () => {} };
  let buf = Buffer.alloc(0), parts = [], closed = false;
  const frame = (op, payload) => {
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) head = Buffer.from([0x80 | op, 126, len >> 8, len & 255]);
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([head, payload]);
  };
  const finish = () => { if (closed) return; closed = true; handlers.close(); };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, at = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); at = 10; }
      const need = at + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(at + (masked ? 4 : 0), need);
      if (masked) { const mask = buf.subarray(at, at + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]; }
      buf = buf.subarray(need);
      if (op === 0x8) { try { socket.end(frame(0x8, Buffer.alloc(0))); } catch { /* gone */ } finish(); return; }
      if (op === 0x9) { socket.write(frame(0xA, payload)); continue; }
      if (op === 0xA) continue;
      parts.push(payload);
      if (fin) { const text = Buffer.concat(parts).toString('utf8'); parts = []; handlers.message(text); }
    }
  });
  socket.on('close', finish);
  socket.on('error', finish);
  return {
    send: (text) => { if (!closed) socket.write(frame(0x1, Buffer.from(text, 'utf8'))); },
    close: () => { if (!closed) { try { socket.end(frame(0x8, Buffer.alloc(0))); } catch { /* gone */ } } finish(); },
    on: (name, fn) => { handlers[name] = fn; },
  };
}

const PAGE_TYPES = new Set(['page', 'tab', 'iframe', 'webview', 'background_page', 'other']);
// What a bot may not do in a window Noam has taken over.
const ACTING = /^(Input\.|Page\.(navigate|reload|navigateToHistoryEntry)$|Target\.(createTarget|closeTarget)$)/;
const TAKEN = 'Noam has taken over your window in the bots\' browser. Stop using the browser now and wait: he will hand it back with a note.';

/**
 * One bot's view of the browser. `upstreamPort` is Chrome's own debugging port.
 * Resolves to { port, owned, close } once it listens.
 */
export function startWindowProxy({ botId, botName = '', upstreamPort, dir = stateDir(), host = '127.0.0.1', holdMs = 5000 } = {}) {
  const upstreamHttp = `http://127.0.0.1:${upstreamPort}`;
  const owned = new Set();
  // Windows it left open in an earlier task (Noam was using them) are its own again.
  const before = readJson(windowsFile(botId, dir));
  if (before && (!alive(before.pid) || before.pid === process.pid)) for (const id of before.targets || []) owned.add(id);
  const save = () => writeJson(windowsFile(botId, dir), { botId, botName, pid: process.pid, targets: [...owned], at: Date.now() });
  const taken = () => readTakeover(botId, dir)?.by === 'noam';
  const connections = new Set();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (/^\/json\/version\/?$/.test(url.pathname)) {
        const info = await (await fetch(`${upstreamHttp}/json/version`, { signal: AbortSignal.timeout(3000) })).json();
        info.webSocketDebuggerUrl = `ws://${host}:${server.address().port}/devtools/browser/${safeId(botId)}`;
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(info));
      }
      if (/^\/json(\/list)?\/?$/.test(url.pathname)) {
        const list = await (await fetch(`${upstreamHttp}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(list.filter((t) => owned.has(t.id))));
      }
      res.writeHead(404); res.end();
    } catch { res.writeHead(502); res.end(); }
  });

  server.on('upgrade', async (req, socket) => {
    let browserWs;
    try { browserWs = (await (await fetch(`${upstreamHttp}/json/version`, { signal: AbortSignal.timeout(3000) })).json()).webSocketDebuggerUrl; } catch { socket.destroy(); return; }
    const client = wsAccept(req, socket);
    if (!client) return;
    const up = new WebSocket(browserWs);
    const queued = [];
    const toUp = (m) => { const text = JSON.stringify(m); if (up.readyState === 1) up.send(text); else queued.push(text); };
    up.onopen = () => { for (const t of queued.splice(0)) up.send(t); };
    let nextInternal = 1e9;
    const internal = new Map();   // our own requests: id -> callback
    const ask = (method, params = {}, sessionId) => new Promise((resolve) => { const id = nextInternal++; internal.set(id, resolve); toUp({ id, method, params, ...(sessionId ? { sessionId } : {}) }); });
    const sessions = new Set();
    const pendingCreate = new Set(), pendingTargets = new Set();
    let holding = false, held = [], holdTimer = null;
    const conn = { cleanup: null, done: false };
    connections.add(conn);

    const own = (id) => { if (id && !owned.has(id)) { owned.add(id); save(); } };
    const disown = (id) => { if (owned.delete(id)) save(); };
    const allowedInfo = (info) => {
      if (!info) return true;
      if (owned.has(info.targetId)) return true;
      if (info.openerId && owned.has(info.openerId) && PAGE_TYPES.has(info.type)) { own(info.targetId); return true; }   // a popup it opened
      return !PAGE_TYPES.has(info.type);
    };
    // Another bot's page got attached to this connection: let it run and let go of it.
    const release = (sessionId, waiting) => {
      if (waiting) ask('Runtime.runIfWaitingForDebugger', {}, sessionId);
      ask('Target.detachFromTarget', { sessionId });
    };
    const send = (m) => client.send(JSON.stringify(m));
    const flush = () => {
      holding = false; clearTimeout(holdTimer);
      const list = held; held = [];
      for (const m of list) decide(m, true);
    };
    const hold = (m) => {
      held.push(m);
      if (!holding) { holding = true; holdTimer = setTimeout(flush, holdMs); }
    };
    // Browser -> bot: forward, hold (its new page may be announced before we know it is its own), or drop.
    const decide = (m, flushing = false) => {
      if (m.id !== undefined) {
        if (pendingTargets.delete(m.id) && m.result?.targetInfos) m.result.targetInfos = m.result.targetInfos.filter(allowedInfo);
        return send(m);
      }
      if (m.sessionId && !sessions.has(m.sessionId)) return undefined;
      const p = m.params || {};
      if (m.method === 'Target.attachedToTarget') {
        if (allowedInfo(p.targetInfo)) { sessions.add(p.sessionId); return send(m); }
        if (!flushing && pendingCreate.size) return hold(m);
        return release(p.sessionId, p.waitingForDebugger);
      }
      if (m.method === 'Target.detachedFromTarget') return sessions.delete(p.sessionId) ? send(m) : undefined;
      if (m.method === 'Target.targetDestroyed') {
        if (!owned.has(p.targetId)) return undefined;
        disown(p.targetId);
        return send(m);
      }
      if (m.method === 'Target.targetCrashed') return owned.has(p.targetId) ? send(m) : undefined;
      if (/^Target\.target(Created|InfoChanged)$/.test(m.method)) {
        if (allowedInfo(p.targetInfo)) return send(m);
        return !flushing && pendingCreate.size ? hold(m) : undefined;
      }
      return send(m);
    };
    up.onmessage = (event) => {
      let m; try { m = JSON.parse(event.data); } catch { return; }
      if (m.id !== undefined && internal.has(m.id)) { const cb = internal.get(m.id); internal.delete(m.id); cb(m); return; }
      if (m.id !== undefined && pendingCreate.has(m.id)) { pendingCreate.delete(m.id); own(m.result?.targetId); }
      if (holding) { held.push(m); if (!pendingCreate.size) flush(); return; }
      decide(m);
    };

    const refuse = (m, message) => send({ id: m.id, ...(m.sessionId ? { sessionId: m.sessionId } : {}), error: { code: -32000, message } });
    const openOwnedPage = async () => {
      if (!owned.size) return null;
      const infos = (await ask('Target.getTargets')).result?.targetInfos || [];
      for (const id of [...owned]) if (!infos.some((t) => t.targetId === id)) disown(id);
      return infos.find((t) => owned.has(t.targetId) && t.type === 'page')?.targetId || null;
    };
    // Bot -> browser.
    let order = Promise.resolve();
    client.on('message', (text) => { order = order.then(async () => {
      let m; try { m = JSON.parse(text); } catch { return; }
      const p = m.params || {};
      if (m.sessionId && !sessions.has(m.sessionId)) return refuse(m, 'That page belongs to another bot.');
      if (ACTING.test(m.method || '') && taken()) return refuse(m, TAKEN);
      if (m.method === 'Browser.close' || /^Browser\.crash/.test(m.method || '')) return send({ id: m.id, result: {} });
      if (/^Target\.(closeTarget|activateTarget|attachToTarget)$/.test(m.method) && !owned.has(p.targetId)) return refuse(m, 'That page belongs to another bot.');
      if (m.method === 'Target.getTargets') pendingTargets.add(m.id);
      if (m.method === 'Target.createTarget') {
        // Its first page opens in a window of its own; later ones join that window.
        const mine = await openOwnedPage();
        if (mine) await ask('Target.activateTarget', { targetId: mine });
        else m.params = { ...p, newWindow: true };
        pendingCreate.add(m.id);
      }
      return toUp(m);
    }).catch(() => {}); });

    // The task ended (its browser tools closed): close its windows, unless Noam has one.
    conn.cleanup = async () => {
      if (conn.done) return; conn.done = true;
      connections.delete(conn);
      try {
        if (up.readyState === 1 && !readTakeover(botId, dir)) {
          for (const id of [...owned]) { await Promise.race([ask('Target.closeTarget', { targetId: id }), new Promise((r) => setTimeout(r, 1500))]); owned.delete(id); }
          try { fs.unlinkSync(windowsFile(botId, dir)); } catch { /* nothing saved */ }
        } else if (owned.size) writeJson(windowsFile(botId, dir), { botId, botName, pid: 0, targets: [...owned], at: Date.now() });
      } finally { try { up.close(); } catch { /* closed */ } client.close(); }
    };
    client.on('close', () => { conn.cleanup(); });
    up.onclose = () => { conn.cleanup(); };
    up.onerror = () => { conn.cleanup(); };
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve({
      port: server.address().port,
      owned,
      close: async () => { for (const c of [...connections]) await c.cleanup?.(); server.close(); },
    }));
  });
}
