import {expect,test} from '@playwright/test';
import {terminalTopic,existingTerminalTopicLabel} from '../src/lib/terminalTopic';
import type {TerminalState} from '../src/lib/types';
const now=10_000_000;
const pane=(userTask:string,extra:Partial<TerminalState>={})=>({id:'pane-a',paneId:'pane-a',providerSessionId:'chat-a',status:'reconnected',cols:80,rows:24,statusSummary:{sessionId:'chat-a',task:userTask,userTask,path:'',now:'Running a tool',status:'working',updatedAt:now},...extra} as TerminalState);
test('short concrete topics remain exact',()=>{
  for(const text of ['Fix audio sync','Redesign landing page','לתקן את סנכרון האודיו']) expect(terminalTopic({terminal:pane(text),now}).text).toBe(text);
});
test('existing saved custom labels survive without treating folder or provider names as a topic',()=>{
  expect(existingTerminalTopicLabel('Fix audio sync','checkout')).toBe('Fix audio sync');
  for(const [title,workspace] of [['checkout','checkout'],['Helper','checkout'],['Claude','checkout']])expect(existingTerminalTopicLabel(title,workspace)).toBeUndefined();
  expect(terminalTopic({terminal:pane('Redesign landing page'),savedTitle:'Fix audio sync',now})).toMatchObject({text:'Fix audio sync',source:'saved-label',canAuthorize:false});
});
test('long conversational requests become one to five grounded words',()=>{
  const topic=terminalTopic({terminal:pane('I have a repetitive task — converting old training videos into new course lessons with subtitles.'),now});
  expect(topic.text.toLocaleLowerCase()).toBe('converting old training videos');
  expect(topic.text.split(/\s+/).length).toBeLessThanOrEqual(5);expect(topic.inferred).toBe(true);expect(topic.canAuthorize).toBe(false);
});
test('the sidebar screenshot handoff and tool chatter cannot become terminal topics',()=>{
  for(const text of ['Read It is a handoff from the previous instance: continue exactly where it left off','Could not find the program','Running lean-ctx','Using mcp__lean_ctx__ctx_shell','Claude','Marking the plan task done.'])
    expect(terminalTopic({terminal:pane(text),now}).source,text).toBe('missing');
});
test('topic is stable through status, tool and Now changes',()=>{
  const original=pane('Fix audio sync');const first=terminalTopic({terminal:original,now});
  for(const status of ['working','waiting','idle','unavailable']) expect(terminalTopic({terminal:{...original,statusSummary:{...original.statusSummary!,status:status as never,now:'Marking the plan task done.'},terminalVisibleText:'Read a file'},now}).text).toBe(first.text);
});
test('explicit topic wins and preserves its full label in metadata',()=>{
  const result=terminalTopic({terminal:pane('Redesign landing page'),manualTitle:'Fix audio sync and preserve voice timing',now});
  expect(result.text).toBe('Fix audio sync and preserve');expect(result.fullText).toBe('Fix audio sync and preserve voice timing');expect(result.source).toBe('operator-label');
});
test('punctuation and mixed Hebrew English remain readable within five words',()=>{
  const result=terminalTopic({terminal:pane('לתקן סנכרון audio-video ולהוסיף כתוביות בעברית לקורס'),now});
  expect(result.text).toBe('לתקן סנכרון audio-video ולהוסיף כתוביות');expect(result.text.split(/\s+/)).toHaveLength(5);
});
test('stale topics retain provenance, while other-conversation evidence is rejected',()=>{
  const t=pane('Fix audio sync');t.statusSummary!.updatedAt=now-130000;
  expect(terminalTopic({terminal:t,now})).toMatchObject({text:'Fix audio sync',stale:true,updatedAt:now-130000});
  t.providerSessionId='chat-b';expect(terminalTopic({terminal:t,now}).source).toBe('missing');
});
