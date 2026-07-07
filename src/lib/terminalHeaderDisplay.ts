import type {
  TerminalActivitySummary,
  TerminalPurpose,
  WorkstreamStatusSummary,
} from "./types";

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

export function terminalTextLooksReadyPrompt(value?: string | null) {
  const lines = (value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  const candidates = [
    lines[lines.length - 1],
    lines.slice(-2).join(""),
    lines.slice(-3).join(""),
  ]
    .map((line) => line?.trim() ?? "")
    .filter(Boolean);
  return candidates.some((candidate) =>
    /^[\w.@-]+@[\w.-]+:.*[$#>]\s*$/.test(candidate) ||
    /^[\w./~+-]+[$#>]\s*$/.test(candidate)
  );
}

export function terminalPurposeFromVisiblePrompt(value?: string | null): TerminalPurpose | undefined {
  const lines = (value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^(?:reverse-i-search|bck-i-search|fwd-i-search):/i.test(lines[index])) return undefined;
    const match = lines[index].match(/(?:^|\s)[›❯>$#]\s+(.+)$/);
    const promptText = match?.[1]?.trim() ?? "";
    if (!promptText) continue;
    const afterPrompt = lines.slice(index + 1);
    const hasPostPromptWork = afterPrompt.some((line) =>
      !/^(?:[─━-]+|\[OMC\]|⏵⏵|◎ |\/rc active|auto mode\b)/i.test(line) &&
      /\b(?:Reading|Calling|Bash|Allowed by|Working|Thinking|Coalescing|Cogitating|Orbiting|Cooked|Updated|Edited|Ran|Error|Failed|Passed)\b|^[●✶✻✢*]\s/i.test(line)
    );
    if (!hasPostPromptWork) continue;
    const title = purposeTitleFromPromptText(promptText);
    if (title) {
      return {
        title,
        source: "inferred",
        updatedAt: Date.now(),
      };
    }
  }
  return undefined;
}

const SHELL_COMMAND_PREFIX_PATTERN =
  /^(?:\.\/|~\/|\/|cd\b|ls\b|ll\b|pwd\b|cat\b|less\b|tail\b|head\b|sed\b|awk\b|grep\b|rg\b|find\b|printf\b|echo\b|env\b|export\b|unset\b|source\b|clear\b|sleep\b|timeout\b|git\b|gh\b|npm\b|pnpm\b|yarn\b|bun\b|node\b|npx\b|tsx\b|python(?:3)?\b|uv\b|cargo\b|make\b|cmake\b|docker\b|docker-compose\b|kubectl\b|ssh\b|scp\b|rsync\b|curl\b|wget\b|sudo\b|chmod\b|chown\b|mkdir\b|rm\b|mv\b|cp\b|touch\b|vim\b|nvim\b|nano\b|code\b|tmux\b|zellij\b|ps\b|kill\b|pkill\b|systemctl\b|journalctl\b|for\b|while\b|until\b|if\b|case\b|function\b|alias\b)/i;

const SHELL_SYNTAX_PATTERN =
  /(?:\$\(|\${|&&|\|\||\s;\s|;\s*(?:do|done|then|fi|else|elif|echo|printf|npm|git|for|while|if)\b|\|\s*\w|>\s*\S|<\s*\S|`[^`]+`)/;

function submittedInputLooksLikeUserAsk(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 8 || text.length > 260) return false;
  if (!/[a-z][a-z]/i.test(text) || !/\s/.test(text)) return false;
  if (/^[/\\]/.test(text)) return false;
  if (/^\d+(?:[.)])?\s*(?:yes|no|chat|type|submit)?$/i.test(text)) return false;
  if (/^(?:yes|no|y|n|ok|sure|done|continue|chat about this)$/i.test(text)) return false;
  if (/^(?:press up|enter to select|tab to|esc to|auto mode|thinking\b|working\s*\(|cogitating\b|orbiting\b)/i.test(text)) return false;
  if (/^[\w.-]+@\d+(?:\.\d+){1,3}\s+[\w:-]+(?:\s|$)/i.test(text)) return false;
  if (SHELL_COMMAND_PREFIX_PATTERN.test(text)) return false;
  if (SHELL_SYNTAX_PATTERN.test(text)) return false;
  return true;
}

function purposeTitleFromPromptText(promptText: string) {
  const recoveryTitle = recoveryPurposeTitle(promptText);
  if (recoveryTitle) return recoveryTitle;
  const qualityTitle = qualityPurposeTitle(promptText);
  if (qualityTitle) return qualityTitle;
  const normalizedPrompt =
    promptText
      .replace(/^i\s+(?:want|need)\s+to\s+/i, "")
      .replace(/\s+for\s+@(?:filename|filepath|file|directory|folder|selection)\b.*$/i, "")
      .replace(/@(?:filename|filepath|file|directory|folder|selection)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
  const directTitle = normalizePurposeTitle(purposeFromTranscriptLine(`› ${promptText}`));
  if (directTitle) return directTitle;
  if (!submittedInputLooksLikeUserAsk(normalizedPrompt)) return undefined;
  return normalizePurposeTitle(activeFormTitle(normalizedPrompt));
}

function recoveryPurposeTitle(value: string) {
  const text = cleanText(value) ?? "";
  if (!/\b(?:restore|restored|recovery|recover|recreate|create it)\b/i.test(text)) return undefined;
  if (!/\b(?:exactly|state|session|terminal|tmux|everything)\b/i.test(text)) return undefined;
  return "Create exact terminal session recovery";
}

export function qualityPurposeTitle(value: string) {
  const text = cleanText(value) ?? "";
  if (/\b(?:high quality|quality)\s+descriptions?\b/i.test(text)) {
    return "Improve cockpit header descriptions";
  }
  if (/\b(?:pane|terminal|cockpit)\s+headers?\b/i.test(text) && /\b(?:high quality|quality|better|clear|readable)\b/i.test(text)) {
    return "Improve pane header descriptions";
  }
  return undefined;
}

export function contextualActivityForTask(activity: string | undefined, task: string | undefined) {
  const cleanActivity = cleanText(activity);
  const cleanTask = cleanText(task);
  if (!cleanActivity || !cleanTask) return cleanActivity;
  if (!/^(?:Working on|Thinking about)\b/i.test(cleanActivity)) return cleanActivity;
  if (repeatsTitle(cleanTask, cleanActivity.replace(/^(?:Working on|Thinking about)\s+/i, ""))) {
    if (/\b(?:terminal session recovery|terminal recovery|session recovery)\b/i.test(cleanTask)) {
      return /^Thinking/i.test(cleanActivity) ? "Thinking through terminal recovery" : "Building terminal recovery";
    }
    if (/\b(?:cockpit header descriptions?|header description quality|quality descriptions?)\b/i.test(cleanTask)) {
      return /^Thinking/i.test(cleanActivity) ? "Reviewing header description quality" : "Improving header descriptions";
    }
  }
  return cleanActivity;
}

export function terminalPurposeFromSubmittedInput(value?: string | null): TerminalPurpose | undefined {
  const text = cleanText(value);
  if (!text) return undefined;
  const specialTitle = recoveryPurposeTitle(text) ?? qualityPurposeTitle(text);
  if (specialTitle) {
    return {
      title: specialTitle,
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (!submittedInputLooksLikeUserAsk(text)) return undefined;
  const title = purposeTitleFromPromptText(text);
  if (!title) return undefined;
  return {
    title,
    source: "inferred",
    updatedAt: Date.now(),
  };
}

export function terminalPurposeFromOperatorPrompt(value?: string | null): TerminalPurpose | undefined {
  const text = cleanText(value);
  if (!text || !/\b(?:enter to select|press enter to confirm)\b/i.test(text)) return undefined;
  const commitMatch = text.match(/\bHow should I commit\s+(.+?)(?:\?|$)/i);
  if (commitMatch?.[1]) {
    return {
      title: `Choosing commit scope for ${commitMatch[1].trim()}`,
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (/\bImplement this plan\?/i.test(text)) {
    return {
      title: "Choose whether to implement current plan",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (!/\bHow do you want to proceed\?/i.test(text)) return undefined;
  const beforeQuestion = text.split(/How do you want to proceed\?/i)[0] ?? "";
  const subjectMatch = beforeQuestion.match(/.*\b([A-Z][^.!?:]{6,120}?)\s+(?:is|are|was|were)\b/s);
  const subject = subjectMatch?.[1]?.trim();
  return {
    title: subject ? `Choosing next step for ${subject}` : "Choosing next step",
    source: "inferred",
    updatedAt: Date.now(),
  };
}

function terminalPurposeFromServiceOutput(value?: string | null): TerminalPurpose | undefined {
  const text = cleanText(value) ?? "";
  if (!text) return undefined;
  if (/\bWorking\s+\(/i.test(text) && /[›❯]\s*\$done\b/i.test(text)) {
    return {
      title: "Close current agent task",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (/\bconnect\s+hermes\s+to\s+flow-state\b/i.test(text)) {
    return {
      title: "Connect Hermes to Flow State",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (/\bcodex\s+resume\s+[0-9a-f-]{20,}/i.test(text)) {
    return {
      title: "Resume paused Codex session",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (/\bbackground terminal running\b/i.test(text)) {
    return {
      title: "Check background terminal status",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (!/\b(?:systemctl|\.service|Loaded:\s+loaded|transient\/run-|--user|Hermes Desktop is running)\b/i.test(text)) return undefined;
  if (/\bhermes(?:-desktop|-agent)?\b/i.test(text)) {
    return {
      title: "Check Hermes desktop service status",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  if (/\b(?:systemctl|\.service)\b/i.test(text)) {
    return {
      title: "Check user service status",
      source: "inferred",
      updatedAt: Date.now(),
    };
  }
  return undefined;
}

export function terminalActivityFromVisibleText(value?: string | null) {
  const lines = (value ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const thinking = line.match(/\b(?:thinking|cogitating|orbiting)\b(?:\s+(?:with|at)\s+[^•|]+)?/i)?.[0];
    if (thinking) {
      return thinking
        .replace(/^orbiting\b/i, "Thinking")
        .replace(/^cogitating\b/i, "Thinking")
        .replace(/^thinking\b/i, "Thinking")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (/\bwaiting for (?:operator|input|approval)\b/i.test(line)) {
      return "Waiting for operator input";
    }
    if (/\b(?:requires approval|Do you want to proceed\?|Enter to select)\b/i.test(line)) {
      return "Waiting for approval";
    }
    if (/\bplan mode\b/i.test(line)) {
      return "Planning";
    }
  }
  return undefined;
}

export function compactHeaderGoal(value?: string | null) {
  const text = cleanText(value);
  if (!text) return undefined;
  const compacted = text
    .replace(/`[^`]+`/g, "")
    .replace(/\/(?:[\w.-]+\/){2,}[\w./-]+/g, "")
    .replace(/\b(?:FIRST|First)\s+read\b.*$/i, "")
    .replace(/\b(?:follow|obey)\s+EXACTLY\b.*$/i, "")
    .replace(/\.\s+The\s+i18n\s+infra\b.*$/i, "")
    .replace(/\s+\([^)]*(?:rules|path|file|tmp|claude)[^)]*\)/gi, "")
    .replace(/\s*[-–—]\s*(?:follow|read|use|then)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,:;.\s]+$/, "");
  if (!compacted) return text.slice(0, 96).trim();
  if (compacted.length > 96) return `${compacted.slice(0, 93).trim()}...`;
  // Prompts scraped from the visible grid are cut at the terminal's wrap width,
  // leaving a dangling fragment ("…you found out so I", "…built a tool th").
  // Trim back to the last full word and mark the cut.
  if (compacted.length >= 55 && !/[.!?)"'`\]]$/.test(compacted)) {
    const trimmed = compacted.replace(/\s+\S{1,2}(?:\s+\S{1,2})?$/, "");
    if (trimmed !== compacted && trimmed.length >= 40) return `${trimmed}\u2026`;
  }
  return compacted;
}

function comparableText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function repeatsTitle(title: string, detail: string) {
  const titleText = comparableText(title);
  const detailText = comparableText(detail);
  if (!titleText || !detailText) return false;
  return (
    titleText === detailText ||
    detailText.startsWith(`${titleText} `) ||
    (titleText.startsWith(`${detailText} `) && detailText.length > 12)
  );
}

function cleanPath(value?: string | null) {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^(?:stale|unknown|workspace path unknown)$/i.test(text))
    return undefined;
  return text;
}

function looksLikeFilePath(value: string) {
  return /(?:^|\/)[\w.-]+\.[a-z0-9]+$/i.test(value);
}

function compatibleSummaryPath(summaryPath: string | undefined, fallbackPath: string | undefined) {
  if (!summaryPath) return fallbackPath ?? "workspace path unknown";
  if (!fallbackPath || fallbackPath === "workspace path unknown") return summaryPath;
  if (looksLikeFilePath(summaryPath)) return summaryPath;
  const normalizedSummary = summaryPath.replace(/\/+$/, "");
  const normalizedFallback = fallbackPath.replace(/\/+$/, "");
  if (
    normalizedSummary === normalizedFallback ||
    normalizedFallback.endsWith(`/${normalizedSummary}`) ||
    normalizedSummary.endsWith(`/${normalizedFallback}`)
  ) {
    return summaryPath;
  }
  return fallbackPath;
}

function fallbackPathLabels(path: string) {
  const parts = path.split("/").filter(Boolean);
  return new Set([
    path,
    parts[parts.length - 1],
    parts.slice(-2).join("/"),
  ].filter(Boolean));
}

function compatibleActivityNow(now: string | undefined, fallbackPath: string) {
  if (!now) return "Awaiting command";
  if (/^(Thinking|Planning|Reviewing|Testing|Building|Running|Waiting|Paused)$/i.test(now)) {
    return now;
  }
  // A bare slug in `now` is usually a leaked project/path label, not activity. Keep it
  // only when it matches the live terminal path; richer strings are real activity text.
  if (/^[\w.-]+$/.test(now) && !fallbackPathLabels(fallbackPath).has(now)) {
    return "Awaiting command";
  }
  return now;
}

export function sanitizeTerminalHeaderNow(
  now: string | undefined,
  livePath: string | undefined,
  fallback = "Awaiting command",
) {
  const fallbackPath = cleanPath(livePath) ?? "workspace path unknown";
  const sanitized = compatibleActivityNow(cleanText(now), fallbackPath);
  return sanitized === "Awaiting command" ? fallback : sanitized;
}

export function compactTerminalHeaderPath(
  summaryPath: string | undefined,
  livePath: string | undefined,
  minimumSegments = 5,
) {
  const summary = cleanPath(summaryPath);
  const live = cleanPath(livePath);
  if (!live) return summary ?? "workspace path unknown";
  if (summary && looksLikeFilePath(summary)) return summary;

  const liveParts = live.split("/").filter(Boolean);
  if (liveParts.length <= minimumSegments) return liveParts.join("/") || live;

  const summaryParts = summary?.split("/").filter(Boolean) ?? [];
  const summaryIsOnlyLiveTail =
    summaryParts.length > 0 &&
    summaryParts.length < minimumSegments &&
    liveParts.slice(-summaryParts.length).join("/") === summaryParts.join("/");
  if (summaryIsOnlyLiveTail || !summary) {
    return `.../${liveParts.slice(-minimumSegments).join("/")}`;
  }
  return summary;
}

export function sanitizeShellDisplaySummary<T extends WorkstreamStatusSummary>(
  summary: T,
  livePath: string | undefined,
  fallbackNow = "Awaiting command",
): T {
  const fallbackPath = cleanPath(livePath) ?? "workspace path unknown";
  return {
    ...summary,
    path: compatibleSummaryPath(cleanPath(summary.path), fallbackPath),
    now: sanitizeTerminalHeaderNow(summary.now, fallbackPath, fallbackNow),
  };
}

function pathFromCommand(command?: string) {
  const normalized = command?.replace(/\\"/g, '"').replace(/\\'/g, "'");
  if (!normalized) return undefined;
  const spec = normalized.match(
    /(?:^|\s)([\w./-]+\.(?:spec|test)\.(?:tsx?|jsx?))/i,
  )?.[1];
  if (spec) return spec;
  const manifest = normalized.match(
    /--manifest-path\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i,
  );
  return cleanPath(manifest?.[1] ?? manifest?.[2] ?? manifest?.[3]);
}

function readableTitleFromPath(path: string) {
  const file = path.split("/").filter(Boolean).pop() ?? path;
  if (/map-terminal-rendering\.spec\./i.test(file))
    return "Validating map terminal rendering behavior";
  if (/agent-status-summary\.spec\./i.test(file))
    return "Validating activity summary wording";
  if (/checkout/i.test(file)) return "Validating checkout flow";
  if (/login|auth|authentication|sign-in|signin/i.test(file))
    return "Validating login flow";
  const label = file
    .replace(/\.(?:spec|test)\.(?:tsx?|jsx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return `Validating ${label.toLowerCase()}`;
}

export function isGenericVerificationTaskTitle(value?: string | null) {
  const text = cleanText(value);
  return Boolean(
    text &&
      /^Run focused tests(?: and typecheck| and lint\/type checks as feasible)?$/i.test(text),
  );
}

function isGenericTaskTitle(value?: string | null) {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /^(?:Ready|Terminal|Search|Working|Running terminal command)$/i.test(
      text,
    ) ||
    /^Playwright tests (?:passed|failed)$/i.test(text) ||
    /^Verifying map terminals$/i.test(text) ||
    /^Checking map terminal source contract$/i.test(text) ||
    /^Map terminal source checks (?:passed|failed)$/i.test(text) ||
    /^Status summary server checks (?:passed|failed)$/i.test(text) ||
    /^Checking status summary server contract$/i.test(text) ||
    /^Checking Agent Status Sidecar tests$/i.test(text) ||
    /^Frontend build (?:passed|failed)$/i.test(text) ||
    /^Building frontend$/i.test(text)
  );
}

function boundedTitle(value: string) {
  const text = cleanText(value) ?? "Terminal activity";
  return text.length > 64 ? `${text.slice(0, 61).trimEnd()}...` : text;
}

function activeFormTitle(value: string) {
  return value
    .replace(/^fix\b/i, "Fixing")
    .replace(/^improve\b/i, "Improving")
    .replace(/^add\b/i, "Adding")
    .replace(/^update\b/i, "Updating")
    .replace(/^review\b/i, "Reviewing")
    .replace(/^verify\b/i, "Verifying")
    .replace(/^validate\b/i, "Validating")
    .replace(/^check\b/i, "Checking")
    .replace(/^run\b/i, "Running")
    .replace(/^build\b/i, "Building")
    .replace(/^test\b/i, "Testing")
    .replace(/^make\b/i, "Making")
    .replace(/^explain\b/i, "Explaining")
    .replace(/^promote\b/i, "Promoting")
    .replace(/\bsmoke-test\b/i, "smoke-testing");
}

export function looksLikeTypedPromptEcho(value?: string | null) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^\s*[›❯]/.test(text)) return true;
  if (/(?:^|\s)\/[a-z][\w-]*\b/i.test(text)) return true;
  return /^(?:run|use|try|ask|tell|say|write|fix|add|update|review)\s+\/[a-z][\w-]*\b/i.test(text);
}

