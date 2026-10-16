import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, isCorrection, update, report } from '../../scripts/termfleet-agent-health.mjs';

const at = (day, h = 10) => `${day}T${String(h).padStart(2, '0')}:00:00`;

test('corrections are recognised in English and Hebrew; ordinary asks are not', () => {
  for (const t of ['That\'s not what I asked', 'I said the sidebar', 'still broken', 'no, the other one', 'Not yet, honestly. this was glossed over', 'זה לא מה שביקשתי', 'עדיין לא עובד']) assert.ok(isCorrection(t), t);
  for (const t of ['Make the bots the main screen', 'go', 'Design the model dropdown better', 'what about the full goal?']) assert.ok(!isCorrection(t), t);
});

test('only real chats count; automated runs are skipped', () => {
  const s = {};
  classify('claude', JSON.stringify({ type: 'user', entrypoint: 'sdk-cli', timestamp: at('2026-10-12'), message: { content: 'go' } }), s);
  assert.equal(s.automated, true);
  const c = {};
  classify('codex', JSON.stringify({ type: 'session_meta', payload: { originator: 'codex_exec' } }), c);
  assert.equal(c.automated, true);
});

test('daily counts, rates per 100 messages, and a verdict after the second week', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-health-'));
  try {
    const proj = path.join(home, '.claude', 'projects', '-p'); fs.mkdirSync(proj, { recursive: true });
    const line = (o) => JSON.stringify(o);
    const day = (d, n, fixes, compacts, errors) => [
      ...Array.from({ length: n }, (_, i) => line({ type: 'user', entrypoint: 'cli', timestamp: at(d, 9 + (i % 8)), message: { content: i < fixes ? 'that\'s not what I asked' : 'please add the button' } })),
      ...Array.from({ length: compacts }, () => line({ type: 'system', subtype: 'compact_boundary', entrypoint: 'cli', timestamp: at(d) })),
      ...Array.from({ length: errors }, () => line({ type: 'assistant', isApiErrorMessage: true, entrypoint: 'cli', timestamp: at(d) })),
    ];
    const rows = [];
    for (let i = 10; i <= 16; i++) rows.push(...day(`2026-10-${i}`, 20, 4, 6, 2));
    for (let i = 17; i <= 23; i++) rows.push(...day(`2026-10-${i}`, 20, 1, 2, 2));
    fs.writeFileSync(path.join(proj, 'chat.jsonl'), rows.join('\n') + '\n');
    const auto = path.join(home, '.claude', 'projects', '-q'); fs.mkdirSync(auto, { recursive: true });
    fs.writeFileSync(path.join(auto, 'run.jsonl'), day('2026-10-12', 50, 50, 50, 50).map((l) => l.replace('"cli"', '"sdk-cli"')).join('\n') + '\n');
    const now = new Date('2026-10-24T12:00:00').getTime();
    let store = update({ home, store: { files: {}, days: {} }, now });
    assert.deepEqual(store.days['2026-10-12'], { said: 20, lost: 6, fixed: 4, stuck: 2 }, 'the automated run is not counted');
    // Appending reads only what is new.
    fs.appendFileSync(path.join(proj, 'chat.jsonl'), line({ type: 'user', entrypoint: 'cli', timestamp: at('2026-10-24'), message: { content: 'I said blue' } }) + '\n');
    store = update({ home, store, now });
    assert.deepEqual(store.days['2026-10-24'], { said: 1, lost: 0, fixed: 1, stuck: 0 });
    assert.equal(store.days['2026-10-12'].said, 20, 'nothing counted twice');
    const r = report(store, now);
    assert.equal(r.baseline.rates.fixed, 20);
    assert.equal(r.after.rates.fixed, 5);
    assert.deepEqual(r.verdict, { lost: 'better', fixed: 'better', stuck: 'same' });
    assert.equal(r.days.length, 14);
    assert.equal(report(store, new Date('2026-10-20T12:00:00').getTime()).verdict, null, 'no verdict before the week is over');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
