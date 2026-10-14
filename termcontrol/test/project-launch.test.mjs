import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {build} from 'esbuild';
import {projectCatalog,resolveProject,projectLaunchArgs,projectLaunchReady} from '../bridge/projects.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'tc-project-test-'));const cwd=path.join(root,'paper');fs.mkdirSync(cwd);const other=path.join(root,'desk');fs.mkdirSync(other);
const group={id:'paper-id',name:'Paper Bot',projectRoot:cwd};const workspace={groups:[group,{id:'desk-id',name:'Freelance Desk',projectRoot:other}]};
test('dormant projects can be selected by exact ID and ambiguous/deleted/unknown roots fail closed',()=>{
 assert.equal(projectCatalog(workspace)[0].id,'paper-id');assert.equal(resolveProject(workspace,'paper-id').cwd,cwd);
 assert.throws(()=>resolveProject(workspace,'Freelance Desk'),/project/i);
 assert.throws(()=>resolveProject({groups:[group,{...group,id:'another-id'}]},'paper-id'),/ambiguous/i);
 assert.throws(()=>resolveProject({groups:[{...group,projectRoot:path.join(root,'missing')}]},'paper-id'),/folder/i);
 assert.throws(()=>resolveProject({groups:[]},'paper-id'),/project/i);
 assert.deepEqual(projectLaunchArgs(resolveProject(workspace,'paper-id'),'codex','/tmp/task.md'),['spawn','--provider','codex','--cwd',cwd,'--task-file','/tmp/task.md','--title','Paper Bot · new codex','--project-id','paper-id','--no-start-app']);
 assert.throws(()=>projectLaunchArgs(group,'not-a-provider','/tmp/task.md'),/provider/i);
 const cap=path.join(root,'cap.json');fs.writeFileSync(cap,JSON.stringify({version:2,updatedAt:Date.now()}));assert.equal(projectLaunchReady(cap),true);fs.writeFileSync(cap,JSON.stringify({version:2,updatedAt:Date.now()-20000}));assert.equal(projectLaunchReady(cap),false);
});
test('native authority binds exact project/provider and places existing stack below/new stack right without moving other cards',async()=>{
 const built=await build({entryPoints:['src/lib/childTerminals.ts'],bundle:true,write:false,format:'esm',platform:'node'});const native=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const raw={version:2,requestId:'project-request-0001',projectId:'paper-id',provider:'codex',cwd,task:'Synthetic task',createdAt:Date.now()};
 const parsed=native.parseChildRequest(JSON.stringify(raw));assert.equal(parsed.ok,true);assert.equal(parsed.request.projectId,'paper-id');
 for(const extra of [{parentPaneId:'terminal-11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222'},{near:other},{replace:true}])assert.equal(native.parseChildRequest(JSON.stringify({...raw,...extra})).ok,false);
 const size={width:600,height:400};const nodes=[{id:'desk',type:'terminal',terminalTabId:'desk-tab',x:0,y:0,width:600,height:400},{id:'paper',type:'terminal',terminalTabId:'paper-tab',x:800,y:50,width:600,height:400},{id:'paper-2',type:'terminal',terminalTabId:'paper-tab-2',x:800,y:550,width:600,height:500},{id:'other-note',type:'note',x:800,y:1100,width:600,height:200}];
 const tabs=[{id:'desk-tab',groupId:'desk-id'},{id:'paper-tab',groupId:'paper-id'},{id:'paper-tab-2',groupId:'paper-id'}];const original=JSON.stringify(nodes);
 const plan=native.planChildLaunch({request:parsed.request,tabs,nodes,size,groups:workspace.groups});assert.equal(plan.ok,true);assert.equal(plan.projectId,'paper-id');assert.equal(plan.placement.x,800);assert.ok(plan.placement.y>=1332);assert.equal(plan.link,undefined);
 const independent=native.planChildLaunch({request:parsed.request,tabs:[tabs[0]],nodes:[nodes[0],nodes[3]],size,groups:workspace.groups});assert.equal(independent.ok,true);assert.ok(independent.placement.x>=1432);
 assert.equal(JSON.stringify(nodes),original);
 assert.equal(native.planChildLaunch({request:parsed.request,tabs,nodes,size,groups:[]}).reason,'unknown-project');
 assert.equal(native.planChildLaunch({request:{...parsed.request,cwd:other},tabs,nodes,size,groups:workspace.groups}).reason,'project-changed');
 assert.equal(native.planChildLaunch({request:parsed.request,tabs:[...tabs,{id:'previous',groupId:'paper-id',launchRequestId:raw.requestId}],nodes,size,groups:workspace.groups}).reason,'duplicate-request');
});
test.after(()=>fs.rmSync(root,{recursive:true,force:true}));
