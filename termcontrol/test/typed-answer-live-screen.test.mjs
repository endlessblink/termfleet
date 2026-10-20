// Noam 2026-10-20 "לא יכול לשלוח הודעה שכתבתי ישירות": on a terminal's question card he typed his
// own answer and pressed Send answer; it was refused "That question is no longer on screen" while
// the question was still waiting. The desktop wrote no terminal text (its copy was empty), and
// the typing step looked only at that copy. Now it reads the live terminal itself, and a typed
// answer whose question has closed goes out as a normal message instead of failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { claudeSlug } from '../bridge/paths.mjs';
import { liveScreenOf, savedSizeOf } from '../bridge/screen.mjs';

const QUESTION = 'My last fix also let the bot post approved stories that have no picture, as text only. Two are first in line and could go out within minutes. Put the "every post needs a real picture" rule back right now?';
const OPTIONS = [{ label: 'Yes, pictures required (Recommended)', description: 'Restore your rule now' }, { label: 'Allow text-only posts', description: 'Stories without a picture post as text' }];

// Claude's question form as the terminal shows it: the question wrapped at the terminal width.
const wrap = (text, width) => text.split(' ').reduce((lines, word) => {
  const last = lines.at(-1);
  if (last && (last + ' ' + word).length <= width) lines[lines.length - 1] = last + ' ' + word; else lines.push(word);
  return lines;
}, []);
const menu = () => ['☐ Pictures', '', ...wrap(QUESTION, 76), '', '❯ 1. ' + OPTIONS[0].label, '     ' + OPTIONS[0].description, '  2. ' + OPTIONS[1].label, '     ' + OPTIONS[1].description, '  3. Type something.', '  4. Chat about this', '', 'Enter to select · ↑/↓ to navigate · Esc to cancel'];
const editor = (typed) => ['☐ Pictures', '', ...wrap(QUESTION, 76), '', '  1. ' + OPTIONS[0].label, '  2. ' + OPTIONS[1].label, '❯ ' + (typed ? wrap(typed, 70).join('\n    ') : 'Type something.'), '', 'Enter to submit · Esc to go back'];
const prompt = (typed = '') => ['❯ ' + typed, '', '  ⏵⏵ auto mode on'];
const ansi = (lines) => '\x1b[2J\x1b[H' + lines.join('\r\n');

test('the live terminal is drawn at its saved size, so the question reads as on the desktop', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-live-screen-'));
  fs.writeFileSync(path.join(dir, Buffer.from('terminal-x').toString('hex') + '.meta.json'), JSON.stringify({ cols: 80, rows: 24 }));
  const size = (id) => savedSizeOf(id, dir);
  const screen = await liveScreenOf('terminal-x', { snapshot: async () => 'old output that scrolled away\r\n' + ansi(menu()), size });
  assert.match(screen, /❯ 1\. Yes, pictures required/);
  assert.match(screen.replace(/\s+/g, ' '), /rule back right now\?/);
  assert.equal(await liveScreenOf('terminal-unknown', { snapshot: async () => ansi(menu()), size }), null, 'no saved size: no guess');
});

