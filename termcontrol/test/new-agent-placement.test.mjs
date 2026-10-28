import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnArgs } from '../bridge/spawn.mjs';

const CLI = path.resolve('scripts/termfleet-child.mjs');
const project = { project: 'freelance-desk', cwd: '/synthetic/freelance-desk' };

test('a new agent is requested for its own project folder, never as a loose card', () => {
  const args = spawnArgs(project, 'codex', '/tmp/task.md');
  assert.equal(args[args.indexOf('--near') + 1], project.cwd);
  assert.equal(args[args.indexOf('--cwd') + 1], project.cwd);
  assert.ok(!args.includes('--separate'), 'must not ask to be separate');
  assert.ok(!args.includes('--replace'), 'must never replace an existing card');
});

test('the real launcher turns those arguments into a request that joins the project group', async () => {
  const dataHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-placement-'));
  try {
    const dir = path.join(dataHome, 'terminal-workspace', 'child-requests');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.listener'), String(Date.now()));
    const task = path.join(dataHome, 'task.md');
    fs.writeFileSync(task, 'Draft the weekly summary for the freelance desk project.');
    const child = spawn('node', [CLI, ...spawnArgs(project, 'codex', task), '--timeout', '15', '--no-start-app'], {
      env: { ...process.env, XDG_DATA_HOME: dataHome, TERMFLEET_PANE_ID: '' }, stdio: 'ignore',
    });
    const exited = new Promise((resolve) => child.on('exit', resolve));
    // Play the app: pick the request up, then answer it.
    let request = null;
    for (let i = 0; i < 60 && !request; i++) {
      const file = fs.readdirSync(dir).find((name) => name.endsWith('.request.json'));
      if (file) {
        request = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        fs.writeFileSync(path.join(dir, file.replace('.request.', '.result.')), JSON.stringify({ ok: true, childPaneId: 'x' }));
      } else await new Promise((r) => setTimeout(r, 100));
    }
    await exited;
    assert.ok(request, 'the launcher wrote a request');
    assert.equal(request.near, project.cwd, 'asks the app to place it with this project');
    assert.equal(request.cwd, project.cwd);
    assert.ok(!request.replace, 'no existing card is replaced');
  } finally { fs.rmSync(dataHome, { recursive: true, force: true }); }
});