/**
 * A scraped transcript line that reads as narrative prose — a sentence the agent or
 * operator wrote — rather than a short, scannable task label. These slip past
 * `isGenericTaskTitle` (which only knows a fixed allow-list) but must NEVER become the
 * header title: they are long, they describe past chatter instead of the current task,
 * and the same line tends to get surfaced into both `task` and `now`, producing the
 * duplicated, truncated headers operators reported. When detected we fall back to the
 * neutral run-state title instead. Deliberately conservative so real labels like
 * "Improving terminal-summary visual headers" or "frontend build passed" are kept. (TC-033)
 */
export function looksLikeNarrativeProse(value?: string | null) {
  const text = cleanText(value);
  if (!text) return false;
  // Real task labels stay short; anything long enough to need truncation is prose.
  if (text.length > 56) return true;
  const words = text.split(" ");
  // Narration openers a task label would not start with.
  if (/^(?:what|here|there|this|that|i['’]m|i am|i|we|you|now|so|the|it|but|and|because)$/i.test(words[0] ?? "")) {
    return true;
  }
  // Ends like a sentence (period/!/? optionally closed by a quote/bracket) AND multi-word.
  if (words.length > 4 && /[.!?]["')\]]?$/.test(text)) return true;
  // Has a clause verb in the middle of a long line — reads as a sentence, not a label.
  if (words.length > 7 && /\b(?:was|were|is|are|been|sat|which|that|because|while)\b/i.test(text)) {
    return true;
  }
  return false;
}

/**
 * Keep `now` from echoing the title. A heuristic scrape often surfaces the same line
 * into both fields; when that happens the duplicate carries no new information, so we
 * collapse it to a short run-state detail. Use only for heuristic/scraped summaries;
 * real task summaries should keep their explicit current activity. (TC-033)
 */
function dedupedNow(title: string, now: string | undefined, idleFallback = "Awaiting command") {
  const detail = cleanText(now);
  if (!detail) return idleFallback;
  if (/^(Thinking about|Working on|Waiting for|Running|Testing|Building|Checking|Reviewing)\b/i.test(detail)) {
    return boundedTitle(detail);
  }
  if (repeatsTitle(title, detail) || looksLikeNarrativeProse(detail)) return idleFallback;
  return boundedTitle(detail);
}

function normalizePurposeTitle(value?: string | null) {
  const text = cleanText(value)
    ?.replace(/^\[[^\]]+\]\s*/, "")
    .replace(/^([A-Z]+-\d+)\s*[-:]\s*/i, "")
    .replace(/\s{2,}/g, " ");
  if (!text || isGenericTaskTitle(text)) return undefined;
  // Unsubstituted prompt-box placeholders (`@filename`, `@filepath`, `@directory` …) are
  // input-box chrome, not a real task the agent is doing — never surface them as a title.
  // This is what produced bogus headers like "Improve documentation in @filename". (TC-035)
  if (/@(?:filename|filepath|file|directory|folder|selection)\b/i.test(text)) return undefined;
  return boundedTitle(text);
}

function titleCasePhrase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function purposeFromTranscriptLine(line: string) {
  const text = cleanText(line);
  if (!text) return undefined;
  if (
    /^(?:Ran|Run|Working|Viewed Image|Edited|Explored|Auto-reviewer|✓|•|gpt[-\w. ]+ default)\b/i.test(
      text,
    )
  )
    return undefined;
  if (/\b(?:npm|pnpm|yarn|npx|cargo|git|xdotool|import|xclip)\b/i.test(text))
    return undefined;
  if (/^(?:reverse-i-search|bck-i-search|fwd-i-search):/i.test(text))
    return undefined;

  const promptText = text.match(/^[›❯]\s*(.+)$/)?.[1];
  if (promptText) {
    // Reject prompt-box chrome / placeholder hints (slash-command suggestions like
    // "Use /skills to list available skills", or bare "/cmd …"); these are not a
    // user task and must not override the real summarized title (TC-033 T5).
    if (
      /^use\s+\/[a-z]/i.test(promptText) ||
      /^\/[a-z][\w-]*\b/i.test(promptText) ||
      looksLikeTypedPromptEcho(promptText) ||
      /\blist available (?:skills|commands)\b/i.test(promptText)
    ) {
      return undefined;
    }
    if (/^Write tests for @filename$/i.test(promptText))
      return "Writing tests for selected file";
    if (
      /\bcopy\b.*\bpast(?:e|ing)\b.*\bmemory\b|\bload\b.*\bmemory\b/i.test(
        promptText,
      )
    ) {
      return "Saving copy/paste task to memory";
    }
    if (/\b(?:unclear|not clear|confusing|hard to understand)\b/i.test(promptText)) {
      return "Clarifying terminal header state";
    }
    if (
      /\b(?:npm|pnpm|yarn|npx|cargo|git|xdotool|import|xclip)\b/i.test(
        promptText,
      )
    )
      return undefined;
    // Only accept a typed prompt as the purpose when it reads as an actionable task.
    // Arbitrary input-box text or gibberish (e.g. "sfgdsafgd ||> …") must defer to
    // the extracted summary rather than override the header title (TC-033 T5).
    if (
      !/\b(?:fix|fixing|improve|improving|add|adding|implement|implementing|build|building|verify|verifying|refactor|refactoring|write|writing|update|updating|create|creating|translate|translating|debug|debugging|investigate|investigating|review|reviewing|migrate|migrating|test|testing|remove|removing|rename|renaming|wire|wiring|make|making|explain|explaining)\b/i.test(
        promptText,
      )
    ) {
      return undefined;
    }
    const normalizedPrompt = normalizePurposeTitle(activeFormTitle(promptText));
    return normalizedPrompt;
  }

  const visualVerify = text.match(
    /\bvisually verify\s+(.{4,80}?)(?:\.|,|$)/i,
  )?.[1];
  if (visualVerify) return `Verifying ${titleCasePhrase(visualVerify)}`;

  if (/headed text paste and image paste/i.test(text))
    return "Verifying headed text and image paste";
  if (/image-only paste/i.test(text)) return "Improving image paste handling";
  if (/headed image[-\s]?paste verification/i.test(text))
    return "Verifying headed image paste";
  if (/bracketed paste/i.test(text)) return "Verifying bracketed paste";
  const searchMatch = text.match(/^Search\s+(.{4,80})$/i);
  if (searchMatch?.[1]) {
    return `Searching ${searchMatch[1].trim()}`;
  }
  if (
    /terminal[-\s]?summary.*visual headers?|visual.*terminal[-\s]?summary.*headers?/i.test(
      text,
    )
  ) {
    return "Improving terminal-summary visual headers";
  }

  const requestedVerification = text.match(
    /\brequested\s+(.{4,80}?)\s+verification\b/i,
  )?.[1];
  if (requestedVerification)
    return `Verifying ${titleCasePhrase(requestedVerification)}`;

  const fixingMatch = text.match(
    /\b(?:fix|fixing|improve|improving)\s+(.{6,80}?)(?:\.|,|$)/i,
  );
  if (
    fixingMatch &&
    /\b(summary|header|terminal|paste|map|visual)\b/i.test(fixingMatch[1])
  ) {
    return `${text.toLowerCase().includes("improv") ? "Improving" : "Fixing"} ${fixingMatch[1].replace(/\.$/, "").trim()}`;
  }

  return undefined;
}

function purposeFromTranscript(output?: string | null) {
  if (!output) return undefined;
  const lines = output
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line));
  let lastWorkingIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^(?:[•●]\s*)?(?:Working\s+\(|Worked for\b)/i.test(lines[index])) {
      lastWorkingIndex = index;
      break;
    }
  }
  const findPurpose = (candidates: string[], promptOnly = false) => {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const line = candidates[index];
      if (/^(?:reverse-i-search|bck-i-search|fwd-i-search):/i.test(line))
        continue;
      if (promptOnly && !/^[›❯]\s+/.test(line)) continue;
      const title = normalizePurposeTitle(purposeFromTranscriptLine(line));
      if (title) return title;
    }
    return undefined;
  };
  // Without an active/just-finished agent marker, transcript lines are just scrollback.
  // Promoting them to a terminal purpose is what makes old prompts reappear as the
  // current task when the user scrolls or reopens a terminal.
  if (lastWorkingIndex < 0) return undefined;
  const afterWorking = findPurpose(lines.slice(lastWorkingIndex + 1));
  if (afterWorking) return afterWorking;
  const promptBeforeWorking = findPurpose(lines.slice(Math.max(0, lastWorkingIndex - 8), lastWorkingIndex), true);
  if (promptBeforeWorking) return promptBeforeWorking;
  return undefined;
}

