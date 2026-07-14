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
  return /(?:^|[\s"'([{])\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(text) ||
    /(?:^|[\s"'])~\//.test(text) ||
    /(?:^|\w)\]\(\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(text) ||
    /\[[^\]]{0,80}\]\(\/(?:home|media|tmp|var|usr|opt|data)(?:\/|$|\.)/i.test(text) ||
    /\b(?:src|tests|docs|scripts)\/[\w./-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh)\b/i.test(text) ||
    /\b[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|rs|md|json|sh)\b/i.test(text);
}

function looksLikeCommand(text: string) {
  return /^(?:\.\/|~\/|\/|cd\b|ls\b|ll\b|pwd\b|cat\b|less\b|tail\b|head\b|sed\b|awk\b|grep\b|rg\b|find\b|printf\b|echo\b|env\b|export\b|source\b|clear\b|sleep\b|timeout\b|git\b|gh\b|npm\b|pnpm\b|yarn\b|bun\b|node\b|npx\b|tsx\b|python(?:3)?\b|uv\b|cargo\b|docker\b|ssh\b|curl\b|sudo\b|chmod\b|mkdir\b|rm\b|mv\b|cp\b|touch\b|vim\b|nvim\b|tmux\b|ps\b|kill\b|pkill\b)\b/i.test(text) ||
    /^Running:\s*(?:sleep|sed|tr|awk|grep|rg|npm|pnpm|yarn|node|npx|git|gh|curl|python(?:3)?|cargo)\b/i.test(text) ||
    /\bmcp__[a-z0-9_]+__[a-z0-9_]+\b/i.test(text) ||
    /(?:&&|\|\||\s;\s|\|\s*\w|>\s*\S|<\s*\S|`[^`]+`|\$\(|\${)/.test(text);
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
  return /^[\w@./-]+@\d+\.\d+\.\d+\s+[\w:-]+(?:\s|$)/i.test(text) ||
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+\b/i.test(text) ||
    /\bnpx\s+[\w@./-]+/i.test(text);
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
  return looksLikePromptFragment(text) || /^(?:i|we|my|our|lets?)\b/i.test(text);
}

function looksLikePromptFragment(text: string) {
  return /[?]\s*$/i.test(text) ||
    /^(?:and\s+)?(?:this|that|these|those|both)$/i.test(text) ||
    /^and\s+\w+(?:\s+\w+){0,4}$/i.test(text) ||
    /^make sure\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+(?:you|your|you're|you are)\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+implement this\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+lets?\b/i.test(text) ||
    /^(?:Checking|Inspecting|Monitoring|Reviewing|Testing|Verifying)\s+got stuck\b/i.test(text) ||
    /^[\s:;,-]*(?:what now|what changed|what you are trying|why|how is this|where is|can you|do you|ok so|so how|this is|it seems|its not\b|it's not\b|we still|i am|i'm|i’ll\b|i'll\b|i fixed\b|i just need\b|i need\b|i starting\b|i can\b|you keep|you may\b|you should\b|maybe you\b|your\b|you're\b|you are\b)\b/i.test(text) ||
    /^(?:is|are)\s+\w+(?:\s+\w+){0,3}\s+(?:practical\s+)?lanes?\b/i.test(text) ||
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
    /^[\s:;,-]*I (?:re-read|updated|deployed|checked|changed|added|can handle)\b/i.test(text) ||
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
    /^(?:this failure is clear|this is a failure|failed here|again fail|low quality)\b/i.test(text) ||
    /^(?:the bad part was|the mistake was|it wasn'?t followed because)\b/i.test(text) ||
    /^(?:md|markdown)\)?\s+it covers\b/i.test(text) ||
    /\b(?:is too vague because|says nothing about|wrong project|approval is based on)\b/i.test(text) ||
    /\b(?:guidelines|documentation|docs|article|source|report|study|research)\s+(?:say|says|show|shows|recommend|recommends)\b/i.test(text) ||
    /\b(?:dont|doesnt|isnt|havent|ahve|querstions|apth|relatd|udpated|descriptuin)\b/i.test(text);
}

// Pasted source code (a JS snippet once became a pane's Task row). Requires BOTH a
// code keyword AND code punctuation so prose like "Update the const declaration"
// stays accepted.
function looksLikeCode(text: string) {
  return /\b(?:const|let|var|function|return|import|export|await)\b|=>/.test(text) &&
    /(?:=>|[{};]|\)\s*\{|\w\()/.test(text);
}

function looksGibberish(text: string) {
  const letters = text.replace(/[^a-z]/gi, "");
  if (letters.length < 5) return false;
  const vowels = (letters.match(/[aeiou]/gi) ?? []).length;
  if (letters.length >= 8 && vowels / letters.length < 0.18) return true;
  return /\b[a-z]{7,}\b/i.test(text) && /\b(?:fgh|dfg|asdf|sdf|ghd|qwe|zx)\w*\b/i.test(text);
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
  if (/^(?:(?:Thinking about|Working on)\s+)?Raise quality across the current work$/i.test(text)) {
    return true;
  }
  if (/^Verify\s+(?:Build(?: and tests)?|Tests?|Test process|Build process|Typecheck(?: and pytest)?|update project plan|Task)\s+result$/i.test(text)) {
    return true;
  }
  if (/^Task to\s+.+\s+(?:completed|passed|successful|completed successfully)\b/i.test(text)) {
    return true;
  }
  if (/^(?:Build(?: and tests)?|Tests?|Test process|Build process|Task|Verification check)\s+(?:completed|passed|successful|completed successfully)\b/i.test(text)) {
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

function lacksDecisionObject(text: string) {
  if (!/\b(?:operator|user|human|reviewer)?'?s?\s*(?:approval|verdict|decision|response|reply|follow-up)\b|\b(?:approval|verdict|decision)\b/i.test(text)) {
    return false;
  }
  if (/\b(?:about|on|for|over|of)\s+(?:this|that|the\s+)?(?!(?:operator|user|human|reviewer|approval|verdict|decision|response|reply|follow-up)\b)[a-z0-9][a-z0-9'-]*(?:\s+[a-z0-9][a-z0-9'-]*){1,}/i.test(text)) {
    return false;
  }
  if (/\b(?:pane header|header wording|title wording|deployment plan|build result|test result|floor-check|quality gate|operator gate)\b/i.test(text)) {
    return false;
  }
  return true;
}

function baseQuality(value?: string | null, maxLength = 96): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (looksLikePromptFragment(text)) return { ok: false, reason: "prompt-fragment" };
  if (text.length > maxLength) return { ok: false, reason: "too-long" };
  if (lacksDecisionObject(text)) return { ok: false, reason: "vague" };
  if (looksLikeGenericResult(text)) return { ok: false, reason: "vague" };
  if (looksLikePackageScript(text)) return { ok: false, reason: "package-script" };
  if (looksLikeCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePath(text)) return { ok: false, reason: "implementation-detail" };
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
export function qualityCheckUserAskLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > 96) return { ok: false, reason: "too-long" };
  if (/^(?:go|done|fix it|fix this too|so fix it|ok|okay|sure|yes|continue|do it|proceed)$/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^(?:and\s+)?(?:this|that|these|those|both)$/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^i just need\b/i.test(text) || /\banything else is just\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (looksLikeSlashCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeEnumeratedFragment(text)) return { ok: false, reason: "prompt-fragment" };
  // Wrap-cut fragments scraped mid-word/mid-quote (`ke "System Booted`) are not
  // an ask: unbalanced double quote, or a 1-2 letter lowercase stub opener.
  if ((text.match(/"/g) ?? []).length % 2 === 1) return { ok: false, reason: "prompt-fragment" };
  // Composer placeholder suggestions are UI chrome, never the user's ask.
  if (/@filename\b|@filepath\b/i.test(text)) return { ok: false, reason: "prompt-fragment" };
  if (/^(?:find and fix a bug in|write tests for|summarize recent commits|use \/\w+ to|improve documentation in|explain this codebase)\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  if (/^[a-z]{1,2}\s/.test(text) && !/^(?:i|we|is|it|do|go|if|he|at|on|in|to|my|no|ok|so|up|us|be|by|or|an|as|am)\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // A goal SENTENCE may mention a command ("Build the project using npm run
  // build") or start with an English verb that doubles as a program name
  // ("Find matches for the old secret"); only text that IS a command — short,
  // or carrying flags/paths/shell syntax — is rejected.
  if (/^(?:npm|pnpm|yarn|bun|npx)\b/i.test(text)) return { ok: false, reason: "package-script" };
  const commandShaped =
    text.split(/\s+/).length < 5 || /(?:^|\s)-{1,2}[a-z]|\/|\$|\||&|=/.test(text);
  if (looksLikeCommand(text) && commandShaped) return { ok: false, reason: "command-like" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePath(text)) return { ok: false, reason: "implementation-detail" };
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
export function qualityCheckAuthoritativeTaskLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > 96) return { ok: false, reason: "too-long" };
  if (/^(?:Ready|Idle|Terminal|Working|Thinking|Running terminal command|Supervised agent run|Context compacted|done|go|fix it)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Answering (?:latest prompt|user question)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  // A bare acknowledgment is not a task.
  if (/^(?:sure|yes|yeah|yep|no|nope|ok|okay|thanks|thank you|continue|proceed)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:you|your|you're|you are)\b/i.test(text)) {
    return { ok: false, reason: "prompt-fragment" };
  }
  // A slash command and a numbered scrollback line are junk on ANY path — a real
  // task list never carries them, and this gate is where the sidecar ask lands.
  if (looksLikeSlashCommand(text)) return { ok: false, reason: "command-like" };
  if (looksLikeEnumeratedFragment(text)) return { ok: false, reason: "prompt-fragment" };
  if (/\[[^\]]+\].*\[[^\]]+\]|\b(?:backend\.exit|Primary backend exited|boot)\b/i.test(text)) {
    return { ok: false, reason: "implementation-detail" };
  }
  if (lacksDecisionObject(text)) return { ok: false, reason: "vague" };
  if (looksLikeGenericResult(text)) return { ok: false, reason: "vague" };
  if (looksLikeCode(text)) return { ok: false, reason: "command-like" };
  if (looksLikePromptFragment(text)) return { ok: false, reason: "prompt-fragment" };
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
  if (/^(?:I|We|You|They|It|This|That|There|Those|These)\b/.test(text)) return true;
  const body = text.replace(/(?:…|\.\.\.)$/, "").trim();
  if (/[,;:—-]$/.test(body)) return true;
  return /\b(?:and|but|or|with|from|to|in|of|for|the|a|an)$/i.test(body);
}

export function qualityCheckNarrationLabel(
  value?: string | null,
  mode: "working" | "settled" = "working",
): HeaderQualityResult {
  const text = clean(value);
  if (!text) return { ok: false, reason: "empty" };
  if (titleIsCommentaryOrDangling(text)) return { ok: false, reason: "prompt-fragment" };
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
export function qualityCheckTrustedActivityLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (/^(?:Working|Thinking|Ready|Idle|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
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
  if (/^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  return baseQuality(value, 80);
}

export function qualityCheckTaskLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (/^(?:Ready|Terminal|Working|Thinking|Running terminal command|Supervised agent run|Context compacted|done|go|fix it)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  return baseQuality(value, 96);
}

/**
 * Gate for the small NOW line: momentary activity. A bare tool name ("Using
 * Skill") is acceptable HERE — it is honest live activity — but structural junk
 * (files, commands, code, prompt echoes) is not.
 */
export function qualityCheckNowLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (/^(?:Working|Thinking|Ready|Activity not captured|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:make (?:it |all )?high(?: and continue)?|add it|confirm)$/i.test(text)) {
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
  if (/^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i.test(text)) {
    const target = text.replace(/^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i, "");
    if (looksLikeSpokenPrompt(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  return baseQuality(value, 80);
}

export function qualityCheckActivityLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (isPlaceholderActivity(text)) return { ok: false, reason: "vague" };
  if (/^(?:Working|Thinking|Ready|Idle|Activity not captured|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:make (?:it |all )?high(?: and continue)?|add it|confirm)$/i.test(text)) {
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
  if (/^(?:Verifying|Checking|Reviewing|Inspecting|Testing|Running)\s+about$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Running:\s*[\w./-]{1,24}(?:\s+-{1,2}[\w-]{1,16})?$/i.test(text)) {
    return { ok: false, reason: "command-like" };
  }
  if (/^Running:\s*(?:sleep|sed|tr|awk|grep|rg|npm|pnpm|yarn|node|npx|git|gh|curl|python(?:3)?|cargo)\b/i.test(text)) {
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
  if (/^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  // A bare tool name ("Using Skill", "Running Bash") says nothing about the work
  // as a TITLE (it is fine on the now line — see qualityCheckNowLabel).
  if (/^(?:Using|Calling|Invoking|Running|Executing|Loading)\s+[A-Z][A-Za-z]*$/.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i.test(text)) {
    const target = text.replace(/^(?:Thinking about|Working on|Reviewing|Checking|Inspecting|Testing|Verifying)\s+/i, "");
    if (looksLikeSpokenPrompt(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  return baseQuality(value, 64);
}

export function headerLabelsAreDuplicated(task?: string | null, activity?: string | null) {
  const cleanTask = clean(task).toLowerCase();
  const cleanActivity = clean(activity).toLowerCase();
  const sameOldLinkWork =
    /\bold link\b/.test(cleanTask) &&
    /\blink replacements?\b/.test(cleanActivity) &&
    /\b(?:updating|checking|replacing|resetting)\b/.test(`${cleanTask} ${cleanActivity}`);
  return Boolean(
    cleanTask &&
      cleanActivity &&
      (
        (cleanTask === cleanActivity && cleanTask.length > 48) ||
        sameOldLinkWork
      ),
  );
}
