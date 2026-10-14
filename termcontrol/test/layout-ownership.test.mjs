import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileLivePanes,retiredTerminalIds} from '../bridge/inventory.mjs';
const id=(tab,pane)=>`terminal-${tab}-${pane}`;
function fixture(){return {groups:[{id:'termfleet-project',name:'TermFleet',emoji:'🛰️',color:'#123456'}],tabs:[{id:'tf',groupId:'termfleet-project',terminals:[],splitLayout:{type:'terminal',id:'leaf'},initialCwd:'/projects/termfleet',earlierSessions:[{ptyIds:['predecessor'],title:'before',endedAt:100}]},{id:'other',terminals:[{id:'other-owned'}]}],canvasState:{nodes:[{id:'tf-card',type:'terminal',terminalTabId:'tf'},{id:'other-card',type:'terminal',terminalTabId:'other'}]},workspaceUiState:{canvasSidebarSortMode:'manual',canvasSidebarManualOrder:['other-card','tf-card']},closedSessionIds:['closed']};}
const life=(extra={})=>({exited:false,initialCwd:'/projects/termfleet',...extra});
test('a live PTY owned by an existing split leaf survives an empty saved terminal array',()=>{
 const ws=fixture(),before=structuredClone(ws),current=id('tf','leaf');
 const live=new Map([[current,life()],['other-owned',life()],['stray',life()],['predecessor',life()]]);
 const records=[{id:current,provider:'claude',sessionId:'exact-conversation',project:'termfleet',updatedAt:2}];
 const panes=reconcileLivePanes(records,live,ws,new Map());
 assert.deepEqual(panes.map(p=>p.id),['other-owned',current]);
 assert.equal(panes[1].sessionId,'exact-conversation');
 assert.equal(panes[1].continues.count,1);
 assert.deepEqual(ws,before,'never mutate persisted map ownership');
});
test('inferred ownership retains project identity without a sidecar',()=>{
 const current=id('tf','leaf'),panes=reconcileLivePanes([],new Map([[current,life()]]),fixture(),new Map());
 assert.equal(panes.length,1);assert.equal(panes[0].mapGroupId,'termfleet-project');assert.equal(panes[0].mapGroupName,'TermFleet');assert.equal(panes[0].emoji,'🛰️');
});
test('closed and handed-over split identities remain retired, even with no explicit records',()=>{
 const ws=fixture(),current=id('tf','leaf');ws.closedSessionIds.push(current);
 assert.ok(retiredTerminalIds(ws).has(current));
 assert.deepEqual(reconcileLivePanes([],new Map([[current,life()]]),ws,new Map()),[]);
 ws.closedSessionIds=[];ws.tabs[0].earlierSessions[0].ptyIds.push(current);
 assert.deepEqual(reconcileLivePanes([],new Map([[current,life()]]),ws,new Map()),[]);
});
test('explicit runtime ownership wins over derived leaf identity',()=>{
 const ws=fixture();ws.tabs[0].terminals=[{id:'rebound',paneId:'leaf'}];
 assert.deepEqual(reconcileLivePanes([],new Map([['rebound',life()],[id('tf','leaf'),life()]]),ws,new Map()).map(p=>p.id),['rebound']);
});
test('only terminal leaves of existing cards qualify; matching cwd alone grants no ownership',()=>{
 const ws=fixture();ws.tabs[0].splitLayout={type:'split',children:[{type:'terminal',id:'left'},{type:'preview',id:'preview'},{type:'split',children:[{type:'terminal',id:'right'}]}]};
 const live=new Map(['left','right','preview','unknown'].map(p=>[id('tf',p),life()]));
 assert.deepEqual(reconcileLivePanes([],live,ws,new Map()).map(p=>p.id),[id('tf','left'),id('tf','right')]);
});
