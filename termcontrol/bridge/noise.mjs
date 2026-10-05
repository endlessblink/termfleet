/**
 * Agent transcripts carry a lot of machinery addressed to the model, not
 * written by the operator: interruption markers, injected reminders, harness
 * preambles, tool-result dumps. Showing those as "you" is worse than showing
 * nothing, so they are dropped from the phone feed.
 */
const WRAPPED = [
  'turn_aborted', 'system-reminder', 'user_instructions', 'environment_context',
  'command-name', 'command-message', 'local-command-stdout', 'task-notification',
  'user-prompt-submit-hook', 'function_results', 'untrusted',
  'model_switch', 'collaboration_mode', 'multi_agent_mode', 'apps_instructions',
  'plugins_instructions', 'cross-session-message',
];

const PREFIXES = [
  'caveat: the messages below',
  '[request interrupted',
  'this session is being continued from',
  'the following is the codex agent history',
  'the user sent a new message while you were working',
  'hookspecificoutput:',
  // Another agent messaging this one is not the operator speaking.
  'another claude session sent a message',
  'you are `/root`, the primary agent in a team of agents collaborating to fulfill the user\'s goals.',
  '# agents.md instructions for ',
];

export function isNoise(text) {
  const s = String(text || '').trim();
  if (!s) return true;

  for (const tag of WRAPPED) {
    if (s.startsWith(`<${tag}`)) return true;
  }
  const lower = s.toLowerCase();
  if (/^Base directory for this skill:\s*\/[^\n]+\/(?:\.claude|\.agents|\.codex)\/skills\//i.test(s)) return true;
  for (const p of PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  return false;
}

/** Strip injected blocks that trail a genuine operator message. */
export function clean(text) {
  let s = String(text || '');
  if (/^\s*\[\[\s*["']?\$PLAN_RUNNER[\s\S]*?\]:\s*PLAN GATE:/i.test(s)) {
    const count=s.match(/PLAN GATE:\s*(\d+)\s+open thread/i)?.[1];
    return `Planning check blocked: ${count?`${count} open items`:'open items'} still need review. Technical details are available in Screen.`;
  }
  // Preserve literal examples; mechanical envelopes are filtered only outside code.
  s=s.split(/(```[\s\S]*?```)/g).map((part,index)=>{
    if(index%2)return part;
    let value=part.split(/(?:^|\n)\s*<!--\s*FD-DAY-V1\b/i,1)[0];
    value=value.split(/(?:^|\n)\s*Base directory for this skill:\s*\/[^\n]+\/(?:\.claude|\.agents|\.codex)\/skills\//i,1)[0];
    value=value.replace(/<\/?pasted_content\b[^>]*>/gi,'');
    for(const tag of WRAPPED){
      value=value.replace(new RegExp(`(^|\\n)\\s*<${tag}[\\s\\S]*?</${tag}>`,'gi'),'');
      value=value.replace(new RegExp(`(^|\\n)\\s*<${tag}[\\s\\S]*$`,'i'),'');
    }
    return value;
  }).join('');
  return s.trim();
}

/** Explicit transcript metadata and known loader/hook envelopes stay inspectable. */
export function technicalContext(raw,{meta=false}={}){
 const text=String(raw || '').trim();if(!text || clean(text).startsWith('Planning check blocked:'))return null;
 const actionable=text.match(/^(?:Error:|Warning:|Permission required|Approval required|Action required)[^\n]*/i);if(meta && actionable)return {kind:'notice',text:actionable[0],details:text,technical:false};
 const known=/^(?:Base directory for this skill:\s*\/[^\n]+\/(?:\.claude|\.agents|\.codex)\/skills\/|HookSpecificOutput:|<user-prompt-submit-hook\b|<environment_context\b|<system-reminder\b)/i.test(text);
 return meta || known?{kind:'notice',text:'Technical context',details:text,technical:true}:null;
}