export function terminalPurposeFromContext(input: {
  stored?: TerminalPurpose;
  boundTaskTitle?: string;
  workstreamTitle?: string;
  activeTaskTitle?: string;
  manualTitle?: string;
  terminalOutput?: string;
  now?: number;
}): TerminalPurpose | undefined {
  const now = input.now ?? Date.now();
  const manualTitle = normalizePurposeTitle(input.manualTitle);
  if (manualTitle)
    return { title: manualTitle, source: "manual", updatedAt: now };

  const boundTaskTitle = normalizePurposeTitle(input.boundTaskTitle);
  if (boundTaskTitle)
    return { title: boundTaskTitle, source: "task-binding", updatedAt: now };

  const workstreamTitle = normalizePurposeTitle(input.workstreamTitle);
  if (workstreamTitle)
    return { title: workstreamTitle, source: "workstream", updatedAt: now };

  if (/\bGoal paused\s*\(\/goal resume\)/i.test(input.terminalOutput ?? "")) {
    return { title: "Resume paused agent goal", source: "inferred", updatedAt: now };
  }

  const operatorPromptTitle = terminalPurposeFromOperatorPrompt(input.terminalOutput)?.title;
  if (operatorPromptTitle)
    return { title: operatorPromptTitle, source: "inferred", updatedAt: now };

  const servicePurposeTitle = terminalPurposeFromServiceOutput(input.terminalOutput)?.title;
  if (servicePurposeTitle)
    return { title: servicePurposeTitle, source: "inferred", updatedAt: now };

  const transcriptTitle = purposeFromTranscript(input.terminalOutput);
  if (transcriptTitle && isGenericVerificationTaskTitle(input.activeTaskTitle))
    return { title: transcriptTitle, source: "inferred", updatedAt: now };

  const activeTaskTitle = normalizePurposeTitle(input.activeTaskTitle);
  if (activeTaskTitle)
    return { title: activeTaskTitle, source: "inferred", updatedAt: now };

  if (transcriptTitle)
    return { title: transcriptTitle, source: "inferred", updatedAt: now };

  const storedTitle = normalizePurposeTitle(input.stored?.title);
  if (storedTitle && input.stored)
    return {
      title: storedTitle,
      source: input.stored.source,
      updatedAt: input.stored.updatedAt ?? now,
    };

  return undefined;
}

