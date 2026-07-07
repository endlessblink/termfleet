export type HeaderQualityReason =
  | "empty"
  | "too-long"
  | "prompt-fragment"
  | "raw-thinking-prompt"
  | "command-like"
  | "implementation-detail"
  | "package-script"
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

function looksLikePackageScript(text: string) {
  return /^[\w@./-]+@\d+\.\d+\.\d+\s+[\w:-]+(?:\s|$)/i.test(text) ||
    /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?[\w:-]+\b/i.test(text) ||
    /\bnpx\s+[\w@./-]+/i.test(text);
}

function looksLikePromptFragment(text: string) {
  return /[?]\s*$/i.test(text) ||
    /^(?:what now|what changed|why|how is this|where is|can you|do you|ok so|so how|this is|it seems|we still|i am|i'm|i can\b|you keep|you may\b|you should\b|maybe you\b|your\b|you're\b|you are\b)\b/i.test(text) ||
    /^(?:is|are)\s+\w+(?:\s+\w+){0,3}\s+(?:practical\s+)?lanes?\b/i.test(text) ||
    /^what\s+does\s+belong\b/i.test(text) ||
    /^(?:the answer is|symptom)\s*:/i.test(text) ||
    /^(?:yes|no):\s+\b/i.test(text) ||
    /^to test it(?: yourself)?\b/i.test(text) ||
    /^what changed\b/i.test(text) ||
    /^what i did\b/i.test(text) ||
    /^what i fixed\b/i.test(text) ||
    /^the fix\b/i.test(text) ||
    /^The durable code fix\b/i.test(text) ||
    /^Added to create\b/i.test(text) ||
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
 * Gate for trusted/model activity that is about to become the big pane title.
 * It is stricter than authoritative task text: a task row may name a file for
 * precision, but the title must remain plain language for the cockpit.
 */
export function qualityCheckTrustedActivityLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (/^(?:Working|Thinking|Ready|Idle|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Linting frontend$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Checking frontend build$/i.test(text)) {
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
  if (/^(?:Working|Thinking|Ready|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Waiting for (?:the )?operator(?:'s)? (?:response|reply|follow-up)\b/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^(?:Thinking about|Working on)\s+/i.test(text)) {
    const target = text.replace(/^(?:Thinking about|Working on)\s+/i, "");
    if (looksLikePromptFragment(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  return baseQuality(value, 80);
}

export function qualityCheckActivityLabel(value?: string | null): HeaderQualityResult {
  const text = clean(value);
  if (/^(?:Working|Thinking|Ready|Idle|Awaiting next action|Awaiting terminal output|Running terminal command|Command is running)$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Linting frontend$/i.test(text)) {
    return { ok: false, reason: "vague" };
  }
  if (/^Checking frontend build$/i.test(text)) {
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
  if (/^(?:Thinking about|Working on)\s+/i.test(text)) {
    const target = text.replace(/^(?:Thinking about|Working on)\s+/i, "");
    if (looksLikePromptFragment(target) || looksGibberish(target)) {
      return { ok: false, reason: "raw-thinking-prompt" };
    }
  }
  return baseQuality(value, 64);
}

export function headerLabelsAreDuplicated(task?: string | null, activity?: string | null) {
  const cleanTask = clean(task).toLowerCase();
  const cleanActivity = clean(activity).toLowerCase();
  return Boolean(
    cleanTask &&
      cleanActivity &&
      cleanTask === cleanActivity &&
      cleanTask.length > 48,
  );
}
