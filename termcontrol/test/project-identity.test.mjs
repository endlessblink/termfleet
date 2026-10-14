import test from 'node:test';import assert from 'node:assert/strict';import {byProject} from '../bridge/prefs.mjs';
const p=(id,extra={})=>({id,project:'same-name',turn:'idle',updatedAt:1,...extra});
test('map IDs alone group chats; matching names or cwd never merge unrelated projects',()=>{
 const panes=[p('a',{mapGroupId:'one',mapGroupName:'Shared name'}),p('b',{mapGroupId:'two',mapGroupName:'Shared name'}),p('c',{mapGroupId:'one',mapGroupName:'Shared name'}),p('d',{cwd:'/same'}),p('e',{cwd:'/same'})];
 const groups=byProject(panes);assert.deepEqual(groups.map(g=>g.panes.map(p=>p.id)),[['a','c'],['b'],['d'],['e']]);assert.equal(new Set(groups.map(g=>g.id)).size,4);assert.equal(groups[0].project,'Shared name');
});