test('a typed answer reaches a still-waiting question when the desktop copy is empty; a closed question gets it as a message', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-typed-answer-'));
  const cwd = path.join(root, 'paper-bot'), id = 'terminal-typed-answer-fixture';
  const dataHome = path.join(root, 'data'), ws = path.join(dataHome, 'terminal-workspace'), status = path.join(ws, 'agent-status'), projects = path.join(root, 'projects');
  for (const dir of [status, path.join(ws, 'sessions'), cwd, path.join(projects, claudeSlug(cwd))]) fs.mkdirSync(dir, { recursive: true });
  const statusFile = path.join(status, 'pane-fixture.json');
  const setTurn = (turn) => fs.writeFileSync(statusFile, JSON.stringify({ paneId: id, source: 'claude', sessionId: 'typed-answer-fixture', cwd, turn, updatedAt: Date.now() }));
  setTurn('waiting');
  fs.writeFileSync(path.join(ws, 'workspace.json'), JSON.stringify({ tabs: [{ id: 'synthetic-tab', cwd, terminals: [{ id }] }], canvasState: { nodes: [{ id: 'synthetic-node', type: 'terminal', terminalTabId: 'synthetic-tab' }] } }));
  fs.writeFileSync(path.join(ws, 'sessions', Buffer.from(id).toString('hex') + '.meta.json'), JSON.stringify({ cols: 80, rows: 24 }));
  // As live on 2026-10-20: the desktop writes a snapshot, but no terminal text in it.
  fs.writeFileSync(path.join(status, 'termfleet-cockpit-snapshot.json'), JSON.stringify({ sourceApp: 'termfleet', updatedAt: Date.now(), terminals: [] }));
  const transcript = path.join(projects, claudeSlug(cwd), 'typed-answer-fixture.jsonl');
  let sourceId = '', screen = [], mode = 'menu', typed = '', output = '', writes = [], delivered = [];
  const ask = (suffix, question = QUESTION) => {
    sourceId = 'synthetic-typed-' + suffix; mode = 'menu'; typed = ''; screen = menu();
    fs.appendFileSync(transcript, JSON.stringify({ timestamp: new Date().toISOString(), message: { role: 'assistant', content: [{ type: 'tool_use', name: 'AskUserQuestion', id: sourceId, input: { questions: [{ header: 'Pictures', question, multiSelect: false, options: OPTIONS }] } }] } }) + '\n');
  };
  const answered = (text) => fs.appendFileSync(transcript, JSON.stringify({ timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: sourceId, content: JSON.stringify({ answers: { [QUESTION]: text } }) }] } }) + '\n');
  const draw = () => { output += ansi(screen); };
  fs.writeFileSync(transcript, '');
  ask('first'); draw();
  const socketPath = path.join(root, 'daemon.sock');
  const daemon = net.createServer({ allowHalfOpen: true }, (socket) => {
    let body = '';
    socket.on('data', (chunk) => body += chunk);
    socket.on('end', () => {
      const request = JSON.parse(body);
      let value = {};
      if (request.type === 'listSessions') value = { sessions: [{ id, initialCwd: cwd, pid: 999999, scrollbackBytes: output.length }] };
      else if (request.type === 'snapshotSession') value = { data: output };
      else if (request.type === 'readSession') value = { type: 'readSession', data: '', baseOffset: 0, nextOffset: output.length };
      else if (request.type === 'writeSession') {
        writes.push(request.data);
        value = { ok: true };
        const data = request.data;
        if (mode === 'menu' && data === '3') { mode = 'editor'; screen = editor(''); }
        else if (mode === 'editor' && data.startsWith('\x1b[200~')) { typed = data.slice(6, -6); screen = editor(typed); }
        else if (mode === 'editor' && data === '\r') { answered(typed); delivered.push(typed); mode = 'done'; screen = prompt(); }
        else if (mode === 'menu' && data === '\r') throw new Error('Enter must never reach the menu');
        else if (mode === 'done' && data === '\r') { delivered.push('message:' + typed); typed = ''; screen = prompt(); }
        else if (mode === 'done') { typed = data.replace(/\x1b\[20[01]~/g, ''); screen = prompt(typed); }
        draw();
      }
      socket.end(JSON.stringify(value));
    });
  });
  await new Promise((resolve) => daemon.listen(socketPath, resolve));
  const portServer = net.createServer(); await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
  const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
  const child = spawn(process.execPath, [new URL('../bridge/server.mjs', import.meta.url).pathname], { env: { ...process.env, TC_PORT: String(port), TC_HOST: '127.0.0.1', TC_CONFIG_DIR: path.join(root, 'config'), TC_CLAUDE_PROJECTS_DIR: projects, TC_VERIFIED_CUSTOM_ANSWERS: '1', XDG_DATA_HOME: dataHome, TERMFLEET_DAEMON_SOCKET: socketPath, TC_NO_AGENT_HEALTH: '1', TC_DESK_STT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let childErrors = ''; child.stderr.on('data', (chunk) => childErrors += chunk);
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } await new Promise((resolve) => daemon.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(base + '/setup'); break; } catch { await new Promise((resolve) => setTimeout(resolve, 50)); } }
  const setup = await fetch(base + '/setup', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'email=typed%40example.test&password=a-good-password-123' });
  assert.equal(setup.status, 302, childErrors);
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const request = async (url, payload) => { const response = await fetch(base + url, { headers: { cookie, ...(payload ? { 'content-type': 'application/json' } : {}) }, ...(payload ? { method: 'POST', body: JSON.stringify(payload) } : {}) }); return { status: response.status, body: await response.json() }; };
  const answer = 'why does it matters? also we can generate posts with gpt image 2 cli auth + it doesnt answer why I got the same news post twice';

  // 1) Still waiting, desktop copy empty: the typed answer goes into "Type something" and is submitted.
  const feed = await request('/api/feed?pane=' + id);
  assert.ok(QUESTION.startsWith(feed.body.ask?.title?.trim() || '-'), JSON.stringify(feed.body.ask));
  const sent = await request('/api/send', { pane: id, askId: feed.body.ask.id, answer });
  assert.equal(sent.status, 200, JSON.stringify({ body: sent.body, writes, mode, childErrors }));
  assert.equal(sent.body.ok, true);
  assert.deepEqual(delivered, [answer], 'his words reached the question');
  assert.deepEqual(writes.slice(0, 1), ['3'], 'the "Type something" choice first, never Enter on the menu');

  // 2) The question closed before he sent: his words go to the agent as a normal message.
  setTurn('idle');
  const stale = feed.body.ask.id.replace('first', 'gone');
  ask('second'); answered('Yes'); mode = 'done'; screen = prompt(); draw();
  const asMessage = await request('/api/send', { pane: id, askId: stale, answer: 'please also check the duplicate' });
  assert.equal(asMessage.body.sentAsMessage, true, JSON.stringify(asMessage.body));
  assert.equal(asMessage.body.ok, true, JSON.stringify(asMessage.body));
  assert.ok(delivered.includes('message:please also check the duplicate'));

  // 3) A different question is open now: refused, nothing typed; the page keeps his draft.
  setTurn('waiting');
  ask('third', 'Which picture style should the bot use?'); draw();
  const count = writes.length;
  const other = await request('/api/send', { pane: id, askId: feed.body.ask.id.replace('first', 'earlier'), answer: 'something' });
  assert.equal(other.status, 409);
  assert.equal(other.body.notSent, true);
  assert.equal(writes.length, count, 'nothing reached the new question');
});