export function applyTerminalPurpose(
  summary: WorkstreamStatusSummary,
  purpose?: TerminalPurpose,
): WorkstreamStatusSummary {
  if (!purpose) return summary;
  return {
    ...summary,
    task: purpose.title,
    userTask: purpose.title,
    confidence: "high",
  };
}

function supportingFocus(extractedSummary?: WorkstreamStatusSummary) {
  const text = [
    extractedSummary?.task,
    ...(extractedSummary?.tasks?.map((task) => task.text) ?? []),
    extractedSummary?.now,
  ]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(" ");

  if (!text || isGenericTaskTitle(text)) return undefined;
  const terminalSummary =
    /\bterminal[-\s]?summar(?:y|ies)|summary headers?|operator-useful terminal/i.test(
      text,
    );
  const map = /\bmap|card|canvas/i.test(text);
  if (terminalSummary && map) return "terminal-summary-map";
  if (terminalSummary) return "terminal-summary";
  if (map) return "map";
  return undefined;
}

function supportingGoalTitle(extractedSummary?: WorkstreamStatusSummary) {
  const text = [
    extractedSummary?.task,
    ...(extractedSummary?.tasks?.map((task) => task.text) ?? []),
    extractedSummary?.now,
  ]
    .map((value) => cleanText(value))
    .filter(Boolean)
    .join(" ");

  if (!text || isGenericTaskTitle(text)) return undefined;
  const terminalSummary =
    /\bterminal[-\s]?summar(?:y|ies)|summary headers?|operator-useful terminal/i.test(
      text,
    );
  const visualHeader = /\bvisual|surface|header|title|glance|scann/i.test(text);
  const map = /\bmap|card|canvas/i.test(text);
  if (terminalSummary && visualHeader)
    return "Improving terminal-summary visual headers";
  if (terminalSummary && map) return "Improving terminal-summary map headers";
  if (terminalSummary) return "Improving terminal-summary behavior";
  if (map && visualHeader) return "Improving map terminal headers";
  return undefined;
}

