import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripControlCodes } from '../bridge/liveness.mjs';
import { claudeFolderTrustPrompt, codexFolderTrustPrompt, trustDecision } from '../bridge/delivery.mjs';

// The real bytes Claude Code 2.x drew for a brand-new folder (2026-10-26). It puts the gaps between
// words with cursor moves and shows its menu without numbers. Read the old way, the question was
// "Isthisaprojectyoucreated..." and nothing answered it: 12 helper terminals never started in four
// days, and a message typed later chose the default "No, exit".
const raw = fs.readFileSync(new URL('./fixtures/claude-folder-trust-screen.txt', import.meta.url), 'utf8');

test('the screen reader keeps the spaces Claude draws with cursor moves', () => {
  const text = stripControlCodes(raw);
  assert.match(text, /Is this a project you created or one you trust\?/);
  assert.match(text, /❯ No, exit/);
  assert.match(text, /Yes, I trust this folder/);
});

test('an unnumbered trust menu is answered with one Down, from the ❯ on "No, exit" to Yes', () => {
  assert.deepEqual(claudeFolderTrustPrompt(stripControlCodes(raw)), { yesOption: null, noOption: null, yesKeys: '\u001b[B' });
  const d = trustDecision(stripControlCodes(raw), { cwd: '/home/user/projects/new-folder', folderRoots: ['/home/user/projects'] });
  assert.equal(d.press, '\u001b[B');
});

test('outside the folders Noam trusts, it still asks him instead of answering', () => {
  const d = trustDecision(stripControlCodes(raw), { cwd: '/home/user/projects/new-folder', folderRoots: ['/srv/other'] });
  assert.match(d.error, /not inside a folder Noam already trusts/);
});

test('the numbered menu of older versions still gives its Yes number', () => {
  const s = 'Do you trust the files in this folder?\n❯ 1. Yes, proceed\n  2. No, exit\n';
  assert.equal(claudeFolderTrustPrompt(s).yesOption, '1');
});

// Codex draws its whole screen with row;column jumps; read without them it was one glued line
// ("Trustthisfolder?Codexcanread...") and its folder-trust question was never answered.
const codexRaw = fs.readFileSync(new URL('./fixtures/codex-folder-trust-screen.txt', import.meta.url), 'utf8');

test('a Codex screen keeps its lines and spaces', () => {
  const text = stripControlCodes(codexRaw);
  assert.match(text, /Trust this folder\? Codex can read, edit, and run files here/);
  assert.match(text, /\n› 1\. Trust and continue\s*\n2\. Quit\n/);
});

test("Codex's folder-trust question is answered with its number inside trusted folders, and asked about outside", () => {
  const text = stripControlCodes(codexRaw);
  assert.deepEqual(codexFolderTrustPrompt(text), { yesOption: '1', noOption: '2' });
  assert.equal(trustDecision(text, { cwd: '/home/user/projects/new-folder', folderRoots: ['/home/user/projects'] }).press, '1');
  assert.match(trustDecision(text, { cwd: '/home/user/projects/new-folder', folderRoots: ['/srv'] }).error, /new Codex terminal is asking whether to trust its folder/);
});

test('a message that only talks about the question is not the question', () => {
  const s = "› Helpers died at the 'trust this folder?' prompt; a pasted message picks 'No, exit' there.\n";
  assert.equal(claudeFolderTrustPrompt(s), null);
  assert.equal(trustDecision(s, { cwd: '/x', folderRoots: [] }), null);
});
