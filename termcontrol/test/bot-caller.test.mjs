import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BOT_CALLER_TOKEN_ENV, issueBotCaller, resolveBotCaller } from '../../scripts/lib/bot-caller.mjs';
import { resolveCaller } from '../../scripts/termfleet-child.mjs';
import { recordHelper } from '../../scripts/termfleet-team.mjs';
import { Bots, brainEnv, brainCommand } from '../bridge/bots.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-caller-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { base: path.join(root, 'receipts'), now: 1000, ttlMs: 100 };
  const bot = { id: 'aaaaaaaaaaaa', name: 'A', provider: 'codex', botFolder: path.join(root, 'config-a', 'bots', 'aaaaaaaaaaaa'), sessionId: null };
  const issue = (patch = {}) => issueBotCaller({ ...bot, ...patch }, options);
  const env = (run, patch = {}) => ({ [BOT_CALLER_TOKEN_ENV]: run.token, ...patch });
  const file = (run) => path.join(options.base, `${createHash('sha256').update(run.token).digest('hex')}.json`);
  return { root, options, bot, issue, env, file };
}

test('validated bot caller precedes inherited process ancestry and helper writes use its actual folder', t => {
  const f=fixture(t), issued=f.issue({sessionId:'own-thread'});
  fs.mkdirSync(f.bot.botFolder,{recursive:true});
  const env=f.env(issued,{TERMFLEET_BOT_ID:f.bot.id,CODEX_THREAD_ID:'own-thread',TC_CONFIG_DIR:'/foreign'});
  assert.equal(resolveCaller(env,'/nonexistent-proc',1,f.options).botId,f.bot.id);
  assert.equal(resolveCaller(env,'/nonexistent-proc',1,f.options).paneId,undefined);
  assert.throws(()=>resolveCaller({...env,TERMFLEET_PANE_ID:'terminal-foreign'},'/nonexistent-proc',1,f.options));
  assert.equal(recordHelper({paneId:'terminal-owned'},env,f.options),true);
  assert.equal(recordHelper({paneId:'terminal-observed',followed:true},env,f.options),true);
  const helpers=JSON.parse(fs.readFileSync(path.join(f.bot.botFolder,'helpers.json'),'utf8'));
  assert.deepEqual(helpers.map(h=>[h.paneId,!!h.followed]),[['terminal-owned',false],['terminal-observed',true]]);
  assert.throws(()=>recordHelper({paneId:'terminal-other'},{TERMFLEET_BOT_ID:f.bot.id},f.options));
  issued.revoke();
});

test('real terminal self-call remains terminal and bot commands disable the shared environment server',()=>{
  assert.deepEqual(resolveCaller({TERMFLEET_PANE_ID:'terminal-native'},'/nonexistent-proc',1),{provider:undefined,paneId:'terminal-native'});
  const bot={id:'aaaaaaaaaaaa',name:'A',provider:'codex',cwd:'/tmp',sessions:{},callerToken:'new-token'};
  const env=brainEnv(bot,{TERMFLEET_PANE_ID:'foreign',CODEX_THREAD_ID:'foreign',[BOT_CALLER_TOKEN_ENV]:'stale'});
  assert.equal(env.TERMFLEET_PANE_ID,undefined);
  assert.equal(env.CODEX_THREAD_ID,undefined);
  assert.equal(env[BOT_CALLER_TOKEN_ENV],'new-token');
  assert.ok(brainCommand(bot,'hello').args.includes('mcp_servers.lean-ctx.enabled=false'));
});

test('service-issued context follows actual session and is revoked on completion or thrown run',async t=>{
  const f=fixture(t), issued=[];
  const bots=new Bots({dir:path.join(f.root,'bots'),fill:()=>null,
    callerIssuer:bot=>{const capability=issueBotCaller(bot,{base:f.options.base});issued.push(capability);return capability;},
    run:async(bot,_text,{onEvent})=>{
      onEvent({session:'actual-bot-thread'});
      const env={...brainEnv(bot,{}),CODEX_THREAD_ID:'actual-bot-thread'};
      const caller=resolveBotCaller(env,{base:f.options.base});
      assert.equal(caller.botId,bot.id);
      assert.equal(caller.botFolder,bots.folder(bot.id));
      return {text:'Observed correctly'};
    }});
  const {bot}=bots.create({name:'Capability test',cwd:f.root,provider:'codex'});
  assert.equal((await bots.turn(bot.id,'check')).text,'Observed correctly');
  assert.throws(()=>resolveBotCaller({[BOT_CALLER_TOKEN_ENV]:issued[0].token},{base:f.options.base}));
  assert.ok(!fs.readFileSync(path.join(bots.folder(bot.id),'bot.json'),'utf8').includes(issued[0].token));
  bots.run=async()=>{throw Error('private failure payload');};
  const failed=await bots.turn(bot.id,'check rejection');
  assert.match(failed.error,/Investigation is required/);
  assert.doesNotMatch(failed.error,/private failure payload/);
  assert.throws(()=>resolveBotCaller({[BOT_CALLER_TOKEN_ENV]:issued[1].token},{base:f.options.base}));
});

test('asynchronous session receipt failure stops the run without escaping the event callback',async t=>{
  const f=fixture(t);let stopped=false,revoked=0;
  const bots=new Bots({dir:path.join(f.root,'bots'),fill:()=>null,
    callerIssuer:()=>({token:'test-token',updateSession(){throw Error('disk unavailable');},revoke(){revoked++;}}),
    run:async(_bot,_text,{onStart,onEvent})=>new Promise(resolve=>{
      onStart(()=>{stopped=true;resolve({stopped:true});});
      setImmediate(()=>{onEvent({session:'new-thread'});if(!stopped)resolve({text:'Unexpected success'});});
    })});
  const {bot}=bots.create({name:'Receipt failure',cwd:f.root,provider:'codex'});
  bots.running.set(bot.id,{});
  const result=await bots.turn(bot.id,'check');
  assert.equal(stopped,true);assert.ok(revoked>=1);
  assert.match(result.error,/session identity could not be recorded/);
  assert.equal(result.text,undefined);
});

