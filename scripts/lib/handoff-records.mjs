// Shared by Node hooks and the desktop freshness barrier. No filesystem or model calls.
// Provider user-role records are evidence of origin, not proof of current authorization.
export const QUESTION_INPUT_TOOLS=Object.freeze(['AskUserQuestion','request_user_input','functions.request_user_input','request_user_input_async','functions.request_user_input_async']);
function harness(text) {
  return /^\s*(?:<system-reminder>|<environment_context>|<permissions instructions>|<collaboration_mode>|<turn_aborted>|\[SYSTEM|\[Request interrupted|# AGENTS\.md instructions|The following is the Codex agent history)/.test(text);
}

function reference(value) {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return { embedded: true, encoding: 'data-url', characters: value.length, availability: 'in-source-snapshot' };
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(reference);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    key === 'data' && typeof item === 'string'
      ? { embedded: true, encoding: value.type ?? 'unknown', characters: item.length, availability: 'in-source-snapshot' }
      : reference(item)]));
}

export function conversationRecords(provider, transcript) {
  const messages = [], issues = [], excluded = [], ambiguousInputs = [];
  let previous;
  const questions = new Map(), calls = new Map();
  const questionTools = new Set(QUESTION_INPUT_TOOLS);
  const answerText = content => typeof content === 'string' ? content
    : Array.isArray(content) ? content.filter(block => ['text','input_text'].includes(block?.type)).map(block => block.text ?? '').join('\n')
    : content == null ? '' : JSON.stringify(content);
  const keepAnswer = (d, line, callId, content, error) => {
    const question = questions.get(callId);
    if (!question) {
      if(calls.has(callId)) return; // A known non-question tool result is evidence only.
      ambiguousInputs.push({id:`${provider}:${d.uuid ?? d.id ?? d.payload?.id ?? 'record'}:line-${line}:unpaired:${callId}`,
        providerEventId:d.uuid ?? d.id ?? d.payload?.id ?? null,at:d.timestamp ?? null,provider,
        actor:'provider-tool-result',kind:'unpaired-tool-result',sourceLine:line,toolCallId:callId,
        rawResult:content,recordStatus:error ? 'error':'result',originVerified:false,authorization:'none',
        ambiguity:'matching call is absent from the retained source; human/question origin is unknown'});
      issues.push({line,kind:'unpaired-tool-result',toolCallId:callId});return;
    }
    messages.push({id:`${provider}:${d.uuid ?? d.id ?? d.payload?.id ?? 'record'}:line-${line}:answer:${callId}`,
      providerEventId:d.uuid ?? d.id ?? d.payload?.id ?? null,at:d.timestamp ?? null,provider,
      actor:'provider-tool-result',kind:'question-answer',sourceLine:line,toolCallId:callId,
      questionToolName:question.name,questionSourceLine:question.sourceLine,question:question.input,
      text:answerText(content),answer:reference(content),
      attachments:Array.isArray(content) ? content.filter(block => /image|file|document|audio|video|attachment/.test(block?.type ?? '')).map(reference) : [],
      recordStatus:error ? 'error':'result',
      originVerified:false,authorization:'none'});
  };
  const lines = transcript.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    let d;
    try { d = JSON.parse(line); } catch {
      issues.push({ line: i + 1, kind: i === lines.length - 1 ? 'partial-final-record' : 'invalid-record' });
      continue;
    }
    if (provider === 'claude') {
      const blocks = d.message?.content;
      if(d.type === 'assistant' && Array.isArray(blocks))
        for(const block of blocks) if(block?.type === 'tool_use' && typeof block.id === 'string') {
          calls.set(block.id,block.name);
          if(questionTools.has(block.name)) questions.set(block.id,{name:block.name,input:reference(block.input),sourceLine:i+1});
        }
      if(d.type === 'user' && !d.isMeta && !d.isSidechain && Array.isArray(blocks))
        for(const block of blocks) if(block?.type === 'tool_result' && typeof block.tool_use_id === 'string')
          keepAnswer(d,i+1,block.tool_use_id,block.content,block.is_error);
    } else if (provider === 'codex' && d.type === 'response_item') {
      const p=d.payload;
      if(p?.type === 'function_call' && typeof p.call_id === 'string') {
        calls.set(p.call_id,p.name);
        if(questionTools.has(p.name)) questions.set(p.call_id,{name:p.name,input:reference(p.arguments),sourceLine:i+1});
      }
      if(p?.type === 'function_call_output' && typeof p.call_id === 'string')
        keepAnswer(d,i+1,p.call_id,p.output,p.is_error);
    }
    let blocks, raw, kind, at = d.timestamp, actor = 'provider-user-role';
    if (provider === 'claude') {
      const a = d.attachment;
      if (a?.type === 'queued_command' && a.origin?.kind === 'human') {
        raw = a.prompt; blocks = Array.isArray(a.content) ? a.content : Array.isArray(a.prompt) ? a.prompt : []; kind = 'queued-human'; at = a.timestamp ?? at; actor = 'human';
      } else if (d.type === 'user' && !d.isMeta && !d.isSidechain) {
        const content = d.message?.content;
        raw = typeof content === 'string' ? content : undefined;
        blocks = Array.isArray(content) ? content : []; kind = 'user';
      } else continue;
    } else if (provider === 'codex') {
      const p = d.payload;
      if (d.type === 'event_msg' && p?.type === 'user_message') {
        raw = p.message; kind = 'event-user';
        blocks = [...(p.images ?? []).map(v => ({ type: 'input_image', reference: v })),
          ...(p.local_images ?? []).map(v => ({ type: 'input_image', path: v }))];
      } else if (d.type === 'response_item' && p?.type === 'message' && p.role === 'user') {
        raw = typeof p.content === 'string' ? p.content : undefined;
        blocks = Array.isArray(p.content) ? p.content : []; kind = 'response-user';
      } else continue;
    } else return { messages: [], issues: [{kind:'unsupported-provider', provider}], excluded: [] };
    const text = typeof raw === 'string' ? raw : blocks.filter(b => ['text','input_text'].includes(b?.type)).map(b => b.text ?? '').join('\n');
    const attachments = blocks.filter(b => /image|file|document|audio|video|attachment/.test(b?.type ?? '')).map(reference);
    if (harness(text) && (d.isMeta===true || d.payload?.isMeta===true)) { excluded.push({line:i+1,kind:'metadata-marked-harness'}); continue; }
    if (!text.trim() && !attachments.length) continue;
    const event = { id: `${provider}:${d.uuid ?? d.id ?? d.payload?.id ?? "record"}:line-${i+1}`, providerEventId:d.uuid ?? d.id ?? d.payload?.id ?? null, at: at ?? null,
      provider, actor, kind, sourceLine: i+1, text, attachments,originVerified:false,authorization:'none' };
    // Deduplicate only adjacent *mirrored* Codex encodings with matching provenance.
    // Repeated human turns, including two identical yes answers, are separate events.
    if (provider === 'codex' && previous && previous.kind !== kind &&
        previous.providerEventId !== null && previous.providerEventId === event.providerEventId &&
        previous.at !== null && previous.at === event.at && previous.text === text &&
        (!previous.attachments.length || !attachments.length || JSON.stringify(previous.attachments) === JSON.stringify(attachments))) {
      if (attachments.length && !previous.attachments.length) previous.attachments = attachments;
      previous.mirroredSourceLines = [...(previous.mirroredSourceLines ?? []), i+1];
      continue;
    }
    messages.push(event); previous = event;
  }
  return {messages, issues, excluded, ambiguousInputs};
}

