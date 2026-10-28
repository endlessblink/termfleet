import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { claudeSlug, recentDigest, searchSessions, showSession } from '../../scripts/lib/session-digest.mjs';
import { run } from '../../scripts/termfleet-session-digest.mjs';

// #6: a new agent should be able to see what earlier sessions in its folder said, not just that they happened.
const CWD = '/work/bots+automation/health-app';
const NOW = Date.parse('2026-10-27T12:00:00Z');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-digest-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const claudeDir = path.join(home, '.claude', 'projects', claudeSlug(CWD));
  fs.mkdirSync(claudeDir, { recursive: true });
  const user = (text, at) => JSON.stringify({ type: 'user', cwd: CWD, timestamp: at, message: { content: text } });
  const bot = (text, at) => JSON.stringify({ type: 'assistant', cwd: CWD, timestamp: at, message: { content: [{ type: 'text', text }, { type: 'tool_use', name: 'Bash' }] } });
  fs.writeFileSync(path.join(claudeDir, 'aaaaaaaa-1111.jsonl'), [
    JSON.stringify({ type: 'ai-title', aiTitle: 'Workout sounds picker' }),
    user('The workout sounds are too loud, show me alternatives first', '2026-10-26T10:00:00Z'),
    JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta noise' } }),
    JSON.stringify({ type: 'user', timestamp: '2026-10-26T10:00:30Z', message: { content: [{ type: 'tool_result', content: 'x' }] } }),
    user('<system-reminder>ignore me</system-reminder>', '2026-10-26T10:01:00Z'),
    bot('I made a picker page with 6 calm sounds at /reports/sounds', '2026-10-26T10:05:00Z'),
    user('Pick the third one and keep volume low', '2026-10-26T10:10:00Z'),
    bot('Done: sound three, volume 40 percent, saved in the app', '2026-10-26T10:12:00Z'),
  ].join('\n'));
  fs.utimesSync(path.join(claudeDir, 'aaaaaaaa-1111.jsonl'), new Date('2026-10-26T10:12:00Z'), new Date('2026-10-26T10:12:00Z'));
  const day = path.join(home, '.codex', 'sessions', '2026', '10', '26');
  fs.mkdirSync(day, { recursive: true });
  const codexFile = path.join(day, 'rollout-2026-10-26T08-00-00-01a17519-2fbe-72a0-af12-eafaa0707e87.jsonl');
  const msg = (role, text, at) => JSON.stringify({ type: 'response_item', timestamp: at, payload: { type: 'message', role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } });
  fs.writeFileSync(codexFile, [
    JSON.stringify({ type: 'session_meta', payload: { id: '01a17519-2fbe', cwd: CWD, timestamp: '2026-10-26T08:00:00Z' } }),
    msg('user', '# AGENTS.md instructions\nboilerplate', '2026-10-26T08:00:01Z'),
    msg('user', 'Check why the sandwich page is slow', '2026-10-26T08:00:05Z'),
    msg('assistant', 'The sandwich page loads 4 MB of images; I resized them', '2026-10-26T08:09:00Z'),
  ].join('\n'));
  fs.utimesSync(codexFile, new Date('2026-10-26T08:09:00Z'), new Date('2026-10-26T08:09:00Z'));
  // A session from another folder must never appear.
  const other = path.join(day, 'rollout-2026-10-26T09-00-00-02b00000-0000-0000-0000-000000000000.jsonl');
  fs.writeFileSync(other, [JSON.stringify({ type: 'session_meta', payload: { id: '02b00000', cwd: '/elsewhere' } }), msg('user', 'secret other folder talk', '2026-10-26T09:00:05Z')].join('\n'));
  return { home };
}

test('recent: each session of the folder, newest first, with what was asked and how it ended', (t) => {
  const { home } = fixture(t);
  const lines = recentDigest(CWD, { home, now: NOW });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /claude aaaaaaaa "Workout sounds picker"/);
  assert.match(lines[0], /asked: The workout sounds are too loud/);
  assert.match(lines[0], /asked: Pick the third one/);
  assert.match(lines[0], /ended: Done: sound three, volume 40 percent/);
  assert.doesNotMatch(lines[0], /meta noise|ignore me|tool_result/);
  assert.match(lines[1], /codex 01a17519/);
  assert.match(lines[1], /asked: Check why the sandwich page is slow/);
  assert.doesNotMatch(lines[1], /boilerplate/);
  assert.doesNotMatch(lines.join('\n'), /secret other folder/);
});

test('search finds words said in any earlier session of the folder, in either agent, and only that folder', (t) => {
  const { home } = fixture(t);
  const hits = searchSessions(CWD, 'volume low', { home, now: NOW });
  assert.equal(hits.length, 1);
  assert.match(hits[0], /claude aaaaaaaa Noam: …Pick the third one and keep volume low/);
  assert.match(searchSessions(CWD, 'images resized', { home, now: NOW })[0], /codex 01a17519 agent:/);
  assert.deepEqual(searchSessions(CWD, 'secret other', { home, now: NOW }), []);
});

test('show: the end of one session by the start of its id; old sessions fall outside the day window', (t) => {
  const { home } = fixture(t);
  const lines = showSession(CWD, 'aaaaaaaa', { home, now: NOW, tail: 2 });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /agent: Done: sound three/);
  assert.deepEqual(recentDigest(CWD, { home, now: NOW + 90 * 86_400_000, days: 14 }), []);
});

test('the command prints the digest and says plainly when there is nothing', (t) => {
  const { home } = fixture(t);
  const said = [];
  const prev = process.env.HOME; process.env.HOME = home;
  try {
    assert.equal(run(['search', 'volume', '--cwd', CWD], { out: (s) => said.push(s) }), 0);
    assert.equal(run(['search', 'zzzz-nothing', '--cwd', CWD], { out: (s) => said.push(s) }), 1);
    assert.equal(run([], { out: (s) => said.push(s) }), 2);
  } finally { process.env.HOME = prev; }
  assert.match(said[0], /volume low/);
  assert.match(said[1], /Nothing in earlier sessions/);
  assert.match(said[2], /Usage/);
});
