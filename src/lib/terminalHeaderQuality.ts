export type HeaderQualityReason =
  | "empty"
  | "too-long"
  | "prompt-fragment"
  | "raw-thinking-prompt"
  | "command-like"
  | "implementation-detail"
  | "package-script"
  | "terminal-chrome"
  | "vague"
  | "gibberish";

export interface HeaderQualityResult {
  ok: boolean;
  reason?: HeaderQualityReason;
}

function clean(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || "";
}

function looksLikePath(text: string) {
  return (
    /(?:^|[\s"'([{])\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(
      text,
    ) ||
    /(?:^|[\s"'])~\//.test(text) ||
    /(?:^|\w)\]\(\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(
      text,
    ) ||
    /\[[^\]]{0,80}\]\(\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(
      text,
    ) ||
    /\b(?:src|tests|docs|scripts)\/[\w./-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh)\b/i.test(
      text,
    ) ||
    /\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh)\b/i.test(text)
  );
}

function looksLikeCommand(text: string) {
  return (
    /^(?:\.\/|~\/|\/|cd\b|ls\b|ll\b|pwd\b|cat\b|less\b|tail\b|head\b|sed\b|awk\b|grep\b|rg\b|find\b|printf\b|echo\b|env\b|export\b|source\b|clear\b|sleep\b|timeout\b|git\b|gh\b|npm\b|pnpm\b|yarn\b|bun\b|node\b|npx\b|tsx\b|python(?:3)?\b|uv\b|cargo\b|docker\b|ssh\b|curl\b|sudo\b|chmod\b|mkdir\b|rm\b|mv\b|cp\b|touch\b|vim\b|nvim\b|tmux\b|ps\b|kill\b|pkill\b)\b/i.test(
      text,
    ) ||
    /^Running:\s*(?:sleep|sed|tr|awk|grep|rg|npm|pnpm|yarn|node|npx|git|gh|curl|python(?:3)?|cargo)\b/i.test(
      text,
    ) ||
    /\bmcp__[a-z0-9_]+__[a-z0-9_]+\b/i.test(text) ||
    /(?:&&|\|\||\s;\s|\|\s*\w|>\s*\S|<\s*\S|`[^`]+`|\$\(|\${)/.test(text)
  );
}

// A bare slash/dollar command the user typed ("$done", "/dropoff"). It names an
// action the harness takes, never the work the agent is doing.
// The harness writes a placeholder task when the agent declared none. It names
// no work, so it is not an activity either.
function isPlaceholderActivity(text: string) {
  return /^Answering (?:latest prompt|user question)$/i.test(text);
}

function looksLikeSlashCommand(text: string) {
  return /^[$/][A-Za-z][\w:-]*$/.test(text);
}

// A line lifted out of an enumerated list the agent printed ("2. Stop public
// exposure of the link ..."). The enumerator proves it is scrollback, not a task.
function looksLikeEnumeratedFragment(text: string) {
  return /^\d+[.)]\s+\S/.test(text);
}

function looksLikePackageScript(text: string) {
  return (
    /^[\w@./-]+@\d+\.\d+\.\d+\s+[\w:-]+(?:\s|$)/i.test(text) ||
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+\b/i.test(text) ||
    /\bnpx\s+[\w@./-]+/i.test(text)
  );
}

function looksLikeTerminalStatusBar(text: string) {
  return (
    (/\bweekly\s+\d+%\s+left\b/i.test(text) &&
      /\bcontext\s+\d+%\s+used\b/i.test(text)) ||
    (/\bwk:\s*\d+%/i.test(text) && /\bctx:\s*\d+%/i.test(text)) ||
    (/\bsession:\s*\d+[smh]\b/i.test(text) && /\bctx:\s*\d+%/i.test(text))
  );
}

/**
 * The user's own voice, quoted verbatim into an activity label ("Reviewing I
 * want to do two main changes"). A leading first/second-person pronoun means the
 * label echoes the prompt rather than describing the work. An investigation
 * object ("Checking why titles are still broken") is NOT this — a question word
 * names what is being investigated.
 */
function looksLikeSpokenPrompt(text: string) {
  if (/^why\b/i.test(text) && !/[?]\s*$/.test(text)) {
    return looksLikePromptFragment(text.replace(/^why\s+/i, ""));
  }
  return (
    looksLikePromptFragment(text) || /^(?:i|we|my|our|lets?)\b/i.test(text)
  );
}

function looksLikePromptFragment(text: string) {
  return (
    /[?]\s*$/i.test(text) ||
    /^(?:and\s+)?(?:this|that|these|those|both)$/i.test(text) ||
    /^and\s+\w+(?:\s+\w+){0,4}$/i.test(text) ||
    /^make sure\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+(?:you|your|you're|you are)\b/i.test(
      text,
    ) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+implement this\b/i.test(
      text,
    ) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+lets?\b/i.test(
      text,
    ) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+got stuck\b/i.test(
      text,
    ) ||
    /^[\s:;,-]*(?:what now|what changed|what you are trying|why|how is this|where is|can you|do you|ok so|so how|this is|it seems|its not\b|it's not\b|we still|i am|i'm|i’ll\b|i'll\b|i fixed\b|i just need\b|i need\b|i starting\b|i can\b|you keep|you may\b|you should\b|maybe you\b|your\b|you're\b|you are\b)\b/i.test(
      text,
    ) ||
    /^(?:is|are)\s+\w+(?:\s+\w+){0,3}\s+(?:practical\s+)?lanes?\b/i.test(
      text,
    ) ||
    /\banything else is just\b/i.test(text) ||
    /^what\s+does\s+belong\b/i.test(text) ||
    /^(?:the answer is|symptom)\s*:/i.test(text) ||
    /^A safe version is\b/i.test(text) ||
    /^the production inbox says\b/i.test(text) ||
    /^the real answer is\b/i.test(text) ||
    /^arrived,\s+but\b/i.test(text) ||
    /^phase should be\b/i.test(text) ||
    /\btitles are right there\b/i.test(text) ||
    /\bshould tell for both what change\b/i.test(text) ||
    /\bnot writing what I write\b/i.test(text) ||
    /\bso add it\b/i.test(text) ||
    /^(?:yes|no):\s+\b/i.test(text) ||
    /^to test it(?: yourself)?\b/i.test(text) ||
    /^what changed\b/i.test(text) ||
    /^what i did\b/i.test(text) ||
    /^what i fixed\b/i.test(text) ||
    /^the loop had\b/i.test(text) ||
    /^current verification\b/i.test(text) ||
    /^what is now covered\b/i.test(text) ||
    /^what shipped\b/i.test(text) ||
    /^the correct transition is\b/i.test(text) ||
    /^update the highest-impact places first\b/i.test(text) ||
    /^I left the updated continuous watchdog\b/i.test(text) ||
    /^[\s:;,-]*I (?:re-read|updated|deployed|checked|changed|added|can handle)\b/i.test(
      text,
    ) ||
    /^[\s:;,-]*I(?:’|')ll\b/i.test(text) ||
    /^Cleaned and landed safely\b/i.test(text) ||
    /^Still in Plan Mode\b/i.test(text) ||
    /^You(?:['’]re| are) now testing\b/i.test(text) ||
    /^Confidence Rating\b/i.test(text) ||
    /^Right\s*[—-]\s+/i.test(text) ||
    /^treat it as\b/i.test(text) ||
    /^Task\s+\d+\s*[—-]/i.test(text) ||
    /^the fix\b/i.test(text) ||
    /^The durable code fix\b/i.test(text) ||
    /^The failure path was\b/i.test(text) ||
    /^Added to create\b/i.test(text) ||
    /^There(?:'|’)?s an existing\b/i.test(text) ||
    /^Root cause\b/i.test(text) ||
    /^Use this as\b/i.test(text) ||
    /^Strong evidence\b/i.test(text) ||
    /^You can test\b/i.test(text) ||
    /\b(?:Noneoofhtheiabove|separatOptionally)\b/i.test(text) ||
    /^(?:this failure is clear|this is a failure|failed here|again fail|low quality)\b/i.test(
      text,
    ) ||
    /^(?:the bad part was|the mistake was|it wasn'?t followed because)\b/i.test(
      text,
    ) ||
    /^(?:md|markdown)\)?\s+it covers\b/i.test(text) ||
    /\b(?:is too vague because|says nothing about|wrong project|approval is based on)\b/i.test(
      text,
    ) ||
    /\b(?:guidelines|documentation|docs|article|source|report|study|research)\s+(?:say|says|show|shows|recommend|recommends)\b/i.test(
      text,
    ) ||
    /\b(?:dont|doesnt|isnt|havent|ahve|querstions|apth|relatd|udpated|descriptuin)\b/i.test(
      text,
    )
  );
}

// Pasted source code (a JS snippet once became a pane's Task row). Requires BOTH a
// code keyword AND code punctuation so prose like "Update the const declaration"
// stays accepted.
function looksLikeCode(text: string) {
  return (
    /\b(?:const|let|var|function|return|import|export|await)\b|=>/.test(text) &&
    /(?:=>|[{};]|\)\s*\{|\w\()/.test(text)
  );
}

function looksGibberish(text: string) {
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length < 5) return false;
  const vowels = (letters.match(/[aeiou]/gi) ?? []).length;
  if (letters.length >= 8 && vowels / letters.length < 0.18) return true;
  return (
    /\b[a-z]{7,}\b/i.test(text) &&
    /\b(?:fgh|dfg|asdf|sdf|ghd|qwe|zx)\w*\b/i.test(text)
  );
}

function looksLikeGenericResult(text: string) {
  if (/^Frontend build (?:passed|failed)$/i.test(text)) {
    return true;
  }
  if (/^Task Complete\b/i.test(text)) {
    return true;
  }
  if (/^Tests\/build\/deploy\s*:/i.test(text)) {
    return true;
  }
  if (/^Charged\b/i.test(text)) {
    return true;
  }
  if (/^Files shipped\b/i.test(text)) {
    return true;
  }
  if (/^Confidence is (?:HIGH|MEDIUM|LOW)\b/i.test(text)) {
    return true;
  }
  if (
    /^(?:(?:Thinking about|Working on)\s+)?Raise quality across the current work$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^Verify\s+(?:Build(?: and tests)?|Tests?|Test process|Build process|Typecheck(?: and pytest)?|update project plan|Task)\s+result$/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^Task to\s+.+\s+(?:completed|passed|successful|completed successfully)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(?:Build(?: and tests)?|Tests?|Test process|Build process|Task|Verification check)\s+(?:completed|passed|successful|completed successfully)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  if (/^Test suite failed$/i.test(text)) {
    return true;
  }
  if (/^Test suite passed$/i.test(text)) {
    return true;
  }
  if (/^test:[\w-]+\s+passed$/i.test(text)) {
    return true;
  }
  return false;
}

// Curated meta-process labels are not durable work goals. They describe the agent's
// cleanup/release choreography instead of the product or problem being changed. Keep
// this list supervised: every new pattern must come from a rejected live card and a
// regression example, never from an unconstrained rewrite heuristic.
function looksLikeMetaProcessTask(text: string) {
  return (
    /^(?:adding|applying|addressing|blocking|building|checking|covering|fixing|handling|improving|promoting|rebuilding|refreshing|re-?checking|re-?running|re-?verifying|testing|updating|verifying|writing)\b.*\b(?:task|label|wording|quality|fallback|release|deployment|card|screenshot|guard|matrix|dock)\b/i.test(
      text,
    ) ||
    /^confirming\b.*\b(?:task\s+records?|deployment\s+evidence)\b/i.test(text) ||
    /^choos(?:e|ing)\s+(?:a\s+)?useful\s+fallback\s+for\s+rejected\s+task\s+wording$/i.test(
      text,
    ) ||
    /^(?:making|improving|clarifying|fixing|rewriting|describing)\s+(?:the\s+)?(?:task|task\s+line|task\s+label|description|wording|header|title)\b/i.test(
      text,
    ) ||
    /^(?:pushing through|following|moving through)\s+(?:the\s+)?approved\s+deployment\s+path\b/i.test(
      text,
    ) ||
    /^(?:adding|updating|writing|testing|checking|improving)\s+(?:examples?|regressions?|tests?)\s+(?:to|for)\s+(?:the\s+)?(?:quality\s+guard|quality\s+matrix|task\s+labels?|acceptance\s+rules?)\b/i.test(
      text,
    ) ||
    /^(?:blocking|fixing|improving|cleaning up)\s+(?:the\s+)?(?:internal\s+)?(?:qa|quality)\s+(?:wording|labels?|descriptions?)\b/i.test(
      text,
    ) ||
    /\b(?:necessary|required|final)\s+fixes?\s+and\s+re-?verif(?:y|ying)\s+(?:the\s+)?release\b/i.test(
      text,
    ) ||
    /^(?:rebuilding|updating|fixing|improving)\s+(?:the\s+)?(?:visible\s+)?content\s+section\b/i.test(
      text,
    ) ||
    /^(?:repairing|fixing)\s+missing\s+data\s+and\s+link\s+connections$/i.test(
      text,
    )
  );
}

function lacksDecisionObject(text: string) {
  if (
    !/\b(?:operator|user|human|reviewer)?'?s?\s*(?:approval|verdict|decision|response|reply|follow-up)\b|\b(?:approval|verdict|decision)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(?:about|on|for|over|of)\s+(?:this|that|the\s+)?(?!(?:operator|user|human|reviewer|approval|verdict|decision|response|reply|follow-up)\b)[a-z0-9][a-z0-9'-]*(?:\s+[a-z0-9][a-z0-9'-]*){1,}/i.test(
      text,
    )
  ) {
    return false;
  }
  if (
    /\b(?:pane header|header wording|title wording|deployment plan|build result|test result|floor-check|quality gate|operator gate)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return true;
}

function baseQuality(
  value?: string | null,
  maxLength = 96,
): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (looksLikeTerminalStatusBar(text))
    return { ok: false, reason: "terminal-chrome" };
  if (looksLikePromptFragment(text))
    return { ok: false, reason: "prompt-fragment" };
  if (text.length > maxLength) return { ok: false, reason: "too-long" };
  if (lacksDecisionObject(text)) return { ok: false, reason: "vague" };
  if (looksLikeGenericResult(text)) return { ok: false, reason: "vague" };
  if (looksLikePackageScript(text))
    return { ok: false, reason: "package-script" };
  if (looksLikeCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePath(text))
    return { ok: false, reason: "implementation-detail" };
  if (looksGibberish(text)) return { ok: false, reason: "gibberish" };
  return { ok: true };
}

/**
 * Gate for the USER'S OWN ASK shown on the Task row. The user's words are the
 * truth of what they asked — informal phrasing, typos, or a trailing "?" must
 * not blank the row to "Task not captured" (that hid "ok so go over everything…"
 * while the agent was visibly working on it). Only structural junk is rejected:
 * pasted code, shell commands, paths, gibberish.
 */
export function qualityCheckUserAskLabel(
  value?: string | null,
  // The map card's Task row is a fixed TWO-line box; other callers keep the one-line rule.
  options: { maxLength?: number } = {},
): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (looksLikeTerminalStatusBar(text))
    return { ok: false, reason: "terminal-chrome" };
  if (text.length > (options.maxLength ?? 96))
    return { ok: false, reason: "too-long" };
  if (
    /^(?:go|done|fix it|fix this too|so fix it|ok|okay|sure|yes|continue|do it|proceed)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^(?:and\s+)?(?:this|that|these|those|both)$/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^i just need\b/i.test(text) || /\banything else is just\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (looksLikeSlashCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeEnumeratedFragment(text))
    return { ok: false, reason: "prompt-fragment" };
  // Wrap-cut fragments scraped mid-word/mid-quote (`ke "System Booted`) are not
  // an ask: unbalanced double quote, or a 1-2 letter lowercase stub opener.
  if ((text.match(/"/g) ?? []).length % 2 === 1)
    return { ok: false, reason: "prompt-fragment" };
  // Composer placeholder suggestions are UI chrome, never the user's ask.
  if (/@filename\b|@filepath\b/i.test(text))
    return { ok: false, reason: "prompt-fragment" };
  if (
    /^(?:find and fix a bug in|write tests for|summarize recent commits|use \/\w+ to|improve documentation in|explain this codebase)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (
    /^[a-z]{1,2}\s/.test(text) &&
    !/^(?:i|we|is|it|do|go|if|he|at|on|in|to|my|no|ok|so|up|us|be|by|or|an|as|am)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // A goal SENTENCE may mention a command ("Build the project using npm run
  // build") or start with an English verb that doubles as a program name
  // ("Find matches for the old secret"); only text that IS a command — short,
  // or carrying flags/paths/shell syntax — is rejected.
  if (/^(?:npm|pnpm|yarn|bun|npx)\b/i.test(text))
    return { ok: false, reason: "package-script" };
  const commandShaped =
    text.split(/\s+/).length < 5 ||
    /(?:^|\s)-{1,2}[a-z]|\/|\$|\||&|=/.test(text);
  if (looksLikeCommand(text) && commandShaped)
    return { ok: false, reason: "command-like" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePath(text))
    return { ok: false, reason: "implementation-detail" };
  if (/\$\w|`/.test(text)) return { ok: false, reason: "command-like" };
  if (lacksDecisionObject(text)) return { ok: false, reason: "vague" };
  if (looksLikeGenericResult(text)) return { ok: false, reason: "vague" };
  if (looksGibberish(text)) return { ok: false, reason: "gibberish" };
  return { ok: true };
}

/**
 * Gate for the agent's DECLARED task list text (TaskCreate/TaskUpdate via the
 * status sidecar, or a checklist printed by the agent). Unlike scraped prompt
 * text, a real task may legitimately say "Run cargo test", name a file, or
 * mention something "broken" — so the command/path/package heuristics are
 * skipped (they blanked the whole header to "Idle", the 2026-07-03 regression).
 * Raw-prompt junk (typo storms, trailing "?", gibberish) is still rejected
 * because printed checklists are scraped from scrollback and can carry it.
 */
export function qualityCheckAuthoritativeTaskLabel(
  value?: string | null,
  // The Task row on a map card is a fixed TWO-line box, so it can carry more than the
  // one-line callers. Defaulted, so every existing caller keeps the 96-character rule.
  options: { maxLength?: number; allowMetaProcess?: boolean } = {},
): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (looksLikeTerminalStatusBar(text))
    return { ok: false, reason: "terminal-chrome" };
  if (text.length > (options.maxLength ?? 96))
    return { ok: false, reason: "too-long" };
  if (
    /^(?:Ready|Idle|Terminal|Working|Thinking|Running terminal command|Supervised agent run|Context compacted|done|go|fix it)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/^Answering (?:latest prompt|user question)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (!options.allowMetaProcess && looksLikeMetaProcessTask(text)) {
    return { ok: false, reason: "vague" };
  }
  // A bare acknowledgment is not a task.
  if (
    /^(?:sure|yes|yeah|yep|no|nope|ok|okay|thanks|thank you|continue|proceed)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  // Verbatim operator words are welcome on the Task row, but a nudge is not a task.
  // These are the ones the live sweep found standing as a whole pane's Task row:
  // "make high", "make all high", "add it".
  if (
    /^(?:make (?:it |all )?high(?: and continue)?|add it|do it|just do it|next|more|again|keep going|carry on|ok(?:ay)? go|try again|same|both)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:you|your|you're|you are)\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // Prompt-box chrome for an attachment the operator pasted. "[Image #5]" stood as a
  // whole pane's Task row on 2026-07-25 — it is the composer's placeholder, not a task.
  if (/^\[(?:Image|Screenshot|File|Pasted)[^\]]*\]$/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // A slash command and a numbered scrollback line are junk on ANY path — a real
  // task list never carries them, and this gate is where the sidecar ask lands.
  if (looksLikeSlashCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeEnumeratedFragment(text))
    return { ok: false, reason: "prompt-fragment" };
  if (
    /\[[^\]]+\].*\[[^\]]+\]|\b(?:backend\.exit|Primary backend exited|boot)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (lacksDecisionObject(text)) return { ok: false, reason: "vague" };
  if (looksLikeGenericResult(text)) return { ok: false, reason: "vague" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePromptFragment(text))
    return { ok: false, reason: "prompt-fragment" };
  if (looksGibberish(text)) return { ok: false, reason: "gibberish" };
  return { ok: true };
}

/**
 * Gate for the agent's own chat prose (sidecar `source: "claude-narration"`)
 * before it may stand as the pane's current activity.
 *
 * Narration is the model talking to the operator, not a description of work:
 * "I committed only the profile-loading fix", "Working tree is clean". Only a
 * line that reads like an action in progress qualifies — the same shape a task's
 * `activeForm` has ("Installing the updated scripts"). Everything else is a
 * report, and a report is not what the pane is doing now.
 */
/**
 * The two shapes that reached the live cockpit as a pane title on 2026-07-09:
 * the agent talking about the conversation ("Those two failures are in and —…",
 * "It is not in production yet.") and a line cut off mid-thought.
 *
 * A trailing "…" alone is NOT truncation — `shortenTitle` adds one to fit the
 * card, and "Installing the updated scripts…" is a perfectly good title. What
 * marks a cut-off line is what sits BEFORE the ellipsis: a dangling connective,
 * or punctuation that promises a continuation.
 */
export function titleIsCommentaryOrDangling(value?: string | null) {
  const text = clean(value);
  if (!text) return false;
  if (/^(?:I|We|You|They|It|This|That|There|Those|These)\b/.test(text))
    return true;
  const body = text.replace(/(?:…|\.\.\.)$/, "").trim();
  if (/[,;:—-]$/.test(body)) return true;
  // A line that STARTS mid-sentence is a scrape fragment, however clean its tail
  // reads: a bare number ("07s, both calm single-button cards." — the live 2026-07-25
  // report, a decimal split at "0.07s") or a continuation connective.
  if (/^\d/.test(body)) return true;
  if (
    /^(?:and|but|or|so|also|both|plus|then|because|however|which|that's|too)\b/i.test(
      body,
    )
  )
    return true;
  return /\b(?:and|but|or|with|from|to|in|of|for|the|a|an)$/i.test(body);
}

// An activity line describes something HAPPENING. Exactly two shapes qualify:
//
//   in progress — a gerund leads:        "Locating the master frame reference"
//   finished    — a past-tense outcome:  "Fixed the compressor timeout"
//
// Stated positively on purpose. The previous version was a blacklist of imperative
// verbs, and "Locate the master frame reference and asset" reached a live pane simply
// because "locate" was not on the list (2026-07-25) — a blacklist of English verbs
// never converges. As a whitelist an unknown verb fails CLOSED: the pane falls back to
// an honest status word instead of printing an instruction as if it were activity.
//
// Irregular past forms have no suffix to match, so the common ones are named. This list
// only ever ADMITS text — a missing entry costs a good title, never a bad one.
const ACTIVITY_IN_PROGRESS = /^[A-Z][a-z]+ing\b/;
const ACTIVITY_OUTCOME =
  /^(?:[A-Z][a-z]+(?:ed|d)\b|Ran|Built|Wrote|Made|Sent|Found|Set|Kept|Left|Got|Took|Put|Cut|Split|Read|Rebuilt|Undid|Redid|Began|Broke|Chose|Drew|Grew|Held|Knew|Lost|Met|Paid|Said|Saw|Sold|Spent|Told|Won)\b/;

// Words that END in "ing" or "ed" without being verbs. Without this, "Everything is
// reconnected: the new bot token is saved…" passes as a gerund because `[a-z]+ing`
// matches "verything" — a report sails through the activity contract on a spelling
// coincidence. Found by reading the live table after the contract went in.
const NOT_A_VERB_DESPITE_SUFFIX =
  /^(?:Everything|Anything|Nothing|Something|Morning|Evening|Ceiling|Building blocks|During|Nothing|Thing|Things|King|Ring|String|Spring|Wing|Bring|Sing|Swing|Sterling|Willing|Missing|Pending|Ongoing|Interesting|Amazing|Indeed|Embed|Speed|Need|Needs|Feed|Seed|Deed|Red|Bed|Bad|Sad|Old|Cold|Good|Word|Weird|Hundred|Ahead|Instead|Failed builds)\b/;

/**
 * Drop composer chrome from the operator's own words.
 *
 * A pasted attachment leaves a placeholder in the prompt text — "[Image #1] got stuck",
 * "[Image #3] after saving the path" — and that reached seven live Task rows on
 * 2026-07-25. The placeholder is the composer's, not the operator's; what they actually
 * said is the rest of the line and must be kept. Returns "" when nothing survives, so
 * the caller falls through the ladder instead of showing chrome.
 */
export function stripComposerChrome(value?: string | null) {
  return (
    clean(value)
      .replace(/\[{1,3}\s*(?:Image|Screenshot|File|Pasted)\s*#?\d*[^\]]*\]+/gi, " ")
      // A pasted LINK is never the goal — "lets get termfleet ready for sharing. I want
      // to share it here - https://…" reached a live Task row whole (2026-07-26). The
      // sentence still says what they asked for once the url is gone, and Class C2 of
      // docs/cockpit-label-quality-matrix.md bans urls outright.
      .replace(/\b(?:https?:\/\/|www\.)\S+/gi, " ")
      // A dangling connector left behind by the removal ("share it here - ") would then
      // trip the cut-off-line check, so tidy the seam.
      .replace(/\s*[-–—:]\s*$/, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function readsAsActivity(value?: string | null) {
  const text = clean(value);
  if (!text) return false;
  if (NOT_A_VERB_DESPITE_SUFFIX.test(text)) return false;
  return ACTIVITY_IN_PROGRESS.test(text) || ACTIVITY_OUTCOME.test(text);
}

function looksLikeActivity(text: string) {
  return readsAsActivity(text);
}

// Tool identifiers, env-var command lines, file names, urls/absolute paths, ticket
// ids and test tallies. Every one of these came off a live pane on 2026-07-25.
const UNREADABLE_DEVELOPER_DETAIL =
  /\b[a-z][a-z0-9]*__[a-z0-9_]+|\b[A-Z][A-Z0-9_]{2,}=|\.(?:ts|tsx|js|jsx|mjs|cjs|py|rs|go|rb|java|kt|c|cc|cpp|h|hpp|sh|toml|yaml|yml|lock|md|markdown|txt|csv|log|env|html|css)\b|:\/\/|\/(?:home|media|usr|etc|var|tmp|opt|root)\/|\b[A-Z]{1,3}-\d{2,4}\b|\b\d+\s+(?:tests?|files?|specs?|assertions?)\b/;

// Stripping inline code out of narration leaves holes behind: "Staging is clean — no
// , no , no ." and "the art redesign ." A space immediately before a comma or full
// stop never occurs in real prose, so it is a reliable tell that text went missing.
const MANGLED_BY_STRIPPING = /\s[,.](?:\s|$)/;

// A markdown label the agent wrote for a human reader ("Md: N/A, quick production
// fix.") and a line that opens on punctuation ("-fast-track started: …") or closes a
// bracket it never opened ("Com/docs/changelog/2023-04-11) Next steps …").
const LABEL_OR_FRAGMENT =
  /^(?:md|note|tldr|tl;dr|summary|result|status|commits?|files?|tests?|evidence)\s*:\s|^[^\p{L}\p{N}"'(]|^[^(]*\)/iu;

export function qualityCheckNarrationLabel(
  value?: string | null,
  mode: "working" | "settled" = "working",
): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (titleIsCommentaryOrDangling(text))
    return { ok: false, reason: "prompt-fragment" };
  // A pane that is WORKING must name an action in progress — a gerund, the same
  // shape a task's activeForm has. A pane that has FINISHED may instead state
  // what was done (operator rule, 2026-07-04: a finished terminal says its outcome).
  if (mode === "working" && !/^[A-Z][a-z]+ing\b/.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  return qualityCheckTrustedActivityLabel(text);
}

/**
 * Gate for trusted/model activity that is about to become the big pane title.
 * It is stricter than authoritative task text: a task row may name a file for
 * precision, but the title must remain plain language for the cockpit.
 */
export function qualityCheckTrustedActivityLabel(
  value?: string | null,
): HeaderQualityResult {
  const text = clean(value);
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (
    /^(?:Working|Thinking|Ready|Idle|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/^Linting frontend$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Checking frontend build$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Check the remote$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^frontend lint checks$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Editing files$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/\bcontinue (?:the )?(?:task|process)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/\b(?:next step|address the issue|address this issue)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  // The base gate runs FIRST so structural junk keeps its own precise reason; the
  // three checks below only catch text that passes everything else.
  const base = baseQuality(value, 80);
  if (!base.ok) return base;
  // A live sweep of every pane on this machine (2026-07-25) found three shapes that
  // pass every other check and still read as junk on the big title. All three are
  // rejected HERE rather than in one caller, because the same text reaches the title
  // through the narration gate, the trusted-summary path, and the task ladder.
  //
  // 1. A hand-off checklist ("Steps - Log out and back in.", "Next steps: …") is what
  //    the OPERATOR may do next, not what the pane is doing.
  if (/^(?:Next\s+steps|Steps)\b\s*[-:—]/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // 2. The line must READ as activity — in progress or finished. This rejects the
  //    instruction ("Confirm Tailscale is actually running", "Locate the master frame
  //    reference and asset") and the report ("TH is on the board and verified.",
  //    "CI is green and the PR is clean.") without naming either verb.
  if (!looksLikeActivity(text)) return { ok: false, reason: "vague" };
  // 3. Raw developer detail is unreadable in a cockpit built for a non-developer:
  //    tool identifiers ("Using mcp__…__ctx_execute"), env-var command lines
  //    ("Running: HERMES_HOME=/home/…"), and source file names ("Editing release.py").
  if (UNREADABLE_DEVELOPER_DETAIL.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (MANGLED_BY_STRIPPING.test(text))
    return { ok: false, reason: "prompt-fragment" };
  if (LABEL_OR_FRAGMENT.test(text))
    return { ok: false, reason: "prompt-fragment" };
  return base;
}

export function qualityCheckTaskLabel(
  value?: string | null,
): HeaderQualityResult {
  const text = clean(value);
  if (
    /^(?:Ready|Terminal|Working|Thinking|Running terminal command|Supervised agent run|Context compacted|done|go|fix it)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  return baseQuality(value, 96);
}

/**
 * Gate for the small NOW line: momentary activity. A bare tool name ("Using
 * Skill") is acceptable HERE — it is honest live activity — but structural junk
 * (files, commands, code, prompt echoes) is not.
 */
export function qualityCheckNowLabel(
  value?: string | null,
): HeaderQualityResult {
  const text = clean(value);
  if (/^(?:Next\s+steps|Steps)\s*[-:]/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // A markdown label the agent wrote for a human reader is not a line of its own.
  // "Md: N/A, quick production fix." reached a live pane title through THIS gate —
  // the last one with no such check.
  if (LABEL_OR_FRAGMENT.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (
    /^(?:Working|Thinking|Ready|Activity not captured|Awaiting terminal output|Running terminal command|Command is running)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:make (?:it |all )?high(?: and continue)?|add it|confirm)$/i.test(text)
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/\.(?:png|jpe?g|webp)\b/i.test(text) || /\bFull capture\b/i.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (UNREADABLE_DEVELOPER_DETAIL.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (MANGLED_BY_STRIPPING.test(text))
    return { ok: false, reason: "prompt-fragment" };
  if (/^(?:I['’]m|I am|I fixed)\s+/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^⏵⏵\s*auto mode\b/i.test(text) || /\bauto mode on\b/i.test(text)) {
    return { ok: false, reason: "terminal-chrome" };
  }
  if (
    /^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i.test(
      text,
    )
  ) {
    const target = text.replace(
      /^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i,
      "",
    );
    if (looksLikeSpokenPrompt(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  return baseQuality(value, 80);
}

export function qualityCheckActivityLabel(
  value?: string | null,
): HeaderQualityResult {
  const text = clean(value);
  if (/^(?:Next\s+steps|Steps)\s*[-:]/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (
    /^(?:Working|Thinking|Ready|Idle|Activity not captured|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:make (?:it |all )?high(?: and continue)?|add it|confirm)$/i.test(text)
  ) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:Commit(?:ting)? and push(?:ing)?|Publish(?:ing)?) the handoff$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/\.(?:png|jpe?g|webp)\b/i.test(text) || /\bFull capture\b/i.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (/^(?:I['’]m|I am|I fixed)\s+/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^⏵⏵\s*auto mode\b/i.test(text) || /\bauto mode on\b/i.test(text)) {
    return { ok: false, reason: "terminal-chrome" };
  }
  if (/^Linting frontend$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Checking frontend build$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Check the remote$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^frontend lint checks$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Editing files$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:Verifying|Checking|Reviewing|Inspecting|Testing|Running)\s+about$/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (/^Running:\s*[\w./-]{1,24}(?:\s+-{1,2}[\w-]{1,16})?$/i.test(text)) {
    return { ok: false, reason: "command-like" };
  }
  if (
    /^Running:\s*(?:sleep|sed|tr|awk|grep|rg|npm|pnpm|yarn|node|npx|git|gh|curl|python(?:3)?|cargo)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "command-like" };
  }
  if (/\bcontinue (?:the )?(?:task|process)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/\b(?:next step|address the issue|address this issue)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^building TypeScript and Vite production bundle$/i.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (
    /^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  // A bare tool name ("Using Skill", "Running Bash") says nothing about the work
  // as a TITLE (it is fine on the now line — see qualityCheckNowLabel).
  if (
    /^(?:Using|Calling|Invoking|Running|Executing|Loading)\s+[A-Z][A-Za-z]*$/.test(
      text,
    )
  ) {
    return { ok: false, reason: "vague" };
  }
  if (
    /^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i.test(
      text,
    )
  ) {
    const target = text.replace(
      /^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i,
      "",
    );
    if (looksLikeSpokenPrompt(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  const base = baseQuality(value, 64);
  if (!base.ok) return base;
  // Last: the title must READ as activity. The checks above are a decade of one-off
  // strings; this is the general rule they were each approximating. It is what stops
  // an instruction ("Fix context compressor timeouts…", "Organize files into
  // subfolders") or a bare status phrase ("Prompt submitted", "Lane E — Dedup +
  // restore…") from standing as the big title, without naming any of them.
  if (!looksLikeActivity(text)) return { ok: false, reason: "vague" };
  return base;
}

export function headerLabelsAreDuplicated(
  task?: string | null,
  activity?: string | null,
) {
  const cleanTask = clean(task).toLowerCase();
  const cleanActivity = clean(activity).toLowerCase();
  const sameOldLinkWork =
    /\bold link\b/.test(cleanTask) &&
    /\blink replacements?\b/.test(cleanActivity) &&
    /\b(?:updating|checking|replacing|resetting)\b/.test(
      `${cleanTask} ${cleanActivity}`,
    );
  return Boolean(
    cleanTask &&
    cleanActivity &&
    ((cleanTask === cleanActivity && cleanTask.length > 48) || sameOldLinkWork),
  );
}
