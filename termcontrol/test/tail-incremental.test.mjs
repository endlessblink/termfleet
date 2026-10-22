// Agent-Manager 2026-10-22 (PC unusable): the bridge re-read the last 2-12 MB of every active
// agent's conversation file on every poll (~7 MB/s). Appended files are now read incrementally.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tailLines, tailReadStats } from '../bridge/tail.mjs';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-tail-')), 'log.jsonl');

test('a growing file is read only from where the last read stopped, with the same lines', () => {
  const file = tmp();
  fs.writeFileSync(file, '{"a":1}\n{"a":2}\n');
  assert.deepEqual(tailLines(file, 1024), ['{"a":1}', '{"a":2}']);
  const before = tailReadStats().bytesRead;
  fs.appendFileSync(file, '{"a":3}\n');
  assert.deepEqual(tailLines(file, 1024), ['{"a":1}', '{"a":2}', '{"a":3}']);
  assert.equal(tailReadStats().bytesRead - before, 8, 'only the new line was read');
  const again = tailReadStats().bytesRead;
  assert.deepEqual(tailLines(file, 1024), ['{"a":1}', '{"a":2}', '{"a":3}']);
  assert.equal(tailReadStats().bytesRead, again, 'an unchanged file is not read at all');
});

test('a line written in two halves comes out whole', () => {
  const file = tmp();
  fs.writeFileSync(file, '{"a":1}\n{"b":');
  assert.deepEqual(tailLines(file, 1024), ['{"a":1}', '{"b":']);
  fs.appendFileSync(file, '2}\n');
  assert.deepEqual(tailLines(file, 1024), ['{"a":1}', '{"b":2}']);
});

test('the window stays the last N bytes, and a rewritten file is read fresh', () => {
  const file = tmp();
  fs.writeFileSync(file, `${'x'.repeat(30)}\n`.repeat(3));
  tailLines(file, 70);
  fs.appendFileSync(file, `${'y'.repeat(30)}\n`);
  assert.deepEqual(tailLines(file, 70), ['x'.repeat(30), 'y'.repeat(30)]);
  fs.writeFileSync(file, '{"new":1}\n');
  assert.deepEqual(tailLines(file, 70), ['{"new":1}']);
});