function contextualActivityTitle(
  activity: TerminalActivitySummary,
  extractedSummary?: WorkstreamStatusSummary,
) {
  const goalTitle = supportingGoalTitle(extractedSummary);
  if (goalTitle) return goalTitle;

  const focus = supportingFocus(extractedSummary);
  const command = activity.command ?? "";
  const subtitle = cleanText(activity.subtitle);
  const isMapVerifier =
    /verify:map-terminals/i.test(command) ||
    /^Verifying map terminals$/i.test(activity.title) ||
    /^Checking map terminal source contract$/i.test(activity.title);
  if (isMapVerifier) {
    if (focus === "terminal-summary-map" || focus === "terminal-summary")
      return "Validating terminal-summary behavior on map cards";
    return "Validating map terminal behavior";
  }

  const isStatusSummaryVerifier =
    /verify:agent-status-summary/i.test(command) ||
    /^Verifying agent status summary$/i.test(activity.title) ||
    /^Checking status summary server contract$/i.test(activity.title);
  if (isStatusSummaryVerifier) {
    if (focus === "terminal-summary-map" || focus === "terminal-summary")
      return "Validating terminal-summary status extraction";
    return "Validating status-summary extraction";
  }

  const isTerminalSummaryVisualVerifier =
    /verify:terminal-summary-visual/i.test(command) ||
    /^Checking terminal summary visual headers$/i.test(activity.title) ||
    /^Terminal summary visual checks (?:passed|failed)$/i.test(activity.title);
  if (isTerminalSummaryVisualVerifier) {
    return "Improving terminal-summary visual headers";
  }

  const isBracketedPasteVerifier =
    /verify:bracketed-paste/i.test(command) ||
    /^Checking bracketed paste$/i.test(activity.title) ||
    /^bracketed paste checks (?:passed|failed)$/i.test(activity.title);
  if (isBracketedPasteVerifier) {
    return "Checking bracketed paste";
  }

  const isBuild =
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/i.test(command) ||
    /^Building frontend$/i.test(activity.title);
  if (isBuild) {
    if (focus === "terminal-summary-map" || focus === "terminal-summary")
      return "Building terminal-summary UI changes";
    if (focus === "map") return "Building map terminal UI changes";
    return "Checking frontend build";
  }

  const genericPlaywright = activity.title.match(
    /^Playwright tests (passed|failed)$/i,
  );
  const mapCard =
    /map card rendering contract/i.test(subtitle ?? "") ||
    /map-terminal-rendering\.spec/i.test(activity.targetPath ?? command);
  const statusSummary =
    /terminal status summary contract/i.test(subtitle ?? "") ||
    /agent-status-summary\.spec/i.test(activity.targetPath ?? command);
  if (genericPlaywright && mapCard) {
    if (focus === "terminal-summary-map" || focus === "terminal-summary")
      return "Validating terminal-summary behavior on map cards";
    return "Validating map terminal rendering behavior";
  }
  if (genericPlaywright && statusSummary) {
    if (focus === "terminal-summary-map" || focus === "terminal-summary")
      return "Validating terminal-summary wording rules";
    return "Validating activity summary wording";
  }

  return undefined;
}

