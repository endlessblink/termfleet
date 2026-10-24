import { multiSelectState } from './send.mjs';
import { questionLinks } from './question-view.mjs';
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
    // Claude's own record says a permission prompt is on screen. The hooks can
    // miss it (a queued message rewrote the record as "working"), and then the
    // phone said "Needs you" with nothing to answer (2026-10-20).
    const vendor = pane.vendorStatus;
    if (vendor?.status === 'waiting' && /permission/i.test(vendor.waitingFor || '')) {
      const shown = screenPromptAsk(pane, screen);
      if (shown) return shown;
      const tool = pendingToolFromTranscript(pane);
      // A question tool raises a permission event before its question is drawn; its own card follows.
      if (tool?.name === 'AskUserQuestion') return null;
      // Hook prompts offer only Yes / No; "don't ask again" would press No there.
      return permissionAsk(pane, {
        options: [{ key: 'yes', label: 'Yes, proceed' }, { key: 'no', label: 'No, tell the agent what to do differently' }],
        title: !tool ? 'This agent is asking permission to continue.' : tool.name === 'Bash' ? 'Allow this command?' : `Allow ${tool.name}?`,
        ...(tool?.detail ? { detail: tool.detail } : {}),
        ...(vendor.at ? { sourceId: `vendor:${vendor.at}` } : {}),
      });
    }
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
    // Show WHAT is asked, never only that something is (Noam 2026-10-24: "if it asks something it
    // needs to be visible and not a message about that"): the menu drawn on screen, else the tool
    // call waiting for its answer, else the bottom of the terminal.
    const shown = screenPromptAsk(pane, screen);
    if (shown) return shown;
    const tool = pane.provider === 'claude' ? pendingToolFromTranscript(pane) : null;
    // Claude raises a permission event for its own question tool too, a moment before the
    // question is drawn (2026-10-24: an empty "asking permission" card, then the real question).
    if (tool?.name === 'AskUserQuestion') return null;
    const tail = tool ? '' : screenTail(screen);
    return permissionAsk(pane, {
      title: !tool ? 'This agent is asking permission to continue.' : tool.name === 'Bash' ? 'Allow this command?' : `Allow ${tool.name}?`,
      ...(tool?.detail ? { detail: tool.detail } : tail ? { detail: tail } : {}),
      // Tied to the tool call, so the card's id does not change with every status update.
      ...(tool?.id ? { sourceId: `tool:${tool.id}` } : {}),
    });
  }
  return null;
}

/**
 * Which question of a several-question prompt the terminal shows now. Its earlier
 * questions stay on screen above, and the raw screen copy can drop letters, so the
 * terminal's own tab bar ("☒ Tools  ☐ Days") decides first: the question drawn below the
 * last bar, else the first tab not yet answered. Otherwise the latest title on screen.
 */
export function currentQuestion(questions, screen = '') {
  const text = String(screen || ''), squash = (value) => String(value || '').replace(/[\u2500-\u257f\s]+/g, '');
  if (questions.length > 1) {
    const bar = [...text.matchAll(/^.*[☐☒].*$/gm)].at(-1);
    if (bar) {
      const below = squash(text.slice(bar.index));
      const drawn = questions.find((item) => item.question && below.includes(squash(item.question)));
      if (drawn) return drawn;
      const open = [...bar[0].matchAll(/([☐☒])\s*([^☐☒✔→←]+)/g)].find((cell) => cell[1] === '☐')?.[2].trim();
      const byTab = open && questions.find((item) => { const h = String(item.header || '').trim(); return h && (h === open || open.startsWith(h) || h.startsWith(open)); });
      if (byTab) return byTab;
    }
  }
  const flat = squash(text);
  let best = null, at = -1;
  for (const item of questions) { const i = item.question ? flat.lastIndexOf(squash(item.question)) : -1; if (i > at) { at = i; best = item; } }
  return best || questions[0];
}

