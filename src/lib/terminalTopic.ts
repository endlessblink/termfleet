import type {TerminalState} from './types';
import {isDeclaredOnlyPane,presentPaneGoal} from './paneContextPresentation';
import {isSupervisedMetaProcessTask,qualityCheckUserAskLabel} from './terminalHeaderQuality';

export interface TerminalTopic {text:string; fullText:string; source:string; inferred:boolean; stale:boolean; updatedAt?:number; canAuthorize:false;}
function compactTopic(value:string) {
  const clean=value.replace(/\s+/g,' ').trim();
  if(!clean || !qualityCheckUserAskLabel(clean,{maxLength:2000}).ok || isSupervisedMetaProcessTask(clean) ||
      /\b(?:handoff from|read .*handoff|continue exactly|mcp__|TaskCreate|TaskUpdate)\b/i.test(clean) ||
      /^(?:working|running|idle|claude|codex|opencode|terminal|helper|ready|using|could not find the program)\b/i.test(clean)) return undefined;
  const purpose=clean.replace(/^(?:this session is about|we['’]re|i['’]m|please|can you|could you|i (?:want|need) (?:you )?to|lets?|let['’]s)\s+/i,'');
  // Prefer the actual action clause when a long request has a conversational lead-in.
  const action=purpose.match(/\b(?:fix(?:ing)?|redesign(?:ing)?|build(?:ing)?|convert(?:ing)?|improv(?:ing)?|repair(?:ing)?|creat(?:ing)?|add(?:ing)?|restor(?:ing)?|ensur(?:ing)?)\b[^.!?]*/i)?.[0] ?? purpose;
  let words=action.split(/\s+/).map(word=>word.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu,'')).filter(Boolean);
  if(words.length>5) words=words.filter(word=>!/^(?:the|a|an|that|will|have)$/i.test(word));
  while(words.length && /^(?:the|a|an|to|that)$/i.test(words[0]))words.shift();
  const short=words.slice(0,5);
  while(short.length && /^(?:the|a|an|to|that|and|or|for|with|in|of|into|from|between)$/i.test(short[short.length-1]))short.pop();
  return short.length ? short.join(' ') : undefined;
}

/** A small, deterministic pane topic. No screen/tool/Now input and no model call. */
export function existingTerminalTopicLabel(title?:string,workspace?:string) {
  const text=title?.trim();
  return text && text!==workspace && text.split(/\s+/).length<=5 && compactTopic(text) ? text : undefined;
}

export function terminalTopic(input:{terminal?:TerminalState; manualTitle?:string; savedTitle?:string; capturedGoal?:string; now?:number}):TerminalTopic {
  const now=input.now??Date.now();
  if(input.manualTitle?.trim()) {
    const fullText=input.manualTitle.trim();
    return {text:fullText.split(/\s+/).slice(0,5).join(' '),fullText,source:'operator-label',inferred:false,stale:false,canAuthorize:false};
  }
  // TF-091: an agent pane's topic is its declared Goal, never a guess or an old tab title.
  const agentPane=input.terminal;
  if(isDeclaredOnlyPane(agentPane?.statusSummary)) {
    const goal=presentPaneGoal({manualAsk:agentPane?.mainUserAsk,summary:agentPane?.statusSummary,
      sessionId:agentPane?.providerSessionId,runId:agentPane?.activeRunId,now});
    return goal.text
      ? {text:goal.text,fullText:goal.text,source:goal.source,inferred:false,stale:goal.stale,updatedAt:goal.updatedAt,canAuthorize:false}
      : {text:'No goal yet',fullText:'The agent has not stated a goal yet',source:'missing',inferred:false,stale:true,canAuthorize:false};
  }
  if(input.savedTitle?.trim()) {
    const fullText=input.savedTitle.trim();
    return {text:fullText,fullText,source:'saved-label',inferred:false,stale:false,canAuthorize:false};
  }
  const p=input.terminal;
  const summary=p?.statusSummary && (!p.providerSessionId || !p.statusSummary.sessionId || p.providerSessionId===p.statusSummary.sessionId) ? p.statusSummary : undefined;
  const goal=presentPaneGoal({manualAsk:p?.mainUserAsk,capturedGoal:input.capturedGoal,
    summary:p?.statusSummary,taskLine:p?.taskLine,sessionId:p?.providerSessionId,runId:p?.activeRunId,now});
  const candidates=[{value:goal.text,source:goal.source,at:goal.updatedAt},
    {value:summary?.mainTaskSource ? summary.mainTask : undefined,source:summary?.mainTaskSource??'captured-goal',at:summary?.updatedAt},
    {value:p?.taskLine && (!p.taskLine.expiresAt || p.taskLine.expiresAt>now) ? p.taskLine.text : undefined,source:p?.taskLine?.source??'task-line',at:p?.taskLine?.capturedAt}];
  for(const c of candidates) {
    // Rejected handoff/process chatter is never rescued by shortening it first.
    const text=c.value && compactTopic(c.value);
    if(text)return {text,fullText:c.value!,source:c.source,inferred:true,updatedAt:c.at,
      stale:!c.at || c.at>now || now-c.at>120_000,canAuthorize:false};
  }
  return {text:'Topic not yet known',fullText:'No usable pane-owned goal or task has been captured',source:'missing',inferred:false,stale:true,canAuthorize:false};
}

export const terminalTopicDetails = (topic:TerminalTopic) =>
  `${topic.inferred?'Inferred topic':topic.source==='operator-label'?'Your label':topic.source==='saved-label'?'Saved label':'Topic unknown'} · ${topic.source}${topic.stale?' · Earlier context':''}${topic.updatedAt?` · ${new Date(topic.updatedAt).toLocaleString()}`:' · Source time unknown'}\n${topic.fullText}`;