// A partial/unparseable record can contain a revocation; include it in freshness checks.
export function ownerCheckpoint(provider, text) {
  const result = conversationRecords(provider, text);
  return JSON.stringify({messages:result.messages, issues:result.issues,ambiguousInputs:result.ambiguousInputs});
}

// Exact captured history is a bounded observation, never human/approval authority.
export function observedSourceReady(snapshot,scope) {
 if(!scope || !snapshot || snapshot.version!==1 || snapshot.ok!==true || snapshot.complete!==true || snapshot.truncated!==false ||
   snapshot.completeOriginalHistory!==true || snapshot.completeCapturedSources!==true || snapshot.trust!=='observed' ||
   snapshot.interpretation!=='uninterpreted' || snapshot.coverage!=='existing-journal-captures-only' ||
   snapshot.directory!==scope.dir || snapshot.paneId!==scope.paneId || snapshot.provider!==scope.provider || !Array.isArray(snapshot.journals) || !snapshot.journals.length ||
   !Array.isArray(snapshot.watermarks) || snapshot.watermarks.length!==snapshot.journals.length ||
   snapshot.pendingWatermark?.paneId!==scope.paneId || snapshot.pendingWatermark?.provider!==scope.provider || snapshot.pendingWatermark?.files?.length!==0)
   return false;
 if(!snapshot.journals.some(j=>j.identity?.sessionId===scope.sessionId))return false;
 return snapshot.journals.every((j,index)=>j.ok===true&&j.complete===true&&j.truncated===false&&j.completeOriginalHistory===true&&j.completeCapturedSources===true&&
   j.provider===scope.provider&&j.identity?.paneId===scope.paneId&&Array.isArray(j.records)&&j.records.length===j.throughSeq&&
   JSON.stringify(snapshot.watermarks[index])===JSON.stringify({provider:scope.provider,identity:j.identity,journal:j.journal,throughSeq:j.throughSeq,throughBytes:j.throughBytes,sha256:j.sha256})&&
   j.records.every(record=>record.ok===true&&record.complete===true&&record.truncated===false&&record.trust==='observed'&&record.interpretation==='uninterpreted'&&
     record.provider===scope.provider&&record.identity?.paneId===scope.paneId&&record.data?.encoding==='base64'));
}
export function observedSourceCheckpoint(snapshot) {
 return JSON.stringify({watermarks:snapshot.watermarks,pendingWatermark:snapshot.pendingWatermark});
}
