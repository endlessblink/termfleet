// Loopback adapter behind Tailscale Serve ONLY; never use with Funnel or a public proxy.
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade']);
function forwardedHeaders(headers) {
  const excluded = new Set([...hopHeaders, ...String(headers.connection || '').toLowerCase().split(',').map(s => s.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !excluded.has(name)));
}

export function studioPort(studioUrl) {
  const url = new URL(studioUrl);
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !Number.isInteger(port)
      || port < 8765 || port > 8784 || url.pathname !== '/shot') throw new Error('No linked local Blender studio');
  return port;
}

export function createPrivateProxy({ upstreamPort, publicOrigin, studioOrigin, discoverStudio = false }) {
  const publicUrl = new URL(publicOrigin);
  if (publicUrl.protocol !== 'https:' || !publicUrl.hostname.endsWith('.ts.net') || publicUrl.origin !== publicOrigin
      || !Number.isInteger(upstreamPort) || upstreamPort < 1 || upstreamPort > 65535) throw new Error('Invalid private proxy configuration');
  if (studioOrigin && (new URL(studioOrigin).hostname !== publicUrl.hostname || new URL(studioOrigin).protocol !== 'https:')) {
    throw new Error('Studio must use the same private host');
  }
  return http.createServer(async (req, res) => {
    // Serve overwrites these identity headers after tailnet authentication. A missing
    // identity also fails closed if someone accidentally enables anonymous Funnel.
    if (req.headers.host !== publicUrl.host || !req.headers['tailscale-user-login']
        || !req.url.startsWith('/') || req.url.startsWith('//')
        || (!['GET', 'HEAD'].includes(req.method) && req.headers.origin !== publicOrigin)) {
      req.resume(); res.writeHead(403).end('Forbidden'); return;
    }
    let targetPort = upstreamPort;
    if (discoverStudio) {
      try {
        const info = await fetch(`http://127.0.0.1:${upstreamPort}/api/film`, { signal: AbortSignal.timeout(5000) });
        if (!info.ok) throw new Error('Workspace unavailable');
        targetPort = studioPort((await info.json()).studio_url);
      } catch { req.resume(); res.writeHead(502).end('Linked Blender studio unavailable'); return; }
    }
    const headers = forwardedHeaders(req.headers);
    headers.host = `127.0.0.1:${targetPort}`;
    headers['accept-encoding'] = 'identity';
    const request = http.request({ hostname: '127.0.0.1', port: targetPort, path: req.url, method: req.method, headers }, answer => {
      const responseHeaders = forwardedHeaders(answer.headers);
      if (studioOrigin && req.method === 'GET' && req.url.split('?')[0] === '/api/film'
          && answer.statusCode === 200 && String(answer.headers['content-type']).startsWith('application/json')) {
        const chunks = []; let size = 0;
        answer.on('data', chunk => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) { answer.destroy(); res.writeHead(502).end('Response too large'); }
          else chunks.push(chunk);
        });
        answer.on('end', () => {
          if (res.writableEnded) return;
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString());
            if (body.studio_url) {
              const local = new URL(body.studio_url);
              if (local.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(local.hostname)) {
                body.studio_url = `${studioOrigin}${local.pathname}${local.search}`;
              }
            }
            const data = Buffer.from(JSON.stringify(body));
            responseHeaders['content-length'] = data.length;
            res.writeHead(answer.statusCode, responseHeaders).end(data);
          } catch { res.writeHead(502).end('Invalid upstream response'); }
        });
      } else {
        res.writeHead(answer.statusCode, responseHeaders);
        answer.pipe(res);
      }
      answer.on('error', () => res.destroy());
    });
    request.setTimeout(600_000, () => request.destroy(new Error('Upstream timeout')));
    request.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Workspace unavailable');
      else res.destroy();
    });
    req.on('aborted', () => request.destroy());
    req.pipe(request);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [port, upstreamPort, publicOrigin, studioOrigin] = process.argv.slice(2);
  createPrivateProxy({ upstreamPort: Number(upstreamPort), publicOrigin,
    studioOrigin: studioOrigin === '--studio' ? undefined : studioOrigin, discoverStudio: studioOrigin === '--studio' })
    .listen(Number(port), '127.0.0.1', () => console.log(`Private workspace adapter on loopback port ${port}`));
}
