import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Claude status-only permissions never authorize input without the same live screen prompt', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vendor-permission-'));
  const id = 'terminal-vendor-permission-fixture', sessionId = 'vendor-permission-fixture';
  const dataHome = path.join(root, 'data'), cwd = path.join(root, 'project');
  const status = path.join(dataHome, 'terminal-workspace/agent-status');
  const sessions = path.join(dataHome, 'terminal-workspace/sessions');
  const vendorDir = path.join(root, '.claude/sessions');
  for (const dir of [cwd, status, sessions, vendorDir]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(sessions, `${Buffer.from(id).toString('hex')}.meta.json`), JSON.stringify({ cols: 100, rows: 24 }));
  fs.writeFileSync(path.join(dataHome, 'terminal-workspace/workspace.json'), JSON.stringify({ tabs: [{ id: 'fixture-tab', cwd, terminals: [{ id }] }], canvasState: { nodes: [{ id: 'fixture-node', type: 'terminal', terminalTabId: 'fixture-tab' }] } }));
  // Only a Node timer: its argv allows the real process inventory to discover a
  // disposable provider-status record. No provider binary, model or real pane.
  const providerStub = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { argv0: '/fixture/claude', env: { ...process.env, HOME: root, TERMFLEET_PANE_ID: id }, stdio: 'ignore' });
  let screen = '> unfinished owner draft', writes = [];
  const publish = (vendor = { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: 1000 }, reason = null) => {
    fs.writeFileSync(path.join(vendorDir, `${providerStub.pid}.json`), JSON.stringify({ sessionId, ...vendor }));
    fs.writeFileSync(path.join(status, 'pane-fixture.json'), JSON.stringify({ paneId: id, source: 'claude', sessionId, cwd, turn: 'waiting', turnReason: reason, updatedAt: Date.now() }));
    fs.writeFileSync(path.join(status, 'termfleet-cockpit-snapshot.json'), JSON.stringify({ sourceApp: 'termfleet', updatedAt: Date.now(), terminals: [{ terminalId: id, updatedAt: Date.now(), terminalVisibleText: screen, terminalVisibleTextUpdatedAt: Date.now() }] }));
  };
  publish();
  const socketPath = path.join(root, 'daemon.sock');
  const daemon = net.createServer({ allowHalfOpen: true }, socket => {
    let body = '';
    socket.on('data', chunk => body += chunk);
    socket.on('end', () => {
      const request = JSON.parse(body);
      let value = {};
      if (request.type === 'listSessions') value = { sessions: [{ id, initialCwd: cwd, pid: providerStub.pid, scrollbackBytes: 1 }] };
      if (request.type === 'snapshotSession') value = { data: screen.replace(/\n/g, '\r\n') };
      if (request.type === 'writeSession') { assert.equal(request.id, id); writes.push(request.data); screen = '> approval handled'; value = { ok: true }; }
      socket.end(JSON.stringify(value));
    });
  });
  await new Promise(resolve => daemon.listen(socketPath, resolve));
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, [new URL('../bridge/server.mjs', import.meta.url).pathname], { env: { ...process.env, HOME: root, XDG_DATA_HOME: dataHome, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: path.join(root, 'config'), TC_CLAUDE_PROJECTS_DIR: path.join(root, 'projects'), TERMFLEET_DAEMON_SOCKET: socketPath, TC_NO_AGENT_HEALTH: '1', TC_DESK_STT: '0' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let errors = ''; child.stderr.on('data', chunk => errors += chunk);
  t.after(async () => {
    for (const process of [child, providerStub]) if (process.exitCode === null) { process.kill(); await once(process, 'exit'); }
    await new Promise(resolve => daemon.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  for (let n = 0; n < 60; n++) { try { await fetch(base + '/setup'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); } }
  const setup = await fetch(base + '/setup', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=fixture%40example.test&password=synthetic-fixture-password' });
  assert.equal(setup.status, 302, errors);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const request = async (url, payload) => {
    const response = await fetch(base + url, { headers: { cookie, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  for (const [name, vendor, reason, text] of [
    ['dated vendor draft', { status: 'waiting', waitingFor: 'permission prompt', statusUpdatedAt: 1000 }, null, '> unfinished owner draft'],
    ['undated vendor shell', { status: 'waiting', waitingFor: 'permission prompt' }, null, '$ echo draft'],
    ['hook-only permission', {}, 'permission_request', '> unfinished owner draft'],
  ]) await t.test(name, async () => {
    screen = text; publish(vendor, reason);
    // Feed inventory caches process status for three seconds; each scenario
    // must receive its own actual card, not a previous successful receipt.
    await new Promise(resolve => setTimeout(resolve, 3100));
    const pending = await request('/api/feed?pane=' + id);
    assert.equal(pending.body.ask?.kind, 'permission', JSON.stringify(pending.body));
    const before = writes.length;
    const reply = await request('/api/send', { pane: id, askId: pending.body.ask.id, choice: 'yes' });
    assert.equal(reply.body.notSent, true, JSON.stringify(reply));
    assert.equal(reply.status, 409);
    assert.equal(writes.length, before, 'status alone cannot authorize any write');
    const repeated = await request('/api/send', { pane: id, askId: pending.body.ask.id, choice: 'yes' });
    assert.equal(repeated.body.duplicate, undefined, 'refusal reserves no successful/uncertain receipt');
    assert.equal(writes.length, before);
  });
  await t.test('unknown live screen refuses even when desktop still shows the old menu', async () => {
    screen = 'Allow this fixture command?\n1. Yes\n2. No\nEsc to cancel'; publish();
    const pending = await request('/api/feed?pane=' + id), before = writes.length;
    screen = '';
    const reply = await request('/api/send', { pane: id, askId: pending.body.ask.id, choice: '1' });
    assert.equal(reply.status, 503); assert.equal(reply.body.notSent, true); assert.equal(writes.length, before);
  });
  await t.test('a different recognized menu refuses the old answer', async () => {
    screen = 'Allow first fixture command?\n1. Yes\n2. No\nEsc to cancel'; publish();
    const pending = await request('/api/feed?pane=' + id), before = writes.length;
    screen = 'Allow second fixture command?\n1. Yes\n2. No\nEsc to cancel'; publish();
    const reply = await request('/api/send', { pane: id, askId: pending.body.ask.id, choice: '1' });
    assert.equal(reply.status, 409); assert.equal(writes.length, before);
  });
  await t.test('recognized live permission still accepts exactly one digit', async () => {
    screen = 'Allow this fixture command?\n1. Yes\n2. No\nEsc to cancel'; publish();
    const pending = await request('/api/feed?pane=' + id), before = writes.length;
    const reply = await request('/api/send', { pane: id, askId: pending.body.ask.id, choice: '1' });
    assert.equal(reply.body.ok, true, JSON.stringify(reply)); assert.deepEqual(writes.slice(before), ['1']);
  });
});
