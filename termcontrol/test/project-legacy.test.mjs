import test from 'node:test';
import assert from 'node:assert/strict';
import * as projects from '../bridge/projects.mjs';
import {spawnArgs} from '../bridge/spawn.mjs';

test('legacy group launch requires one live current root and exact saved map owner',()=>{
 assert.equal(typeof projects.legacyProjectChoice,'function');
 const workspace={groups:[{id:'desk-id',name:'Desk',projectRoot:'/desk'}]};
 const pane={id:'synthetic-pane',project:'desk',cwd:'/desk',mapGroupId:'desk-id',alive:true};
 const choose=panes=>projects.legacyProjectChoice(panes,workspace,'desk');
 assert.equal(choose([pane,{...pane,id:'second-pane'}]),pane);
 assert.deepEqual(spawnArgs(pane,'codex','/tmp/synthetic-task.md'),['spawn','--provider','codex','--cwd','/desk','--task-file','/tmp/synthetic-task.md','--title','desk · new codex','--near','/desk']);
 for(const panes of [[],[{...pane,alive:false}],[pane,{...pane,cwd:'/other'}],[pane,{...pane,mapGroupId:'other'}],[{...pane,mapGroupId:null}],[{...pane,cwd:'/wrong-root'}]])assert.throws(()=>choose(panes),/project|folder/i);
 assert.throws(()=>projects.legacyProjectChoice([pane],{groups:[...workspace.groups,{id:'another-id',projectRoot:'/desk'}]},'desk'),/ownership/i);
 assert.throws(()=>projects.legacyProjectChoice([pane],{groups:[...workspace.groups,workspace.groups[0]]},'desk'),/owner/i);
});
