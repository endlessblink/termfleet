#!/usr/bin/env node
// TermControl bridge — read-only phase. Serves the fleet list, per-pane chat,
// and the phone app itself. Binds to localhost by default; TC_HOST=0.0.0.0 to
// reach it from a phone on the same network.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPanes } from './inventory.mjs';
import { readFeed } from './feed.mjs';
import { handleAuthRoutes, currentUser, requireAuth } from './auth.mjs';
import { sendToPane, answerPrompt, liveSessionIds } from './send.mjs';
import { adapterFor } from './feed.mjs';
import { readPrefs, writePrefs, byProject, inManualOrder } from './prefs.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.join(here, '..', 'app');

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
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
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
async function currentPanes() {
  const panes = listPanes({ maxAgeMs: MAX_AGE });
  try {
    const live = await liveSessionIds();
    return { panes: panes.filter((p) => live.has(p.id)), daemon: true };
  } catch {
    return { panes, daemon: false };
  }
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
    const { panes, daemon } = await currentPanes();
    const prefs = readPrefs();
    return json(res, 200, {
      generatedAt: new Date().toISOString(),
      daemon,
      view: prefs.view,
      panes: prefs.view === 'manual' ? inManualOrder(panes, prefs.order) : panes,
      groups: byProject(panes),
    });
  }

  if (url.pathname === '/api/prefs') {
    if (req.method === 'PUT' || req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 32768) req.destroy(); });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { return json(res, 400, { error: 'bad request' }); }
        return json(res, 200, writePrefs(body));
      });
      return;
    }
    return json(res, 200, readPrefs());
  }

  if (url.pathname === '/api/feed') {
    const id = url.searchParams.get('pane');
    const limit = Math.min(Number(url.searchParams.get('limit') || 60), 200);
    const { panes } = await currentPanes();
    const pane = panes.find((p) => p.id === id);
    if (!pane) return json(res, 404, { error: 'That terminal has been closed.' });
    return json(res, 200, { pane, ...readFeed(pane, { limit }) });
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

      if (payload.choice) {
        const adapter = adapterFor(pane);
        const result = await answerPrompt(pane, payload.choice, adapter?.approval);
        return json(res, result.error ? 400 : 200, result);
      }

      const result = await sendToPane(pane, payload.text, { force: Boolean(payload.force) });
      return json(res, result.error && !result.busy ? 400 : 200, result);
    });
    return;
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

server.listen(PORT, HOST, () => {
  console.log(`TermControl bridge on http://${HOST}:${PORT}`);
  if (HOST === '127.0.0.1') console.log('(set TC_HOST=0.0.0.0 to open it from your phone on the same network)');
});
