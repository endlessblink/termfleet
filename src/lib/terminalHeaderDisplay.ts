import type {
  TerminalActivitySummary,
  TerminalPurpose,
  WorkstreamStatusSummary,
} from "./types";

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
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
    .replace(/^build\b/i, "Building")
    .replace(/^test\b/i, "Testing");
}

export function looksLikeTypedPromptEcho(value?: string | null) {
  const text = cleanText(value);
  if (!text) return false;
  if (/^\s*›/.test(text)) return true;
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

  const promptText = text.match(/^›\s*(.+)$/)?.[1];
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
      !/\b(?:fix|fixing|improve|improving|add|adding|implement|implementing|build|building|verify|verifying|refactor|refactoring|write|writing|update|updating|create|creating|translate|translating|debug|debugging|investigate|review|reviewing|migrate|migrating|test|testing|remove|removing|rename|wire|wiring)\b/i.test(
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
    if (/^(?:Working\s+\(|Worked for\b)/i.test(lines[index])) {
      lastWorkingIndex = index;
      break;
    }
  }
  const candidateLines =
    lastWorkingIndex >= 0 ? lines.slice(lastWorkingIndex + 1) : lines;
  const findPurpose = (candidates: string[]) => {
    for (let index = candidates.length - 1; index >= 0; index -= 1) {
      const line = candidates[index];
      if (/^(?:reverse-i-search|bck-i-search|fwd-i-search):/i.test(line))
        continue;
      const title = normalizePurposeTitle(purposeFromTranscriptLine(line));
      if (title) return title;
    }
    return undefined;
  };
  return findPurpose(candidateLines) ?? findPurpose(lines);
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

  const activeTaskTitle = normalizePurposeTitle(input.activeTaskTitle);
  if (activeTaskTitle)
    return { title: activeTaskTitle, source: "inferred", updatedAt: now };

  const transcriptTitle = purposeFromTranscript(input.terminalOutput);
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

function normalizedPersistedNow(summary: WorkstreamStatusSummary) {
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
  return now ?? "Awaiting command";
}

/**
 * Describe where a terminal's status summary came from so the UI can show whether
 * it is a real model summary or the deterministic heuristic fallback (the status
 * model server being offline). Returns null when no summary has run yet (TC-033 T2).
 */
export function summarySourceLabel(
  source?: "fallback" | "process" | null,
  error?: string | null,
): { label: string; detail: string } | null {
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
  return applyTerminalPurpose(
    {
      ...summary,
      task: normalizedPersistedTitle(summary),
      path:
        cleanPath(summary.path) ?? cleanPath(path) ?? "workspace path unknown",
      now: normalizedPersistedNow(summary),
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
      return "Working";
    case "failed":
      return "Needs attention";
    case "exited":
      return "Idle";
    default:
      return "Ready";
  }
}

export function preferRealTaskSummary<T extends { task: string; now: string }>(
  base: T,
  statusSummary: WorkstreamStatusSummary | null | undefined,
  neutralTitle?: string,
): T {
  if (statusSummary?.tasksFromTodoWrite) {
    const task = cleanText(statusSummary.task) ?? base.task;
    return {
      ...base,
      task,
      now: cleanText(statusSummary.now) ?? base.now,
    };
  }
  // No task list, but the agent narrated its own work (Stop-hook transcript capture).
  // That's the model's OWN declared words — reliable, unlike a heuristic scrape — so use
  // it as the title instead of the bare "Working" neutral. The `now` line keeps the live
  // activity detail. (TC-033)
  const narration = cleanText(statusSummary?.narration);
  if (narration) {
    const task = boundedTitle(narration);
    return {
      ...base,
      task,
      now: cleanText(statusSummary?.now) ?? base.now,
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

  return applyTerminalPurpose(
    {
      ...extractedSummary,
      task: displayTitle(activity, displayPath, extractedSummary),
      path: displayPath,
      now: terminalActivityDetail(activity),
      status:
        activity.status === "success"
          ? "done"
          : activity.status === "error"
            ? "blocked"
            : activity.status === "idle"
              ? "idle"
              : "working",
      provider: "shell",
      confidence: activity.status === "idle" ? "low" : "high",
    },
    purpose,
  );
}
