import {expect,test} from '@playwright/test';
import {terminalScreenAttention} from '../src/lib/operatorQuestionState';
import {paneBadgeAttention} from '../src/lib/sessionStatus';

const screen = 'Calling lean-ctx · 28s…\n✻ Reticulating… (5m 28s · ↓ 12.2k tokens)\n❯\n[OMC] | thinking | session:3m | ctx:14% | Sonnet 5.5';
test('the reported Claude auto-mode spinner overrides the older Idle report',()=>{
  expect(terminalScreenAttention(screen)).toBe('running');
  expect(paneBadgeAttention({statusSummary:{status:'idle',updatedAt:100},terminalVisibleText:screen,terminalVisibleTextUpdatedAt:200},undefined,300)).toBe('running');
});
test('a spinner captured before a newer report cannot claim current work',()=>{
  expect(paneBadgeAttention({statusSummary:{status:'idle',updatedAt:300},terminalVisibleText:screen,terminalVisibleTextUpdatedAt:200},undefined,300)).toBe('idle');
});
test('Claude completion below a spinner wins, regardless of its rotating verb',()=>{
  expect(terminalScreenAttention(screen+'\n✻ Churned for 36s · done 20:42 · 1 shell still running\n❯')).toBe('idle');
});
test('ordinary text and the persistent thinking status bar are not work evidence',()=>{
  expect(terminalScreenAttention('Reticulating… (5m 28s)\n[OMC] | thinking | session:3m')).toBeNull();
  expect(terminalScreenAttention('✻ I am explaining… (5m 28s)')).toBeNull();
});

test('rotating provider chrome generalizes beyond the reported verb',()=>{
  for(const verb of ['Pondering','Frolicking','Sussing','Reticulating'])expect(terminalScreenAttention(`✻ ${verb}… (9s · ↓ 390 tokens)`)).toBe('running');
  expect(terminalScreenAttention('• Working (9s • esc to interrupt)')).toBe('running');
});
test('only fresh same-pane same-conversation live-bottom evidence can override a report',()=>{
  const at=1_000_000;
  const t={id:'pty-a',providerSessionId:'chat-a',activeRunId:'run-a',terminalVisibleTextPaneId:'pty-a',terminalVisibleTextSessionId:'chat-a',terminalVisibleTextRunId:'run-a',terminalVisibleTextDisplayOffset:0,statusSummary:{status:'idle',updatedAt:at-100},terminalVisibleText:screen,terminalVisibleTextUpdatedAt:at};
  expect(paneBadgeAttention(t,undefined,at)).toBe('running');
  for(const extra of [{terminalVisibleTextUpdatedAt:at-130_000},{terminalVisibleTextUpdatedAt:at+1},{terminalVisibleTextUpdatedAt:undefined},{terminalVisibleTextPaneId:'pty-b'},{terminalVisibleTextSessionId:'chat-b'},{terminalVisibleTextRunId:'run-b'},{terminalVisibleTextDisplayOffset:10},{runClosed:true}])expect(paneBadgeAttention({...t,...extra},undefined,at),JSON.stringify(extra)).toBe('idle');
});
test('quoted historical spinner chrome is not live work',()=>{
  for(const value of [screen.split('\n').map(line=>`> ${line}`).join('\n'),`\`\`\`text\n${screen}\n\`\`\``,`User quoted: ✻ Reticulating… (5m 28s)`])expect(terminalScreenAttention(value)).toBeNull();
});
