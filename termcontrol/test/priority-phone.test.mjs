// Noam 2026-10-22: a terminal's menu on the phone has Urgent and the agents' share choice,
// and the bridge answers them and keeps Urgent marks true.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../bridge/server.mjs', import.meta.url), 'utf8');

test('the phone terminal menu offers Urgent and the Gentle / Medium / Normal share', () => {
  assert.match(page, /data-urgent>\$\{ui\('Make urgent'/);
  assert.match(page, /data-w="20".*data-w="50".*data-w="100"/);
  assert.match(page, /\/api\/priority\/urgent/);
  assert.match(page, /\/api\/priority\/settings/);
});

test('the bridge serves the priority routes (the priority guard service keeps Urgent marks true)', () => {
  assert.match(server, /await handlePriority\(req, res, url, json\)/);
});
