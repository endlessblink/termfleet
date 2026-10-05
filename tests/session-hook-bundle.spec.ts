import {expect,test} from '@playwright/test';
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import {pathToFileURL} from 'node:url';
const root=process.cwd();
const connector=fs.readFileSync(path.join(root,'scripts/termfleet-connect-agents.mjs'),'utf8');
const list=connector.match(/const HOOK_FILES = (\[[\s\S]*?\]);/)![1];
const required:string[]=vm.runInNewContext(list);
test('resource bundle contains every stable hook dependency and copied modules actually import',async()=>{
 const resources=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/tauri.conf.json'),'utf8')).bundle.resources;
 const resourceFiles=new Set(Object.keys(resources).map(p=>path.resolve(root,'src-tauri',p)));
 for(const rel of [...required,'lib/session-event-journal.mjs','../shared/sessionCompatibility.mjs','../shared/sessionState.mjs','../shared/sessionEnvelope.mjs']) {
  expect(resourceFiles.has(path.resolve(root,'scripts',rel)),`missing packaged ${rel}`).toBe(true);
 }
 const dir=fs.mkdtempSync('/tmp/termfleet-hook-bundle-');
 try {
  fs.writeFileSync(path.join(dir,'package.json'),'\u007b"type":"module"\u007d');
  for(const [source,target] of Object.entries(resources)) {
   const destination=path.join(dir,String(target));fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(path.resolve(root,'src-tauri',source),destination);
  }
  for(const name of ['termfleet-codex-status-hook.mjs','termfleet-claude-status-hook.mjs','lib/session-event-journal.mjs']) {
   const imported=await import(pathToFileURL(path.join(dir,'agent-hooks',name)).href);expect(imported).toBeTruthy();
  }
  fs.mkdirSync(path.join(dir,'plugin'));
  const target=path.join(dir,'plugin/termfleet-status.js');fs.symlinkSync(path.join(dir,'agent-hooks/termfleet-opencode-status-plugin.js'),target);
  const plugin=await import(pathToFileURL(target).href);
  const writer=plugin.createStatusWriter({paneId:'packaged-synthetic-pane',filePath:path.join(dir,'data/pane.json')});
  writer.state.sessionId='packaged-synthetic-chat';writer.state.turn='working';writer.state.userTask='Reliable checkout';
  const published=await plugin.publishOpenCodeEvent(writer,{type:'chat.message'},1000);
  expect(published.state.lifecycle).toBe('working');expect(published.state.goal.text).toBe('Reliable checkout');

 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('Claude registration includes explicit pre-tool input events; OpenCode points to stable helper-equipped source',()=>{
 expect(connector.match(/const CLAUDE_EVENTS = ([^;]+);/)![1]).toContain('"PreToolUse"');
 expect(connector).toContain('symlinkSync(path.join(hookHome, "termfleet-opencode-status-plugin.js"), target)');
});