/** Every question of a several-question prompt, so a card shows the whole prompt up front. */
export function questionList(questions) {
  return (questions || []).slice(0, 8).map((q) => ({
    title: String(q.question || '').slice(0, 400), header: String(q.header || '').slice(0, 40), multiSelect: Boolean(q.multiSelect),
    options: (q.options || []).slice(0, 9).map((o) => ({ label: String(o.label || '').slice(0, 160), detail: String(o.description || '').slice(0, 600) })),
  }));
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
    options: [
      { key: 'yes', label: 'Yes, proceed' },
      { key: 'yesAlways', label: "Yes, and don't ask again" },
      { key: 'no', label: 'No, tell the agent what to do differently' },
    ],
    ...details,
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
  if (!match || !/\b(?:1\.\s*)?Allow\b/i.test(text) || !/\bCancel\b/i.test(text)) return screenPromptAsk(pane, text);
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

/**
 * Any numbered prompt drawn at the bottom of the terminal, such as a hook asking
 * "Do you want to proceed? 1. Yes 2. No" with its reason above it (Noam
 * 2026-10-20: the phone said "Needs you" but showed nothing to approve). The
 * buttons are exactly the numbered choices on screen, and an answer is that
 * digit, as if pressed at the PC. Only the last open menu counts, and only
 * when the terminal's own "Esc to cancel" footer is below it.
 */
export function screenPromptAsk(pane, screen) {
  const lines = String(screen || '').split('\n').map((line) => line.replace(/[│┃]/g, ' ').replace(/\s+$/, ''));
  // The footer must be the last thing on screen: anything printed below it means
  // the menu was answered and the program moved on.
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  if (end < 0 || !/Esc to cancel/i.test(lines[end])) return null;
  const OPTION = /^\s*(?:[❯›>]\s*)?([1-9])\.\s+(\S.*)$/;
  let i = end - 1;
  while (i >= 0 && !lines[i].trim()) i--;
  const options = [];
  while (i >= 0 && OPTION.test(lines[i])) { const [, key, label] = lines[i].match(OPTION); options.unshift({ key, label: label.trim().slice(0, 80) }); i--; }
  if (options.length < 2 || options.some((o, n) => o.key !== String(n + 1))) return null;
  while (i >= 0 && !lines[i].trim()) i--;
  const title = lines[i]?.trim();
  if (!title || !/\?$/.test(title)) return null;
  const reason = [];
  for (let j = i - 1; j >= 0 && reason.length < 4; j--) {
    const line = lines[j].trim();
    if (/^[\s─━╌┄╍┈┉═\-]{6,}$/.test(line)) break;
    // "Hook PreToolUse:Bash requires confirmation…" is plumbing; the hook's own reason below it is the plain part.
    if (line && !/^Hook \S+ requires confirmation\b/i.test(line)) reason.unshift(line);
  }
  const detail = reason.join(' ').replace(/\[settings\]/g, '').replace(/\s*settings\.json to update hooks\s*$/i, '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const ask = {
    kind: 'permission', screenChoice: true, title: title.slice(0, 200), ...(detail ? { detail } : {}),
    sourceId: `prompt:${title}:${options.map((o) => o.label).join('|')}:${detail}`,
    options,
  };
  return { ...ask, id: askId(pane, ask) };
}

/** The last few lines the terminal shows, as plain text: what a prompt with no record says. */
export function screenTail(screen, max = 6) {
  const lines = String(screen || '').split('\n').map((l) => l.replace(/[│┃╭╮╰╯─━]/g, ' ').replace(/\s+/g, ' ').trim()).filter((l) => l && !/^[>❯›]?$/.test(l));
  return lines.slice(-max).join('\n').slice(0, 400);
}

function pendingToolFromTranscript(pane) {
  const file = claudeTranscript(pane.cwd, pane.sessionId);
  return file ? pendingToolFromRecords(tailLines(file, 256 * 1024)) : null;
}

/** The newest tool call with no result yet: what a permission prompt is asking about. */
export function pendingToolFromRecords(lines) {
  const answered = new Set();
  for (let i = lines.length - 1; i >= 0; i--) {
    let o;
    try { o = JSON.parse(lines[i]); } catch { continue; }
    const msg = o.message;
    if (!msg || o.isSidechain) continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    if (msg.role === 'user') {
      for (const b of blocks) if (b.type === 'tool_result' && b.tool_use_id) answered.add(b.tool_use_id);
      continue;
    }
    if (msg.role !== 'assistant') continue;
    for (const b of [...blocks].reverse()) {
      if (b.type !== 'tool_use') continue;
      if (answered.has(b.id)) return null;
      const input = b.input || {};
      const detail = input.description || input.command || input.file_path || input.url || '';
      return { id: b.id ? String(b.id) : null, name: String(b.name || 'this tool'), detail: String(detail).replace(/\s+/g, ' ').trim().slice(0, 200) };
    }
  }
  return null;
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
      const q = currentQuestion(questions, screen);
      if (!q) continue;
      const options = (q.options || []).slice(0, 4).map((opt, index) => ({
        key: String(index + 1),
        label: String(opt.label || '').slice(0, 160),
        detail: String(opt.description || '').slice(0, 600),
      }));

      const picked = q.multiSelect ? multiSelectState(screen, options.length) : null;
      const ask = {
        kind: 'question',
        sourceId: b.id,
        ...(picked ? { checked: picked.checked, customText: picked.customText } : {}),
        questionIndex: questions.indexOf(q), questionCount: questions.length, multiSelect: Boolean(q.multiSelect),
        title: String(q.question || 'The agent is asking you something.').slice(0, 400),
        header: String(q.header || '').slice(0, 40),
        options,
        ...(questions.length > 1 ? { questions: questionList(questions) } : {}),
      };
      // Links in the question or its answers open from the card (Noam 2026-10-24: "שתמיד יהיה לינק עם אופציות").
      const links = questionLinks(q.question, q.options || []);
      return { ...ask, id: askId(pane, ask), ...(links.length ? { links } : {}) };
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