function commandResultNow(activity: TerminalActivitySummary) {
  const command = activity.command ?? "";
  const subtitle = cleanText(activity.subtitle);
  const passed =
    activity.status === "success" ||
    /\bpassed\b|_OK\b|built in\b/i.test(subtitle ?? "");
  const failed =
    activity.status === "error" || /\bfailed\b|\berror\b/i.test(subtitle ?? "");
  if (
    /verify:map-terminals/i.test(command) ||
    /^Verifying map terminals$/i.test(activity.title) ||
    /^Checking map terminal source contract$/i.test(activity.title)
  ) {
    if (passed) return "map terminal source checks passed";
    if (failed) return "map terminal source checks failed";
    return "running live map terminal source checks";
  }
  if (
    /verify:agent-status-summary/i.test(command) ||
    /^Verifying agent status summary$/i.test(activity.title) ||
    /^Checking status summary server contract$/i.test(activity.title)
  ) {
    if (passed) return "status summary server checks passed";
    if (failed) return "status summary server checks failed";
    return "checking local status summary server contract";
  }
  if (
    /verify:terminal-summary-visual/i.test(command) ||
    /^Checking terminal summary visual headers$/i.test(activity.title) ||
    /^Terminal summary visual checks (?:passed|failed)$/i.test(activity.title)
  ) {
    if (passed) return "terminal summary visual checks passed";
    if (failed) return "terminal summary visual checks failed";
    return "checking headed terminal summary visual contract";
  }
  if (
    /verify:bracketed-paste/i.test(command) ||
    /^Checking bracketed paste$/i.test(activity.title) ||
    /^bracketed paste checks (?:passed|failed)$/i.test(activity.title)
  ) {
    if (passed) return "bracketed paste checks passed";
    if (failed) return "bracketed paste checks failed";
    return "running bracketed paste verification";
  }
  const genericVerify = command.match(
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?verify:([\w:-]+)/i,
  )?.[1];
  if (genericVerify) {
    const label = genericVerify.replace(/[-_:]+/g, " ");
    if (passed) return `${label} checks passed`;
    if (failed) return `${label} checks failed`;
    return `running ${label} verification`;
  }
  if (
    /\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/i.test(command) ||
    /^Building frontend$/i.test(activity.title)
  ) {
    if (passed) return "frontend build passed";
    if (failed) return "frontend build failed";
    return "building TypeScript and Vite production bundle";
  }
  return undefined;
}

