import {test,expect} from '@playwright/test';
import {RecentTerminalCycle,recentTerminalIds,terminalAttentionTargets} from '../src/lib/terminalNavigation';
import type {Tab} from '../src/lib/types';
const tab=(id:string,lastUsedAt?:number, status?:string,at=10) => ({id,lastUsedAt,activePaneId:id,terminals:status?[{paneId:id,status:'running',statusSummary:{task:'Fixture task',path:'/fixture',now:'Fixture step',status,confidence:'high',updatedAt:at,completedByCommand:status==='done'}}]:[]}) as Tab;
test('MRU ignores background updates and preserves unknown order',()=>{
 const tabs=[tab('unknown'),tab('a',20),tab('b',30),tab('unknown2')];
 expect(recentTerminalIds(tabs)).toEqual(['b','a','unknown','unknown2']);
 tabs[0].terminals=[{paneId:'unknown',activityUpdatedAt:999999}] as Tab['terminals'];
 expect(recentTerminalIds(tabs)).toEqual(['b','a','unknown','unknown2']);
});
test('held cycle goes back and forth, ignores new focus order, and prunes closed tabs',()=>{
 const c=new RecentTerminalCycle();const tabs=[tab('a',30),tab('b',20),tab('c',10)];
 expect(c.next(tabs,'a',1)).toBe('b');tabs[1].lastUsedAt=100;
 expect(c.next(tabs,'b',1)).toBe('c');expect(c.next(tabs,'c',-1)).toBe('b');
 expect(c.next([tabs[0],tabs[2]],'b',1)).toBe('a');
 expect(c.next([],'a',1)).toBeNull();c.reset();expect(c.next([tab('only')],'only',-1)).toBe('only');
});
test('attention prioritizes reported waiting, excludes silence and acknowledged completions',()=>{
 const tabs=[tab('done',1,'done'),tab('waiting',2,'waiting'),tab('idle',3,'idle')];
 expect(terminalAttentionTargets(tabs).map(t=>t.tabId)).toEqual(['waiting','done']);
 tabs[0].terminals[0].reviewedCompletionAt=10;
 expect(terminalAttentionTargets(tabs).map(t=>t.tabId)).toEqual(['waiting']);
 tabs[1].terminals[0].statusSummary!.status='working';
 expect(terminalAttentionTargets(tabs)).toEqual([]);
 tabs[0].terminals[0].statusSummary!.updatedAt=20;
 expect(terminalAttentionTargets(tabs).map(t=>t.tabId)).toEqual(['done']);
 tabs[0].terminals[0].status='exited';expect(terminalAttentionTargets(tabs)).toEqual([]);
});
test('window cycle controllers do not share mutable history',()=>{
 const a=new RecentTerminalCycle(),b=new RecentTerminalCycle();const tabs=[tab('a',30),tab('b',20),tab('c',10)];
 expect(a.next(tabs,'a',1)).toBe('b');tabs[2].lastUsedAt=40;
 expect(b.next(tabs,'a',1)).toBe('c');expect(a.next(tabs,'b',1)).toBe('c');
});

test('explicit approvals lead, completion events are stable across text refresh and conversation changes',()=>{
 const done=tab('done',1,'idle',100);done.terminals[0].statusSummary!.completedAt=50;done.terminals[0].statusSummary!.sessionId='old';
 const waiting=tab('question',2,'waiting');const approval=tab('approval',3,'waiting');approval.terminals[0].statusSummary!.waitingReason='approval';
 expect(terminalAttentionTargets([done,waiting,approval]).map(t=>t.kind)).toEqual(['approval','waiting','completed']);
 done.terminals[0].reviewedCompletionAt=50;done.terminals[0].reviewedCompletionSessionId='old';
 expect(terminalAttentionTargets([done])).toEqual([]);
 done.terminals[0].statusSummary!.updatedAt=999;expect(terminalAttentionTargets([done])).toEqual([]);
 done.terminals[0].statusSummary!.sessionId='new';expect(terminalAttentionTargets([done])).toHaveLength(1);
});
