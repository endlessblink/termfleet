import { summaryFromSidecar as nodeSidecarSummary } from "../scripts/agent-status-summary-sidecar.mjs";
import { summaryFromSidecar } from "../src/lib/agentStatusSidecar";
import { test, expect } from '@playwright/test';
import { keepNewerReportedStatus } from '../src/lib/badgeLiveness';
import { preserveDurablePaneGoal, projectStatusPollResult, pollTargetMatchesRun } from '../src/lib/statusPollProjection';
import { reconcileSessionStatus } from '../src/lib/sessionStatus';
import type { TerminalState, WorkstreamStatusSummary } from '../src/lib/types';
const summary = (overrides = {}) => ({task:'Checking the current change',path:'/fixture',now:'Reading results',status:'working',provider:'codex',confidence:'high',updatedAt:100,...overrides}) as WorkstreamStatusSummary;
test('an expired Goal cannot prove that no work is running', () => {
 const pane = {id:'a',paneId:'a',statusSummary:summary(),statusSummarySource:'sidecar'} as TerminalState;
 const projection=projectStatusPollResult(pane,{source:'fallback',sidecarState:'stale',summary:{...summary({mainTask:'Keep every terminal connected so work can be resumed safely',mainTaskSource:'about-what'}),provider:'codex',confidence:'high'}},200);
 expect(projection?.statusSummary?.status).toBe('unavailable');
 expect(projection?.statusSummary?.now).toBe('Status unavailable');
 expect(projection?.statusSummary?.confidence).toBe('low');
 expect(projection?.statusSummary?.mainTask).toContain('every terminal');
});
test('a late report cannot replace newer Task or Now', () => {
 const stored=summary({updatedAt:200,task:'The new task',now:'Doing the new task',status:'waiting'});
 const next=summary({updatedAt:100,task:'The old task',now:'Doing the old task'});
 const result=keepNewerReportedStatus(stored,next);
 expect(result.task).toBe('The new task');expect(result.now).toBe('Doing the new task');expect(result.status).toBe('waiting');
});
test('missing or unknown agent evidence remains unavailable',()=>{
 expect(reconcileSessionStatus({}).attention).toBe('unavailable');
 expect(reconcileSessionStatus({summaryStatus:'unknown'}).attention).toBe('unavailable');
});

test('a new conversation cannot inherit the old Goal',()=>{
 const old = summary({sessionId:'old',mainTask:'Keep every terminal connected so work can be resumed safely',mainTaskSource:'about-what'});
 const next=summary({sessionId:'new'});
 expect(preserveDurablePaneGoal(old,next).mainTask).toBeUndefined();
});

test('delayed results from prior runs cannot write to a restored or replacement pane',()=>{
 const pane = {id:'pty',paneId:'pane',activeRunId:'run',providerSessionId:'session'} as TerminalState;
 expect(pollTargetMatchesRun({...pane,id:'restored-pty'},pane)).toBe(true);
 expect(pollTargetMatchesRun({...pane,activeRunId:'new-run'},pane)).toBe(false);
 expect(pollTargetMatchesRun({...pane,providerSessionId:'new-session'},pane)).toBe(false);
});

test('a stale new session clears the old task list and request but preserves a manual request',()=>{
 const pane={id:'p',paneId:'p',statusSummarySource:'sidecar',statusSummary:summary({sessionId:'old'}),mainUserAsk:{text:'The old request',source:'status-sidecar'},taskLine:{text:'The old task',source:'declared',capturedAt:1,expiresAt:null},taskLineup:[{text:'Old list'}]} as unknown as TerminalState;
 const result={source:'fallback' as const,sidecarState:'stale' as const,summary:{...summary({sessionId:'new',mainTask:'Keep every terminal connected so work can be resumed safely',mainTaskSource:'about-what'}),provider:'codex' as const,confidence:'high' as const}};
 const projection=projectStatusPollResult(pane,result,200);
 expect(projection?.mainUserAsk).toBeUndefined();expect(projection?.taskLine).toBeUndefined();expect(projection?.taskLineup).toEqual([]);
 pane.mainUserAsk={...pane.mainUserAsk!,source:'manual'};
 expect(projectStatusPollResult(pane,result,200)?.mainUserAsk?.text).toBe('The old request');
});

test('only explicit turn-end records create review events; permission reasons stay distinct',()=>{
 const fallback={...summary(),provider:'codex' as const,confidence:'high' as const};
 expect(summaryFromSidecar({turn:'idle',source:'codex-narration',updatedAt:20,sessionId:'s'},fallback).completedAt).toBe(20);
 expect(summaryFromSidecar({turn:'idle',source:'claude-narration',updatedAt:30,sessionId:'s'},fallback).completedAt).toBe(30);
 expect(summaryFromSidecar({turn:'idle',updatedAt:40},fallback).completedAt).toBeUndefined();
 expect(summaryFromSidecar({turn:'working',source:'codex-tool',updatedAt:50},fallback).completedAt).toBeUndefined();
 expect(summaryFromSidecar({turn:'waiting',turnReason:'permission_request'},fallback).waitingReason).toBe('approval');
 expect(summaryFromSidecar({turn:'waiting',turnReason:'operator_question'},fallback).waitingReason).toBe('input');
});

test('PTY ids cannot redirect a delayed report to another pane or conversation',()=>{
 const pane={id:'same-pty',paneId:'pane-a',statusSummary:summary({sessionId:'old'})} as TerminalState;
 expect(pollTargetMatchesRun({...pane,paneId:'pane-b'},pane)).toBe(false);
 expect(pollTargetMatchesRun({...pane,statusSummary:summary({sessionId:'new'})},pane)).toBe(false);
});

test('an unfinished saved task list does not prove the agent is working',()=>{
 const fallback={...summary(),provider:'codex' as const,confidence:'high' as const};
 const result=summaryFromSidecar({provider:'codex',updatedAt:50,todos:[{content:'Fixture task',status:'in_progress'}]},fallback);
 expect(result.status).toBe('unavailable');expect(result.confidence).toBe('low');
});

test('Node and desktop readers use the same lifecycle and completion contract',()=>{
 for(const sidecar of [
  {updatedAt:50,todos:[{content:'Fixture task',status:'in_progress'}]},
  {source:'codex-narration',turn:'idle',updatedAt:60,sessionId:'s'},
  {turn:'waiting',turnReason:'permission_request',updatedAt:70,sessionId:'s'},
 ]) {
  const browser=summaryFromSidecar(sidecar as Parameters<typeof summaryFromSidecar>[0],{...summary(),provider:'codex',confidence:'high'});
  const node=nodeSidecarSummary(sidecar,{provider:'codex',cwd:'/fixture'});
  for(const field of ['status','confidence','sessionId','completedAt','waitingReason'] as const) expect(node[field]).toBe(browser[field]);
 }
});