test('two bots in one checkout have separate server-derived identities without token on disk', (t) => {
  const f = fixture(t), a = f.issue(), b = f.issue({ id: 'bbbbbbbbbbbb', name: 'B' });
  assert.notEqual(a.token, b.token);
  assert.equal(resolveBotCaller(f.env(a), f.options).botId, f.bot.id);
  assert.equal(resolveBotCaller(f.env(b), f.options).botId, 'bbbbbbbbbbbb');
  const raw = fs.readFileSync(f.file(a), 'utf8');
  assert.equal(raw.includes(a.token), false);
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), ['version', 'id', 'name', 'provider', 'botFolder', 'sessionId', 'expiresAt'].sort());
  assert.equal(fs.statSync(f.options.base).mode & 0o777, 0o700);
  assert.equal(fs.statSync(f.file(a)).mode & 0o777, 0o600);
});

test('foreign panes and threads are refused; an actual fresh bot session works after update', (t) => {
  const f = fixture(t), a = f.issue();
  for (const extra of [{ TERMFLEET_PANE_ID: 'terminal-other' }, { CODEX_THREAD_ID: 'other' }, { CODEX_SESSION_ID: 'other' }]) {
    assert.throws(() => resolveBotCaller(f.env(a, extra), f.options), /Bot caller context/);
  }
  a.updateSession('own-thread');
  assert.equal(resolveBotCaller(f.env(a, { CODEX_THREAD_ID: 'own-thread', CODEX_SESSION_ID: 'own-thread' }), f.options).sessionId, 'own-thread');
  assert.throws(() => resolveBotCaller(f.env(a, { CODEX_THREAD_ID: 'own-thread', CODEX_SESSION_ID: 'other' }), f.options));
  const claude = f.issue({ provider: 'claude', sessionId: 'claude-session' });
  assert.throws(() => resolveBotCaller(f.env(claude, { CODEX_THREAD_ID: 'claude-session' }), f.options));
});

test('arbitrary bot identity cannot authorize another bot or choose an alternate runtime directory', (t) => {
  const f = fixture(t), a = f.issue();
  assert.equal(resolveBotCaller({}, f.options), null);
  for (const env of [{ TERMFLEET_BOT_ID: f.bot.id }, { TERMFLEET_BOT_NAME: 'A' }, f.env(a, { TERMFLEET_BOT_ID: 'bbbbbbbbbbbb' }), f.env(a, { TERMFLEET_BOT_NAME: 'B' }), { [BOT_CALLER_TOKEN_ENV]: '../not-a-token' }]) {
    assert.throws(() => resolveBotCaller(env, f.options));
  }
  assert.equal(resolveBotCaller(f.env(a, { HOME: '/wrong', TC_CONFIG_DIR: '/wrong', TERMFLEET_BOT_CALLER_DIR: '/wrong' }), f.options).botId, f.bot.id);
  const b = f.issue({ botFolder: path.join(f.root, 'config-b', 'bots', f.bot.id) });
  assert.equal(resolveBotCaller(f.env(a, { TC_CONFIG_DIR: path.join(f.root, 'config-b') }), f.options).botFolder, f.bot.botFolder);
  assert.equal(resolveBotCaller(f.env(b, { TC_CONFIG_DIR: path.join(f.root, 'config-a') }), f.options).botFolder, path.join(f.root, 'config-b', 'bots', f.bot.id));
  assert.throws(() => f.issue({ botFolder: '../relative' }));
});

test('expired, revoked, missing and malformed receipts fail closed', (t) => {
  const f = fixture(t), a = f.issue();
  assert.throws(() => resolveBotCaller(f.env(a), { ...f.options, now: 1100 }));
  a.revoke();
  a.revoke();
  assert.throws(() => resolveBotCaller(f.env(a), f.options));
  assert.throws(() => a.updateSession('late'));
  const b = f.issue();
  fs.writeFileSync(f.file(b), '{bad');
  assert.throws(() => resolveBotCaller(f.env(b), f.options));
  fs.writeFileSync(f.file(b), JSON.stringify({ version: 1 }));
  assert.throws(() => resolveBotCaller(f.env(b), f.options));
});

test('symlink and permissive receipt files and runtime directories are refused', (t) => {
  const f = fixture(t), a = f.issue(), original = fs.readFileSync(f.file(a));
  fs.chmodSync(f.file(a), 0o644);
  assert.throws(() => resolveBotCaller(f.env(a), f.options));
  fs.chmodSync(f.file(a), 0o600);
  fs.chmodSync(f.options.base, 0o755);
  assert.throws(() => resolveBotCaller(f.env(a), f.options));
  assert.throws(() => f.issue());
  fs.chmodSync(f.options.base, 0o700);
  const target = path.join(f.root, 'target.json');
  fs.writeFileSync(target, original, { mode: 0o600 });
  fs.unlinkSync(f.file(a)); fs.symlinkSync(target, f.file(a));
  assert.throws(() => resolveBotCaller(f.env(a), f.options));
  const link = path.join(f.root, 'link'); fs.symlinkSync(f.options.base, link);
  assert.throws(() => resolveBotCaller(f.env(a), { ...f.options, base: link }));
  assert.throws(() => issueBotCaller(f.bot, { ...f.options, base: link }));
});
