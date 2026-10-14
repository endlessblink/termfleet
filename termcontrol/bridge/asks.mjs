import { multiSelectState } from './send.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { claudeTranscript } from './paths.mjs';
import { tailLines } from './tail.mjs';
import {
  pendingApproval as codexPendingApproval,
  pendingQuestion as codexPendingQuestion,
  transcriptPath as codexTranscriptPath,
} from './adapters/codex.mjs';

/**
 * What an agent is waiting for you to answer, if anything.
 *
 * Two shapes exist. A model question is in the provider transcript with its
 * own options. A permission request ("may I run this
 * command?") is not — it is drawn on screen only — but the status hooks record
 * that the pane is waiting and why, so we can still offer the standard
 * answers.
 */
export function pendingAsk(pane, {
  screen = '',
  codexApproval = codexPendingApproval,
  codexQuestion = codexPendingQuestion,
  codexTranscript = codexTranscriptPath,
} = {}) {
  if (pane.provider === 'codex') {
    const approval = codexApproval(pane);
    if (approval) return permissionAsk(pane, approval);
    const question = codexQuestion(pane, { screen });
    if (question) return { ...question, id: askId(pane, question) };
    // Once a rollout exists it is the authority: an unmatched call is pending,
    // and a matching output means it is finished. Status sidecars can lag behind
    // and must not resurrect that completed permission on the phone.
    if (codexTranscript(pane)) return null;
  }
  if (pane.provider === 'claude') {
    const question = questionFromTranscript(pane, screen);
    if (question) return question;
  }
  if (pane.provider === 'opencode') {
    // OpenCode's status plugin publishes `turn: "waiting"` only for a permission
    // request, so its sidecar is the authority — there is no separate reason
    // string to cross-check and no permission ledger to re-read. A pane that is
    // not waiting is not asking, so nothing is offered.
    if (String(pane.turn || '').toLowerCase() !== 'waiting') return null;
    return permissionAsk(pane, {
      title: 'This agent is asking permission to continue.',
      detail: pane.task || undefined,
    });
  }
  const explicitPermission = new Set([
    'permission_prompt',
    'permission_request',
    'approval_request',
    'approval-requested',
  ]).has(String(pane.turnReason || '').toLowerCase());
  if (pane.turn === 'waiting' && explicitPermission) {
    return permissionAsk(pane, { title: 'This agent is asking permission to continue.' });
  }
  return null;
}

function askId(pane, ask) {
  const source = ask.sourceId ? [ask.sourceId, ask.questionIndex ?? ''] : [pane.updatedAt, pane.turnReason];
  return [pane.provider, pane.sessionId, ...source, ask.kind, ask.title]
    .map((value) => String(value || ''))
    .join(':');
}

function permissionAsk(pane, details) {
  const ask = {
    kind: 'permission',
    ...details,
    options: [
      { key: 'yes', label: 'Yes, proceed' },
      { key: 'yesAlways', label: "Yes, and don't ask again" },
      { key: 'no', label: 'No, tell the agent what to do differently' },
    ],
  };
  return { ...ask, id: askId(pane, ask) };
}

export function matchesCurrentAsk(pane, id, choice) {
  const ask = pendingAsk(pane);
  return matchesAsk(ask, id, choice);
}

export function matchesAsk(ask, id, choice) {
  return Boolean(ask && ask.id === id && ask.options.some((option) => option.key === String(choice)));
}

/**
 * Some provider approvals are rendered by the terminal UI and never reach the
 * rollout transcript or status hook. Keep an explicit, narrow detector for
 * that screen so the phone can show the same choices the operator sees.
 */
export function screenPermissionAsk(pane, screen) {
  const text = String(screen || '');
  const match = text.match(/Allow the (.+?) server to run tool ["']([^"']+)["']\?/i);
  if (!match || !/\b(?:1\.\s*)?Allow\b/i.test(text) || !/\bCancel\b/i.test(text)) return null;
  const ask = {
    kind: 'permission',
    title: `Allow ${match[2]}?`,
    detail: `${match[1]} server is requesting this tool approval.`,
    sourceId: `screen:${match[2]}`,
    options: [
      { key: '1', label: 'Allow' },
      { key: '2', label: 'Allow for this session' },
      { key: '3', label: 'Always allow' },
      { key: '4', label: 'Cancel' },
    ],
  };
  return { ...ask, id: askId(pane, ask) };
}

