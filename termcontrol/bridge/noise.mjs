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
];

const PREFIXES = [
  'caveat: the messages below',
  '[request interrupted',
  'this session is being continued from',
  'the following is the codex agent history',
  'the user sent a new message while you were working',
];

export function isNoise(text) {
  const s = String(text || '').trim();
  if (!s) return true;

  for (const tag of WRAPPED) {
    if (s.startsWith(`<${tag}`)) return true;
  }
  const lower = s.toLowerCase();
  for (const p of PREFIXES) {
    if (lower.startsWith(p)) return true;
  }
  // A message that is nothing but XML-ish envelope.
  if (/^<[a-z][\w-]*>[\s\S]*<\/[a-z][\w-]*>$/i.test(s) && !/[.!?]\s/.test(s)) return true;
  return false;
}

/** Strip injected blocks that trail a genuine operator message. */
export function clean(text) {
  let s = String(text || '');
  for (const tag of WRAPPED) {
    s = s.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi'), '');
    s = s.replace(new RegExp(`<${tag}[\\s\\S]*$`, 'i'), '');
  }
  return s.trim();
}
