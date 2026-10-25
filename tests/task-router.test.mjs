// Noam 2026-10-24: "לא רוצה הארדקודינג!!!", "זה תלוי משימה...", "זה צריך להיות ראוטר אמיתי, מדויק ואמין!",
// "וודא פרוגרמטית שזה לא סתם יהיה הבטחות באוויר". Each Claude helper gets the model its task needs:
// haiku for read-only jobs, sonnet for ordinary changes, opus for hard jobs. Rules only, no model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask, explainTaskRoute } from '../scripts/lib/task-router.mjs';

const SIMPLE = [
  'Check the status of the daemon',
  'List the open terminals',
  'What is the current git branch?',
  'How many panes are running right now?',
  'Read the README and tell me what the project does',
  'Is the dev server running?',
  'Find where the config file lives',
  'Show me the last 20 lines of the app log',
  'Look at MASTER_PLAN and report the active task, read-only, do not edit anything',
  'תבדוק את הסטטוס של השרת',
  'כמה טרמינלים פתוחים?',
];

const STANDARD = [
  'Fix the bug in the save button',
  'Add a --verbose flag to the CLI',
  'Update the README install section',
  'Rename the helper function and update its callers in utils.ts',
  'Write unit tests for the date parser',
  'Build the release and commit the version bump',
  'The login form crashes on empty email, fix it',
  'Change the header color to dark blue in theme.css',
  'תקן את הבאג בכפתור השמירה',
  'Do the thing we talked about',
  '',
];

const COMPLEX = [
  'Design the architecture for the new sync engine',
  'Refactor the auth flow across all modules',
  'Write an implementation plan for moving the daemon to a new protocol',
  'Find the root cause of the intermittent freeze when switching tabs',
  'Debug the race condition between the bridge and the daemon',
  'Multi-file refactor of the store into smaller slices',
  'Migrate the database layer and redesign the schema',
  'Do a security audit of the whole codebase',
  'Update a.ts, b.ts, c.rs and d.py to use the new logger',
  'תכנן ארכיטקטורה חדשה לשכבת הסנכרון',
];

for (const [label, tasks, expected] of [['simple', SIMPLE, 'haiku'], ['standard', STANDARD, 'sonnet'], ['complex', COMPLEX, 'opus']]) {
  test(`${label} tasks route to ${expected}`, () => {
    for (const task of tasks) assert.equal(classifyTask(task), expected, `${JSON.stringify(task)} -> ${JSON.stringify(explainTaskRoute(task))}`);
  });
}

test('a read word never sends a change to the cheap model', () => {
  assert.equal(classifyTask('Read the config and fix the typo'), 'sonnet');
  assert.equal(classifyTask('Check the build and fix what fails'), 'sonnet');
  assert.equal(classifyTask('List the files and delete the stale ones'), 'sonnet');
});

test('a long brief with many steps is a hard job', () => {
  const steps = (n) => Array.from({ length: n }, (_, i) => `- step ${i + 1}: update the copy`).join('\n');
  assert.equal(classifyTask(`Fix these:\n${steps(3)}`), 'sonnet');
  assert.equal(classifyTask(`Fix these:\n${steps(12)}`), 'opus');
  assert.equal(classifyTask(`Refactor and fix these:\n${steps(9)}`), 'opus');
});

test('same text always gets the same answer, with reasons', () => {
  const task = 'Find the root cause of the freeze';
  const first = explainTaskRoute(task);
  assert.deepEqual(explainTaskRoute(task), first);
  assert.equal(first.model, 'opus');
  assert.ok(first.reasons.some((r) => r.includes('root cause')));
});

test('only the three model names come out', () => {
  for (const task of [...SIMPLE, ...STANDARD, ...COMPLEX, null, undefined, 42]) {
    assert.ok(['haiku', 'sonnet', 'opus'].includes(classifyTask(task)));
  }
});

// Noam 2026-10-25: "אתה בעצם דואג של טרמינל חדש ישתנה לקודקס?". A new terminal with no
// --provider starts in Codex; Claude only when the task needs it.
import { explainProviderRoute } from '../scripts/lib/task-router.mjs';
import fs from 'node:fs';

test('new terminals start in Codex by default; Claude only for conversation, open reasoning, or by name', () => {
  for (const task of ['Fix the failing export test', 'Build the watchdog module and add tests', 'Run the release build and report', '', 'Refactor the canvas renderer across 6 files'])
    assert.equal(explainProviderRoute(task).provider, 'codex', task);
  for (const task of ['Handle the conversation with Noam about the trailer', 'Think it through and weigh the trade-offs of the two designs', 'Use Claude for this one: review the copy', 'תעבוד עם קלוד על זה'])
    assert.equal(explainProviderRoute(task).provider, 'claude', task);
  const child = fs.readFileSync(new URL('../scripts/termfleet-child.mjs', import.meta.url), 'utf8');
  assert.match(child, /if \(!provider && !handover\) \{\s*const picked = explainProviderRoute\(baseTask\);/, 'the spawn command uses the router when --provider is left out');
  const bots = fs.readFileSync(new URL('../termcontrol/bridge/bots.mjs', import.meta.url), 'utf8');
  assert.match(bots, /termfleet-team start --cwd <folder> --task "<task>"` \(open a new terminal agent for a job; it starts in Codex/, 'bots are told new terminals start in Codex');
});
