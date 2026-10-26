import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terminalName } from '../../scripts/termfleet-team.mjs';

// Complaint #17 (2026-10-26): all 5 running terminals had no name; three read just "politic-fighter".
test('a given name wins', () => {
  assert.equal(terminalName('Title menu fix', 'anything'), 'Title menu fix');
});

test('without one, the first real sentence of the task names it, framing skipped (real shapes)', () => {
  assert.equal(terminalName(null, '[Message from the bot "politic-figther_dev" (bot:d557f3283bc8), sent through TermFleet.] Fix the official title menu and ESC on the tester site. Then deploy.'), 'Fix the official title menu and ESC on');
  assert.equal(terminalName(null, 'Goal: Fix stale terminals in the canvas map\nTask: Clean up nodes'), 'Fix stale terminals in the canvas map');
  assert.equal(terminalName(null, 'Read /home/x/.local/share/terminal-workspace/child-tasks/a.md and carry out the instructions in it.\n# Abbas leg animation fix'), 'Abbas leg animation fix');
  assert.equal(terminalName(null, ''), '');
  // Two bot helpers on 26 Oct were named just "Noam": the task began "Noam: the workout sounds...".
  assert.equal(terminalName(null, "Noam: the workout sounds are 'really really bad' and 'too loud'. Do NOT change the live app yet."), 'the workout sounds are really really');
  assert.equal(terminalName(null, 'Noam is choosing workout sounds on the picker page. Check it.'), 'Noam is choosing workout sounds on the');
});

test('bots are told to name the terminals they start', () => {
  const src = fs.readFileSync(new URL('../bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(src, /give every terminal you start a short plain name with `--name "<2-5 words>"`/);
});
