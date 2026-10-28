// A tiny page server in its OWN process: the evidence link check opens links synchronously,
// which blocks the test process, so a server inside it could never answer.
import { spawn } from 'node:child_process';
import net from 'node:net';

const SERVER = `
const http = require('node:http');
const s = http.createServer((req, res) => {
  if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><title>Board</title><body>It works</body></html>'); }
  if (req.url === '/go') { res.writeHead(302, { location: '/ok' }); return res.end(); }
  if (req.url === '/large-image' || req.url === '/large-forbidden') {
    res.writeHead(req.url === '/large-image' ? 200 : 403, { 'content-type': 'image/png' });
    return res.end(Buffer.alloc(65536, 255));
  }
  if (req.url === '/error-page') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><title>502 Bad Gateway</title></html>'); }
  if (req.url === '/slow') return setTimeout(() => { res.writeHead(200); res.end('late'); }, 3000);
  res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Cannot GET ' + req.url);
});
s.listen(0, '127.0.0.1', () => console.log(s.address().port));
`;

export async function startLinkServer() {
  const child = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', (d) => resolve(Number(String(d).trim())));
    child.once('exit', (code) => reject(new Error(`link server exited ${code}`)));
  });
  return { port, url: (p) => `http://localhost:${port}${p}`, stop: () => child.kill() };
}

/** A port nothing listens on. */
export async function deadPort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}
