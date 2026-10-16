import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSkills, suggestSkill, approveSkill, rejectSkill, header } from '../bridge/skills.mjs';
import { run } from '../../scripts/termfleet-skill.mjs';

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-skills-'));
  const dirs = { library: path.join(root, 'lib'), suggested: path.join(root, 'sug'), claude: path.join(root, 'claude'), codex: path.join(root, 'codex'), missing: path.join(root, 'opencode') };
  fs.mkdirSync(dirs.claude); fs.mkdirSync(dirs.codex);
  process.env.TC_SKILLS_LIBRARY = dirs.library;
  process.env.TC_SKILLS_SUGGESTED = dirs.suggested;
  process.env.TC_SKILLS_PROVIDERS = [dirs.claude, dirs.codex, dirs.missing].join(':');
  return { ...dirs, done: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const good = { name: 'weekly-invoice-check', description: 'Use every Friday to check which invoices are still unpaid.', body: '1. Open the invoices sheet.\n2. List unpaid ones.\n3. Ask Noam before sending any reminder.' };

test('a suggestion is not usable until approved, then every agent kind gets it', () => {
  const s = sandbox();
  try {
    assert.equal(suggestSkill({ ...good, by: 'bot Quill' }).ok, true);
    assert.deepEqual(listSkills().map((k) => [k.name, k.status, k.by]), [['weekly-invoice-check', 'suggested', 'bot Quill']]);
    assert.equal(fs.existsSync(path.join(s.claude, 'weekly-invoice-check')), false, 'no agent sees a suggestion');
    const done = approveSkill('weekly-invoice-check');
    assert.equal(done.ok, true); assert.equal(done.linked, 2, 'linked into the two agent folders that exist');
    assert.equal(fs.readlinkSync(path.join(s.claude, 'weekly-invoice-check')), path.join(s.library, 'weekly-invoice-check'));
    const text = fs.readFileSync(path.join(s.library, 'weekly-invoice-check', 'SKILL.md'), 'utf8');
    assert.equal(header(text).name, 'weekly-invoice-check');
    assert.doesNotMatch(text, /suggested-by/);
    assert.deepEqual(listSkills().map((k) => k.status), ['approved']);
  } finally { s.done(); }
});

test('approval never replaces an agent skill that already has that name', () => {
  const s = sandbox();
  try {
    fs.mkdirSync(path.join(s.claude, 'weekly-invoice-check'));
    fs.writeFileSync(path.join(s.claude, 'weekly-invoice-check', 'SKILL.md'), 'mine');
    suggestSkill(good);
    assert.equal(approveSkill('weekly-invoice-check').linked, 1);
    assert.equal(fs.readFileSync(path.join(s.claude, 'weekly-invoice-check', 'SKILL.md'), 'utf8'), 'mine');
  } finally { s.done(); }
});

test('bad names, thin skills, duplicates and path tricks are refused; reject removes', () => {
  const s = sandbox();
  try {
    assert.match(suggestSkill({ ...good, name: '../escape' }).error, /lowercase/);
    assert.match(suggestSkill({ ...good, description: 'short' }).error, /Describe/);
    assert.match(suggestSkill({ ...good, body: 'do it' }).error, /steps/);
    assert.match(approveSkill('../lib').error, /Unknown/);
    suggestSkill(good); approveSkill(good.name);
    assert.match(suggestSkill(good).error, /already exists/);
    suggestSkill({ ...good, name: 'second-skill' });
    assert.equal(rejectSkill('second-skill').ok, true);
    assert.equal(listSkills().length, 1);
  } finally { s.done(); }
});

test('the command a bot runs saves a suggestion credited to that bot', () => {
  const s = sandbox();
  try {
    const out = run(['save', good.name, '--description', good.description, '--body', good.body], { TERMFLEET_BOT_NAME: 'Quill' });
    assert.equal(out.ok, true); assert.match(out.message, /approves/);
    assert.equal(listSkills()[0].by, 'bot Quill');
    assert.match(run(['list'], {}).message, /waiting for Noam/);
    assert.equal(run(['nonsense'], {}).ok, false);
  } finally { s.done(); }
});