function displayTitle(
  activity: TerminalActivitySummary,
  displayPath: string,
  extractedSummary?: WorkstreamStatusSummary,
) {
  if (
    extractedSummary?.status === "waiting" &&
    cleanText(extractedSummary.now) === "Waiting for operator selection" &&
    cleanText(extractedSummary.task)
  ) {
    return boundedTitle(cleanText(extractedSummary.task) ?? "Waiting for operator selection");
  }

  const contextual = contextualActivityTitle(activity, extractedSummary);
  if (contextual) return boundedTitle(contextual);

  const command = activity.command ?? "";
  const subtitle = cleanText(activity.subtitle);
  if (
    /^Verifying map terminals$/i.test(activity.title) ||
    /^Checking map terminal source contract$/i.test(activity.title)
  ) {
    return "Validating map terminal behavior";
  }
  if (
    /^Verifying agent status summary$/i.test(activity.title) ||
    /^Checking status summary server contract$/i.test(activity.title)
  ) {
    return "Validating status-summary extraction";
  }
  if (/verify:map-terminals/i.test(command)) {
    return "Validating map terminal behavior";
  }

  const genericPlaywright = activity.title.match(
    /^Playwright tests (passed|failed)$/i,
  );
  if (genericPlaywright) {
    if (displayPath !== "workspace path unknown")
      return readableTitleFromPath(displayPath);
    if (subtitle && /map card rendering contract/i.test(subtitle))
      return "Validating map terminal rendering behavior";
    if (subtitle && /terminal status summary contract/i.test(subtitle))
      return "Validating activity summary wording";
  }
  if (/^Map terminal card checks (?:passed|failed)$/i.test(activity.title))
    return "Validating map terminal rendering behavior";
  if (/^Activity summary checks (?:passed|failed)$/i.test(activity.title))
    return "Validating activity summary wording";
  return boundedTitle(activity.title);
}

function normalizedPersistedTitle(summary: WorkstreamStatusSummary) {
  const task = cleanText(summary.task);
  const path = cleanPath(summary.path);
  const now = cleanText(summary.now);

  if (/^status summary server checks (?:passed|failed)$/i.test(now ?? ""))
    return "Validating status-summary extraction";
  if (
    /^Map terminal card checks (?:passed|failed)$/i.test(task ?? "") ||
    /map-terminal-rendering\.spec/i.test(path ?? "")
  ) {
    return "Validating map terminal rendering behavior";
  }
  if (
    /^Activity summary checks (?:passed|failed)$/i.test(task ?? "") ||
    /agent-status-summary\.spec/i.test(path ?? "")
  ) {
    return "Validating activity summary wording";
  }
  if (
    /^Terminal summary visual checks (?:passed|failed)$/i.test(task ?? "") ||
    /verify:terminal-summary-visual/i.test(now ?? "")
  ) {
    return "Improving terminal-summary visual headers";
  }
  if (
    /^Frontend build (?:passed|failed)$/i.test(task ?? "") ||
    /^Building frontend(?: changes)?$/i.test(task ?? "")
  ) {
    return supportingGoalTitle(summary) ?? "Checking frontend build";
  }
  return task ? boundedTitle(task) : "Terminal activity";
}

function normalizedPersistedNow(summary: WorkstreamStatusSummary, fallbackPath: string) {
  const task = cleanText(summary.task);
  const now = cleanText(summary.now);
  if (/^Map terminal card checks passed$/i.test(task ?? ""))
    return "map card rendering contract passed";
  if (/^Map terminal card checks failed$/i.test(task ?? ""))
    return "map card rendering contract failed";
  if (/^Activity summary checks passed$/i.test(task ?? ""))
    return "terminal status summary contract passed";
  if (/^Activity summary checks failed$/i.test(task ?? ""))
    return "terminal status summary contract failed";
  if (
    /^Terminal summary visual checks passed$/i.test(task ?? "") ||
    /verify:terminal-summary-visual.*passed/i.test(now ?? "")
  ) {
    return "terminal summary visual checks passed";
  }
  if (/^Terminal summary visual checks failed$/i.test(task ?? ""))
    return "terminal summary visual checks failed";
  if (
    /^Frontend build passed$/i.test(task ?? "") ||
    /^Building frontend(?: changes)?$/i.test(task ?? "")
  )
    return "frontend build passed";
  if (/^Frontend build failed$/i.test(task ?? ""))
    return "frontend build failed";
  return compatibleActivityNow(now, fallbackPath);
}

/**
 * Describe where a terminal's status summary came from so the UI can show whether
 * it is a real model summary or the deterministic heuristic fallback (the status
 * model server being offline). Returns null when no summary has run yet (TC-033 T2).
 */
export function summarySourceLabel(
  source?: "fallback" | "process" | "sidecar" | null,
  error?: string | null,
): { label: string; detail: string } | null {
  if (source === "sidecar") {
    return {
      label: "live task list",
      detail: "Read from the agent's own task list",
    };
  }
  if (source === "process") {
    return {
      label: "model summary",
      detail: "Summarized by the local status model",
    };
  }
  if (source === "fallback") {
    return {
      label: "heuristic summary",
      detail: error
        ? `Status model unavailable (${error}); showing heuristic summary`
        : "Status model offline; showing heuristic summary",
    };
  }
  return null;
}