function questionFromTranscript(pane, screen = '') {
  const file = claudeTranscript(pane.cwd, pane.sessionId);
  if (!file) return null;

  return questionFromRecords(pane, tailLines(file, 256 * 1024), screen);
}

export function questionFromRecords(pane, lines, screen = '') {
  const answered = new Set();

  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const msg = o.message;
    if (!msg) continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];

    if (msg.role === 'user') {
      for (const b of blocks) if (b.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id);
      continue;
    }

    if (msg.role !== 'assistant') continue;
    for (const b of blocks) {
      if (b.type !== 'tool_use' || b.name !== 'AskUserQuestion') continue;
      if (answered.has(b.id)) return null;          // already answered

      const questions = b.input?.questions || [];
      // Claude advances each ordinary choice immediately, then renders a
      // separate final review for a multi-question request. Do not revive Q1
      // merely because its title is also printed in that review.
      if(questions.length>1 && /(?:^|\n)\s*Review your answers\s*(?:\n|$)/.test(screen) && /Ready to submit your answers\?/.test(screen) && /Submit answers/.test(screen)){
        const reviewAnswers=[];
        for(let index=0;index<questions.length;index++){
          const q=questions[index],start=screen.indexOf(q.question);
          const end=index+1<questions.length?screen.indexOf(questions[index+1].question,start+q.question.length):screen.indexOf('Ready to submit your answers?',start);
          const segment=start<0?'':screen.slice(start,end<0?undefined:end);
          const answer=segment.match(/(?:^|\n)\s*→\s*([^\n]+)/)?.[1]?.trim();
          if(answer)reviewAnswers.push({question:q.question,answer});
        }
        const ask={kind:'question',stage:'review',sourceId:b.id,questionIndex:questions.length,questionCount:questions.length,title:'Review your answers',header:'Review answers',reviewAnswers,options:/You have not answered all questions/.test(screen)?[]:[{key:'submit',label:'Submit answers',detail:'Confirm these answers and let the agent continue'}]};
        return {...ask,id:askId(pane,ask)};
      }
      const q = questions.find((item) => item.question && String(screen).includes(item.question)) || questions[0];
      if (!q) continue;
      const options = (q.options || []).slice(0, 4).map((opt, index) => ({
        key: String(index + 1),
        label: String(opt.label || '').slice(0, 60),
        detail: String(opt.description || '').slice(0, 140),
      }));

      const picked = q.multiSelect ? multiSelectState(screen, options.length) : null;
      const ask = {
        kind: 'question',
        sourceId: b.id,
        ...(picked ? { checked: picked.checked, customText: picked.customText } : {}),
        questionIndex: questions.indexOf(q), questionCount: questions.length, multiSelect: Boolean(q.multiSelect),
        title: String(q.question || 'The agent is asking you something.').slice(0, 200),
        header: String(q.header || '').slice(0, 40),
        options,
      };
      return { ...ask, id: askId(pane, ask) };
    }
  }
  return null;
}

// Tool-result records are the destination's acknowledgment. A key-write ack
// alone is never proof that the agent received an answer.
export function questionResultsFromRecords(lines) {
  const results=[];
  for (const line of lines) {
    let record; try {record=typeof line==='string'?JSON.parse(line):line;} catch {continue;}
    if (record.message?.role !== 'user') continue;
    for (const block of Array.isArray(record.message.content)?record.message.content:[]) {
      if(block.type!=='tool_result' || !block.tool_use_id) continue;
      const text=typeof block.content==='string'?block.content:JSON.stringify(block.content);
      if(!/answered your questions|User declined to answer|"answers"\s*:/.test(text || '')) continue;
      let answers=[];
      try {const data=JSON.parse(text);if(data.answers && typeof data.answers==='object')answers=Object.values(data.answers).filter(value=>typeof value==='string');} catch {}
      results.push({sourceId:block.tool_use_id,declined:/User declined to answer/.test(text),text,answers});
    }
  }
  return results.slice(-12);
}
export function questionResults(pane) {
  if(pane.provider!=='claude') return [];
  const file=claudeTranscript(pane.cwd,pane.sessionId);
  return file?questionResultsFromRecords(tailLines(file,256*1024)):[];
}
