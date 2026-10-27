import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFolderProblem } from '../../scripts/lib/spawn-guards.mjs';

// Noam 2026-10-27: a helper was started in ~/Pictures/termcontrol (a screenshots folder) and filed under the
// home-folder project "endlessblink": "a root folder, dangerous and messy to work in".
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-home-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const mk = (...p) => { const d = path.join(home, ...p); fs.mkdirSync(d, { recursive: true }); return d; };
  const repo = mk('code', 'app'); fs.mkdirSync(path.join(repo, '.git'));
  const sub = mk('code', 'app', 'src', 'lib');
  const pictures = mk('Pictures', 'termcontrol');
  const botHome = mk('TermFleet', 'bots', 'Agent-Manager');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-outside-')); t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  return { home, repo, sub, pictures, botHome, botsHome: path.join(home, 'TermFleet', 'bots'), outside };
}

test('home, root and project-less folders under home are refused with a plain reason', (t) => {
  const f = fixture(t);
  const opts = { home: f.home, botsHome: f.botsHome, env: {} };
  assert.match(startFolderProblem(f.home, opts), /root folder/);
  assert.match(startFolderProblem('/', opts), /root folder/);
  assert.match(startFolderProblem(f.pictures, opts), /not a project folder/);
  assert.match(startFolderProblem(path.join(f.home, 'nope'), opts), /does not exist/);
});

test('a project, a folder inside it, a bot home and a folder outside home pass', (t) => {
  const f = fixture(t);
  const opts = { home: f.home, botsHome: f.botsHome, env: {} };
  assert.equal(startFolderProblem(f.repo, opts), null);
  assert.equal(startFolderProblem(f.sub, opts), null, 'a folder inside a repository is part of it');
  assert.equal(startFolderProblem(f.botHome, opts), null);
  assert.equal(startFolderProblem(f.outside, opts), null);
});

test('the override lets a deliberate start through', (t) => {
  const f = fixture(t);
  assert.equal(startFolderProblem(f.pictures, { home: f.home, botsHome: f.botsHome, env: { TERMFLEET_ALLOW_ANY_FOLDER: '1' } }), null);
});
