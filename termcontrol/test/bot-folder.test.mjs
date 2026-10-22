// Noam 2026-10-22: "what happens if I open an agent that has no project? Maybe add an option
// to open a project / folder?" and then: reach the new folder's place from the window, make it,
// open it and set it, all inside the New bot window, folded away until needed.
// A bot can work in a project folder he picks, or keep its own empty home folder (the old
// behaviour). Its folder can be changed later. Existing folders are only ever checked; the only
// folders ever made are the bot's own home folder and an EMPTY new folder he names.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';
import { checkFolder, knownFolders, subfolders, makeFolder, startFolder } from '../bridge/bot-folders.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tf-botfolder-'));
function setup() {
  const root = tmp(), home = path.join(root, 'bots-home'), project = path.join(root, 'my-project'), other = path.join(root, 'other-project');
  fs.mkdirSync(project); fs.mkdirSync(other);
  process.env.TC_BOTS_HOME = home;
  const bots = new Bots({ dir: path.join(root, 'state'), run: async () => ({ text: 'ok' }) });
  return { root, home, project, other, bots };
}

test('no folder picked: the bot gets its own new home folder, as before', () => {
  const { bots, home } = setup();
  const { bot } = bots.create({ name: 'Homey' });
  assert.equal(bot.cwd, path.join(home, 'Homey'));
  assert.equal(fs.statSync(bot.cwd).isDirectory(), true);
  assert.equal(bot.ownFolder, true);
});

test('a picked project folder is used as it is, and nothing new is made', () => {
  const { bots, project, home } = setup();
  const { bot } = bots.create({ name: 'Proj', cwd: project + '/' });
  assert.equal(bot.cwd, project);
  assert.equal(bot.ownFolder, false);
  assert.equal(fs.existsSync(path.join(home, 'Proj')), false, 'no home folder made when a project is picked');
});

test('a folder that is missing, relative, or a file is refused and never created', () => {
  const { bots, root } = setup();
  const missing = path.join(root, 'not-here');
  assert.match(bots.create({ name: 'Ghost', cwd: missing }).error, /does not exist/);
  assert.equal(fs.existsSync(missing), false);
  assert.match(bots.create({ name: 'Rel', cwd: 'some/relative' }).error, /full folder path/);
  const file = path.join(root, 'a-file.txt'); fs.writeFileSync(file, 'x');
  assert.match(bots.create({ name: 'Filey', cwd: file }).error, /not a folder/);
  assert.equal(bots.list().length, 0);
});

test('a folder typed with ~ means the home folder', () => {
  assert.equal(checkFolder('~').folder, os.homedir());
  assert.equal(checkFolder('').folder, null);
});

test('the folder can be changed later: the bot starts a fresh conversation there and keeps the chat', () => {
  const { bots, project, other } = setup();
  const { bot } = bots.create({ name: 'Mover', cwd: project });
  const before = bots.read(bot.id);
  bots.append(bot.id, { role: 'operator', text: 'please keep this' });
  const moved = bots.update(bot.id, { cwd: other });
  assert.equal(moved.ok, true);
  assert.equal(moved.bot.cwd, other);
  const after = bots.read(bot.id);
  assert.notEqual(after.sessions.claude.id, before.sessions.claude.id, 'a new conversation in the new folder');
  assert.equal(after.sessions.claude.started, false);
  assert.equal(after.sessions.codex, null);
  assert.match(after.handover, /please keep this/);
  assert.ok(bots.messages(bot.id).some((m) => m.role === 'system' && m.text.includes(other)));
  // The same folder again changes nothing.
  bots.update(bot.id, { cwd: other });
  assert.equal(bots.read(bot.id).sessions.claude.id, after.sessions.claude.id);
});

test('changing to a missing folder is refused and the bot stays where it was', () => {
  const { bots, project, root } = setup();
  const { bot } = bots.create({ name: 'Stay', cwd: project });
  assert.match(bots.update(bot.id, { cwd: path.join(root, 'gone') }).error, /does not exist/);
  assert.equal(bots.read(bot.id).cwd, project);
  assert.equal(fs.existsSync(path.join(root, 'gone')), false);
});