export function normalizePersistedShellSummary(
  summary: WorkstreamStatusSummary,
  path: string,
  purpose?: TerminalPurpose,
): WorkstreamStatusSummary {
  const fallbackPath = cleanPath(path) ?? "workspace path unknown";
  return applyTerminalPurpose(
    {
      ...summary,
      task: normalizedPersistedTitle(summary),
      path: compatibleSummaryPath(cleanPath(summary.path), fallbackPath),
      now: normalizedPersistedNow(summary, fallbackPath),
      provider: "shell",
    },
    purpose,
  );
}

/**
 * When the agent has a REAL task list (its own TaskCreate/TaskUpdate, captured into the
 * status sidecar → `tasksFromTodoWrite`), the header title/now MUST be the agent's
 * current task — never the heuristic/purpose inference scraped from terminal output.
 * Reads straight from `statusSummary`, so it holds even when the task lineup hasn't
 * populated. Heuristic inference remains the fallback only when there is no real task
 * list. Shared by the split-pane header and the map node header. (TC-033)
 */
/** A clean, honest title for a pane that has no real task list — based on run state. */
export function neutralHeaderTitle(status?: string | null): string {
  switch (status) {
    case "running":
    case "reconnected":
      return "Idle";
    case "failed":
      return "Needs attention";
    case "exited":
      return "Idle";
    default:
      return "Ready";
  }
}

export function preferRealTaskSummary<T extends { task: string; now: string; narration?: string }>(
  base: T,
  statusSummary: WorkstreamStatusSummary | null | undefined,
  neutralTitle?: string,
  options?: { narrationCurrent?: boolean },
): T {
  if (statusSummary?.tasksFromTodoWrite) {
    const task = cleanText(statusSummary.task) ?? base.task;
    return {
      ...base,
      task,
      now: cleanText(statusSummary.now) ?? base.now,
    };
  }
  // A narration bullet proven CURRENT by the caller (active-work marker in the same
  // grid snapshot) IS the trustworthy current step: keep it on the now line and give
  // the task slot the neutral run-state word (the Task row carries the goal).
  const currentNarration = options?.narrationCurrent
    ? cleanText(base.narration ?? statusSummary?.narration)
    : undefined;
  if (currentNarration) {
    return {
      ...base,
      task: neutralTitle ?? base.task,
      now: currentNarration,
    };
  }
  // No task list means no trustworthy title. STALE narration is transcript text from a
  // previous turn, and promoting it here is what made old agent sentences look like the
  // terminal's current task after relaunch/scrollback recovery.
  const narration = cleanText(statusSummary?.narration);
  if (narration && neutralTitle) {
    return {
      ...base,
      task: neutralTitle,
      now: neutralTitle,
    };
  }
  // No real task list and no narration → the title is a best-effort heuristic scrape.
  // Replace it with the neutral run-state title when it is generic, reads as narrative
  // prose, or merely echoes the `now` detail — none of those are a trustworthy task
  // label, and surfacing them produces the long, duplicated headers we guard against.
  // Durable activity / persisted summaries with a real contextual title are kept. (TC-033)
  if (
    neutralTitle &&
    base.task !== "Ready" &&
    (isGenericTaskTitle(base.task) ||
      looksLikeNarrativeProse(base.task) ||
      looksLikeTypedPromptEcho(base.task) ||
      repeatsTitle(base.task, base.now))
  ) {
    return {
      ...base,
      task: neutralTitle,
      now: dedupedNow(neutralTitle, base.now, neutralTitle),
    };
  }
  return { ...base, now: dedupedNow(base.task, base.now) };
}

export function terminalActivityDetail(
  activity: TerminalActivitySummary,
  idleFallback = "Awaiting command",
) {
  const commandResult = commandResultNow(activity);
  if (commandResult) return commandResult;
  const subtitle = cleanText(activity.subtitle);
  if (subtitle && !repeatsTitle(activity.title, subtitle)) return subtitle;
  if (typeof activity.progress === "number")
    return `${Math.round(activity.progress)}% complete`;
  if (activity.status === "idle") return idleFallback;
  if (activity.status === "success") {
    return typeof activity.exitCode === "number"
      ? `Finished with exit ${activity.exitCode}`
      : "Completed";
  }
  if (activity.status === "error") {
    return typeof activity.exitCode === "number"
      ? `Stopped with exit ${activity.exitCode}`
      : "Needs attention";
  }
  if (activity.status === "cancelled") return "Cancelled";
  return activity.command ? "Command is running" : "Activity in progress";
}

export function summaryFromDurableActivity(
  activity: TerminalActivitySummary,
  path: string,
  extractedSummary?: WorkstreamStatusSummary,
  purpose?: TerminalPurpose,
): WorkstreamStatusSummary {
  const displayPath =
    cleanPath(activity.targetPath) ??
    pathFromCommand(activity.command) ??
    cleanPath(path) ??
    cleanPath(extractedSummary?.path) ??
    "workspace path unknown";

  const durableNow =
    extractedSummary?.status === "waiting" &&
    cleanText(extractedSummary.now) === "Waiting for operator selection"
      ? "Waiting for operator selection"
      :
    purpose?.source === "inferred"
      ? purpose.title
      : sanitizeTerminalHeaderNow(terminalActivityDetail(activity), displayPath);

  const durableStatus =
    extractedSummary?.status === "waiting" &&
    cleanText(extractedSummary.now) === "Waiting for operator selection"
      ? "waiting"
      : activity.status === "success"
        ? "done"
        : activity.status === "error"
          ? "blocked"
          : activity.status === "idle"
            ? "idle"
            : "working";

  return applyTerminalPurpose(
    {
      ...extractedSummary,
      task: displayTitle(activity, displayPath, extractedSummary),
      path: displayPath,
      now: durableNow,
      status: durableStatus,
      provider: "shell",
      confidence: activity.status === "idle" ? "low" : "high",
    },
    purpose,
  );
}
