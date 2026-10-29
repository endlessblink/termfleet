// Noam 2026-10-25: "תמיד ושזה יהיה ברמת הקוד - אם משהו גמור אתה חייב לתת לי לינק עובד" and
// "ברמת הקוד אסור שתטעה שוב". A ready/done mark used to pass any localhost URL by its shape;
// now every link in the evidence is opened and must answer with a working page.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage, markItem, linkProblem, tailnetToLocal, bodyProblem } from '../bridge/requirements.mjs';
import { startLinkServer, deadPort } from './helpers/link-server.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'link-check-'));

test('large binary response preserves the actual HTTP outcome across the probe child pipe', async (t) => {
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  assert.equal(linkProblem(srv.url('/large-image')), null, 'a reachable image must not become a fabricated timeout');
  assert.match(linkProblem(srv.url('/large-forbidden')), /answered 403/, 'large bodies cannot hide auth denial');
});

test('a dead port is refused, a 404 is refused, an error page is refused, a working page passes', async (t) => {
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  const dir = tmp();
  const [item] = captureMessage({ text: 'Fix the board page', project: 'test', source: 'conv-x' }, { dir });
  const dead = await deadPort();

  const refusedDead = markItem({ status: 'ready', id: item.id, evidence: `live at http://localhost:${dead}/board` }, { dir }).error;
  assert.match(refusedDead, /cannot be marked yet/);
  assert.match(refusedDead, /nothing is running there/);

  const refused404 = markItem({ status: 'done', id: item.id, evidence: `live at ${srv.url('/missing')}` }, { dir }).error;
  assert.match(refused404, /answered 404 instead of a working page/);

  assert.match(linkProblem(`live at ${srv.url('/error-page')}`), /error page/);

  assert.equal(markItem({ status: 'ready', id: item.id, evidence: `live at ${srv.url('/ok')}` }, { dir }).error, undefined);
  assert.equal(linkProblem(`redirects are followed: ${srv.url('/go')}.`), null, 'trailing dot is not part of the link, and 302 → 200 passes');
});

test('one broken link among working ones still refuses the mark', async (t) => {
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  const file = path.join(tmp(), 'shot.png');
  fs.writeFileSync(file, 'png');
  assert.equal(linkProblem(`screenshot ${file} and ${srv.url('/ok')}`), null);
  assert.match(linkProblem(`screenshot ${file} and ${srv.url('/nope')}`), /\/nope answered 404/);
  assert.match(linkProblem(`screenshot /no/such/shot.png and ${srv.url('/ok')}`), /does not exist/);
});

test('a page that does not answer within the time limit is refused', async (t) => {
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  process.env.TERMFLEET_LINK_TIMEOUT_MS = '1000';
  t.after(() => { delete process.env.TERMFLEET_LINK_TIMEOUT_MS; });
  assert.match(linkProblem(srv.url('/slow')), /did not answer within/);
});

test('a tailnet link is opened through the local port tailscale serve forwards it to', async (t) => {
  const srv = await startLinkServer();
  t.after(() => srv.stop());
  const serve = { Web: {
    'pc.tail1.ts.net:8445': { Handlers: { '/': { Proxy: `http://127.0.0.1:${srv.port}` }, '/review/approve': { Proxy: 'http://127.0.0.1:1' } } },
  } };
  process.env.TERMFLEET_TAILSCALE_SERVE_JSON = JSON.stringify(serve);
  t.after(() => { delete process.env.TERMFLEET_TAILSCALE_SERVE_JSON; });

  assert.equal(tailnetToLocal('https://pc.tail1.ts.net:8445/ok?x=1', serve), `http://127.0.0.1:${srv.port}/ok?x=1`);
  assert.equal(tailnetToLocal('https://pc.tail1.ts.net:8445/review/approve/7', serve), 'http://127.0.0.1:1/7');
  assert.equal(tailnetToLocal('https://pc.tail1.ts.net:9999/ok', serve), null);

  assert.equal(linkProblem('phone link https://pc.tail1.ts.net:8445/ok'), null);
  assert.match(linkProblem('phone link https://pc.tail1.ts.net:8445/missing'), /opened on this PC as http:\/\/127\.0\.0\.1:\d+\/missing\) answered 404/);
  assert.match(linkProblem('phone link https://pc.tail1.ts.net:7777/ok'), /not served by tailscale/);
});

test('error bodies are recognised, ordinary pages are not', () => {
  assert.ok(bodyProblem('Cannot GET /x'));
  assert.ok(bodyProblem('<html><head><title>404 Not Found</title>'));
  assert.ok(bodyProblem('{"error":"no such board"}'));
  assert.equal(bodyProblem('<html><title>Agent Board</title><body>Errors today: 0</body></html>'), null);
  assert.equal(bodyProblem(''), null);
});