test('emptying the folder moves the bot back to its own home folder', () => {
  const { bots, project, home } = setup();
  const { bot } = bots.create({ name: 'Back', cwd: project });
  const res = bots.update(bot.id, { cwd: '' });
  assert.equal(res.bot.cwd, path.join(home, 'Back'));
  assert.equal(res.bot.ownFolder, true);
  assert.equal(fs.existsSync(project), true, 'the project folder is never removed');
});

test('the folder is not changed while the bot is answering', () => {
  const { bots, project, other } = setup();
  const { bot } = bots.create({ name: 'Busy', cwd: project });
  bots.running.set(bot.id, { startedAt: Date.now() });
  assert.match(bots.update(bot.id, { cwd: other }).error, /finishes/);
  assert.equal(bots.read(bot.id).cwd, project);
});

test('known folders: projects, terminals and bots, once each, only ones that still exist', () => {
  const root = tmp(), a = path.join(root, 'alpha'), b = path.join(root, 'beta');
  fs.mkdirSync(a); fs.mkdirSync(b);
  const list = knownFolders({
    projects: [{ name: 'Alpha app', cwd: a }],
    panes: [{ cwd: a, project: 'alpha' }, { cwd: b }, { cwd: path.join(root, 'gone') }, { cwd: '' }],
    bots: [{ name: 'Quill', cwd: b }],
  });
  assert.deepEqual(list.map((f) => f.cwd), [a, b]);
  assert.equal(list[0].name, 'Alpha app');
  assert.equal(list[1].name, 'beta');
});

test('browsing starts in the projects area: the shared parent of the known projects', () => {
  const root = tmp(), a = path.join(root, 'work', 'one'), b = path.join(root, 'work', 'two', 'deep');
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true });
  assert.equal(startFolder([{ cwd: a }, { cwd: b }]), path.join(root, 'work'));
  assert.equal(startFolder([{ cwd: a }]), path.dirname(a));
  assert.equal(startFolder([]), os.homedir());
  assert.equal(startFolder([{ cwd: a }, { cwd: '/usr' }]), os.homedir(), 'never the top of the disk');
  // Projects on two drives: start where most of them are, not at the top of the disk.
  const c = path.join(root, 'work', 'three'); fs.mkdirSync(c);
  assert.equal(startFolder([{ cwd: a }, { cwd: b }, { cwd: c }, { cwd: '/usr' }]), path.join(root, 'work'));
});

test('browsing lists only the folders inside, without hidden ones, with a way up', () => {
  const root = tmp();
  for (const d of ['zeta', 'Alpha', '.hidden']) fs.mkdirSync(path.join(root, d));
  fs.writeFileSync(path.join(root, 'file.txt'), 'x');
  const view = subfolders(root);
  assert.equal(view.path, root);
  assert.equal(view.parent, path.dirname(root));
  assert.deepEqual(view.dirs.map((d) => d.name), ['Alpha', 'zeta']);
  assert.match(subfolders(path.join(root, 'nope')).error, /does not exist/);
  assert.equal(subfolders('/').parent, null);
});

test('a new folder is made empty, inside the current one, and never replaces anything', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'taken'));
  fs.writeFileSync(path.join(root, 'taken', 'keep.txt'), 'precious');
  const made = makeFolder(root, ' My new app ');
  assert.equal(made.folder, path.join(root, 'My new app'));
  assert.deepEqual(fs.readdirSync(made.folder), [], 'empty: no git, no files');
  assert.match(makeFolder(root, 'taken').error, /already/);
  assert.equal(fs.readFileSync(path.join(root, 'taken', 'keep.txt'), 'utf8'), 'precious');
  for (const bad of ['', '.', '..', 'a/b', '../escape', '.hidden', 'x\0y']) assert.ok(makeFolder(root, bad).error, `refused: ${JSON.stringify(bad)}`);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escape')), false);
  assert.match(makeFolder(path.join(root, 'nope'), 'x').error, /does not exist/);
  assert.equal(fs.existsSync(path.join(root, 'nope')), false);
});
