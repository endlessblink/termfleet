import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Separate process keeps HOME, PATHS, ledger, and daemon access synthetic.
function fixture(check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-pane-readers-'));
  const prelude = `
    import fs from 'node:fs';
    import path from 'node:path';
    import assert from 'node:assert/strict';
    import {paneSidecarPath,sidecarPath,statusDir} from './scripts/lib/agent-status-paths.mjs';
    import {fleetPanes} from './termcontrol/bridge/orchestrate.mjs';
    import {untakenItems,requirementIds} from './scripts/termfleet-team.mjs';
    import {captureMessage,record} from './termcontrol/bridge/requirements.mjs';
    fs.mkdirSync(statusDir(),{recursive:true});
    const a='terminal-fixture-a', b='terminal-fixture-b';
    const write=(id,data)=>fs.writeFileSync(paneSidecarPath(id),JSON.stringify({
      paneId:id,source:'codex-hook',sessionId:id+'-session',cwd:'/same-folder',
      updatedAt:Date.now(),turn:'idle',...data
    }));
    write(a,{declaredGoal:'Keep the first goal',statedTask:'Checking first work',now:'first'});
    write(b,{statedGoal:'Keep the second goal',statedTask:'Checking second work',now:'second'});
    fs.writeFileSync(sidecarPath('/same-folder'),JSON.stringify({sessionId:'wrong-folder-session',declaredGoal:'Wrong shared goal'}));
  `;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module','-e',prelude + check], {
      cwd: new URL('../..', import.meta.url), encoding:'utf8', timeout:10000,
      env:{...process.env,HOME:dir,XDG_DATA_HOME:path.join(dir,'data'),
        TC_CONFIG_DIR:path.join(dir,'config'),TERMFLEET_REQ_DIR:path.join(dir,'ledger'),
        TERMFLEET_DAEMON_SOCKET:path.join(dir,'absent.sock'),TERMFLEET_BOT_ID:'',
        TERMFLEET_PANE_ID:'',CODEX_THREAD_ID:''},
    });
    assert.equal(result.status,0,result.stderr || result.error?.message);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}

test('fleet reads goals, tasks and now from writer hashed paths independently per pane', () => fixture(`
  const panes=await fleetPanes({workspace:{tabs:[]}});
  const first=panes.find(p=>p.id===a), second=panes.find(p=>p.id===b);
  assert.equal(first.goal,'Keep the first goal');
  assert.equal(first.statedTask,'Checking first work');
  assert.equal(first.now,'first');
  assert.equal(second.goal,'Keep the second goal');
  assert.equal(second.statedTask,'Checking second work');
  assert.equal(second.now,'second');
`));

test('untaken items use exact hashed pane session and enforce requirement handoff', () => fixture(`
  const one=captureMessage({text:'Preserve first unfinished work',source:'codex:'+a+'-session',project:'fixture',msgId:'first'});
  captureMessage({text:'Preserve second unfinished work',source:'codex:'+b+'-session',project:'fixture',msgId:'second'});
  captureMessage({text:'Exclude folder sibling work',source:'codex:wrong-folder-session',project:'fixture',msgId:'folder'});
  assert.deepEqual(untakenItems({env:{},selfId:a}).map(x=>x.id),one.map(x=>x.id));
  assert.match(requirementIds({},'Please check this work',{env:{},selfId:a}).error,/Name the items/);
  assert.deepEqual(requirementIds({req:one[0].id},'Please check this work',{env:{},selfId:a}).ids,[one[0].id]);
  record([{e:'status',id:one[0].id,status:'partial',at:Date.now(),open:['still under review']}]);
  assert.deepEqual(untakenItems({env:{},selfId:a}),[]);
`));

test('missing and malformed pane records never fall back to folder or literal file', () => fixture(`
  fs.unlinkSync(paneSidecarPath(a));
  fs.writeFileSync(path.join(statusDir(),'pane-'+a+'.json'),JSON.stringify({sessionId:'wrong-folder-session'}));
  captureMessage({text:'Do not borrow unrelated session work',source:'codex:wrong-folder-session',project:'fixture',msgId:'folder'});
  assert.deepEqual(untakenItems({env:{},selfId:a}),[]);
  fs.writeFileSync(paneSidecarPath(a),'{bad');
  assert.deepEqual(untakenItems({env:{},selfId:a}),[]);
  assert.deepEqual(untakenItems({env:{},selfId:null}),[]);
`));

test('explicit bot items retain their existing independent route', () => fixture(`
  const own=captureMessage({text:'Preserve bot unfinished work',source:'bot:0123456789ab',project:'fixture',msgId:'bot'});
  captureMessage({text:'Exclude other bot work',source:'bot:abcdef012345',project:'fixture',msgId:'other'});
  assert.deepEqual(untakenItems({env:{TERMFLEET_BOT_ID:'0123456789ab'},selfId:a}).map(x=>x.id),own.map(x=>x.id));
`));
