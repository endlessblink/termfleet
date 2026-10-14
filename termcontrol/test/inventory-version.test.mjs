import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {inventoryVersion,withLayoutTerminals,readWorkspace} from '../bridge/inventory.mjs';import {PATHS} from '../bridge/paths.mjs';
test('inventory version binds ownership, actual group and order while activity stays independent',()=>{
 const ws={tabs:[{id:'t',groupId:'one',terminals:[],splitLayout:{type:'terminal',id:'leaf'}}],groups:[{id:'one',name:'A'}],closedSessionIds:[]};const v=inventoryVersion(withLayoutTerminals(ws));
 const activity=structuredClone(ws);activity.tabs[0].updatedAt=5;assert.equal(inventoryVersion(withLayoutTerminals(activity)),v);
 for(const mutate of [w=>w.tabs[0].splitLayout.id='other',w=>w.tabs[0].groupId='two',w=>w.groups[0].name='B',w=>w.closedSessionIds.push('terminal-t-leaf')]){const changed=structuredClone(ws);mutate(changed);assert.notEqual(inventoryVersion(withLayoutTerminals(changed)),v);}
});
test('partial checkpoint reads keep last coherent identity and fresh writes replace it',()=>{
 const original=PATHS.workspace,dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-snapshot-'));PATHS.workspace=path.join(dir,'workspace.json');
 try{fs.writeFileSync(PATHS.workspace,JSON.stringify({tabs:[{id:'first',terminals:[]}]}));const first=readWorkspace();fs.writeFileSync(PATHS.workspace,'{"tabs":');fs.utimesSync(PATHS.workspace,1,1);assert.strictEqual(readWorkspace(),first);fs.writeFileSync(PATHS.workspace,JSON.stringify({tabs:[{id:'second',terminals:[]}]}));fs.utimesSync(PATHS.workspace,2,2);assert.equal(readWorkspace().tabs[0].id,'second');}finally{PATHS.workspace=original;fs.rmSync(dir,{recursive:true,force:true});}
});
