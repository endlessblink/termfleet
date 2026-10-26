import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('connector migrates legacy SessionStart history once and preserves other hooks', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-sql-install-'));
  t.after(() => fs.rmSync(home, {recursive:true, force:true}));
  fs.mkdirSync(path.join(home, '.claude'));
  const file = path.join(home, '.claude/settings.json');
  const custom = {type:'command',command:'echo custom'};
  const stop = [{hooks:[{type:'command',command:'node /custom/sql-event-log-stop.mjs'}]}];
  fs.writeFileSync(file, JSON.stringify({hooks:{SessionStart:[{hooks:[{type:'command',command:'node /old/sql-event-log-sessionstart.mjs'},custom]}],Stop:stop}}));
  const env = {...process.env,HOME:home,XDG_DATA_HOME:path.join(home,'data'),XDG_CONFIG_HOME:path.join(home,'config')};
  const run = (...args) => execFileSync(process.execPath,['scripts/termfleet-connect-agents.mjs','--json',...args],{env});
  const original = fs.readFileSync(file,'utf8');
  run('--check'); assert.equal(fs.readFileSync(file,'utf8'),original);
  run();
  const first = fs.readFileSync(file,'utf8'), doc = JSON.parse(first);
  const start = doc.hooks.SessionStart.flatMap(g=>g.hooks || [g]);
  assert.equal(start.filter(h=>h.command.includes('sql-event-log-sessionstart.mjs')).length,0);
  assert.equal(start.filter(h=>h.command.includes('termfleet-sql-history-hook.mjs')).length,1);
  assert.ok(start.some(h=>h.command===custom.command));
  assert.ok(doc.hooks.Stop.some(g=>JSON.stringify(g)===JSON.stringify(stop[0])));
  run(); assert.equal(fs.readFileSync(file,'utf8'),first);
});
