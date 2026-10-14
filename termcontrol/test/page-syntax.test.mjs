import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// The whole phone app is one inline module; a single duplicate name blanks the page.
test('the phone app script parses', () => {
  const html = fs.readFileSync(path.join(import.meta.dirname, '../app/index.html'), 'utf8');
  const src = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.ok(src.length > 1000);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-page-')), 'page.mjs');
  fs.writeFileSync(file, src);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});
