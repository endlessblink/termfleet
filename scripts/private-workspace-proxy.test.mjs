import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPrivateProxy, studioPort } from './private-workspace-proxy.mjs';

function fetch(url, { headers, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { headers, method }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        resolve({ status: res.statusCode, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('studio discovery only selects a linked Blender port, never an arbitrary service', () => {
  assert.equal(studioPort('http://127.0.0.1:8766/shot'), 8766);
  for (const url of ['http://127.0.0.1:7810/shot', 'https://127.0.0.1:8766/shot',
    'http://example.com:8766/shot', 'http://127.0.0.1:8766/api/state', undefined]) {
    assert.throws(() => studioPort(url));
  }
});

test('private proxy preserves local protection, streaming and external studio links', async (t) => {
  const origin = 'https://workspace.example.ts.net:8810';
  const studioOrigin = 'https://workspace.example.ts.net:8812';
  const upstream = http.createServer((req, res) => {
    if (req.headers.host !== `127.0.0.1:${upstream.address().port}`) {
      res.writeHead(403).end(); return;
    }
    if (req.url === '/api/film') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ studio_url: 'http://127.0.0.1:8766/shot', value: 'kept' }));
      return;
    }
    if (req.method === 'POST' && req.headers['x-board-token'] !== 'fixture') {
      res.writeHead(403).end(); return;
    }
    res.setHeader('Content-Type', 'text/plain');
    req.pipe(res);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const proxy = createPrivateProxy({ upstreamPort: upstream.address().port, publicOrigin: origin, studioOrigin });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  const url = `http://127.0.0.1:${proxy.address().port}`;
  const headers = { Host: new URL(origin).host, 'Tailscale-User-Login': 'fixture@example.com' };
  assert.equal((await fetch(url)).status, 403, 'untrusted local requests are denied');
  assert.equal((await fetch(url, { headers: { ...headers, Host: 'wrong.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { Host: headers.Host } })).status, 403, 'tailnet identity required');
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: 'x' })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, Origin: origin }, body: 'x' })).status, 403, 'app token remains required');
  const response = await fetch(url, { method: 'POST', headers: { ...headers, Origin: origin, 'X-Board-Token': 'fixture' }, body: 'streamed' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'streamed');
  assert.deepEqual(await (await fetch(`${url}/api/film`, { headers })).json(), { studio_url: `${studioOrigin}/shot`, value: 'kept' });
});
