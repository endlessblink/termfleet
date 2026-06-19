import type { TerminalActivitySummary, WorkstreamStatusSummary } from "./types";

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() || undefined;
}

function comparableText(value: string) {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function repeatsTitle(title: string, detail: string) {
  const titleText = comparableText(title);
  const detailText = comparableText(detail);
  if (!titleText || !detailText) return false;
  return titleText === detailText ||
    detailText.startsWith(`${titleText} `) ||
    (titleText.startsWith(`${detailText} `) && detailText.length > 12);
}

function cleanPath(value?: string | null) {
  const text = cleanText(value);
  if (!text) return undefined;
  if (/^(?:stale|unknown|workspace path unknown)$/i.test(text)) return undefined;
  return text;
}

function pathFromCommand(command?: string) {
  const normalized = command?.replace(/\\"/g, "\"").replace(/\\'/g, "'");
  if (!normalized) return undefined;
  const spec = normalized.match(/(?:^|\s)([\w./-]+\.(?:spec|test)\.(?:tsx?|jsx?))/i)?.[1];
  if (spec) return spec;
  const manifest = normalized.match(/--manifest-path\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  return cleanPath(manifest?.[1] ?? manifest?.[2] ?? manifest?.[3]);
}

function readableTitleFromPath(path: string, outcome: "passed" | "failed") {
  const file = path.split("/").filter(Boolean).pop() ?? path;
  if (/map-terminal-rendering\.spec\./i.test(file)) return `Map terminal card checks ${outcome}`;
  if (/agent-status-summary\.spec\./i.test(file)) return `Activity summary checks ${outcome}`;
  if (/checkout/i.test(file)) return `Checkout flow checks ${outcome}`;
  if (/login|auth|authentication|sign-in|signin/i.test(file)) return `Login flow checks ${outcome}`;
  const label = file
    .replace(/\.(?:spec|test)\.(?:tsx?|jsx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
  return `${label} checks ${outcome}`;
}

function isGenericTaskTitle(value?: string | null) {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /^(?:Ready|Terminal|Search|Working|Running terminal command)$/i.test(text) ||
    /^Playwright tests (?:passed|failed)$/i.test(text) ||
    /^Verifying map terminals$/i.test(text) ||
    /^Checking map terminal source contract$/i.test(text) ||
    /^Map terminal source checks (?:passed|failed)$/i.test(text) ||
    /^Status summary server checks (?:passed|failed)$/i.test(text) ||
    /^Checking status summary server contract$/i.test(text) ||
    /^Frontend build (?:passed|failed)$/i.test(text) ||
    /^Building frontend$/i.test(text)
  );
}

function supportingTask(extractedSummary?: WorkstreamStatusSummary) {
  const primary = cleanText(extractedSummary?.task);
  if (primary && !isGenericTaskTitle(primary)) return primary;
  const firstTask = cleanText(extractedSummary?.tasks?.[0]?.text.replace(/^(?:done|complete|task)\s*:\s*/i, ""));
  return firstTask && !isGenericTaskTitle(firstTask) ? firstTask : undefined;
}

function commandResultNow(activity: TerminalActivitySummary) {
  const command = activity.command ?? "";
  const subtitle = cleanText(activity.subtitle);
  const passed = activity.status === "success" || /\bpassed\b|_OK\b|built in\b/i.test(subtitle ?? "");
  const failed = activity.status === "error" || /\bfailed\b|\berror\b/i.test(subtitle ?? "");
  if (/verify:map-terminals/i.test(command) || /^Verifying map terminals$/i.test(activity.title) || /^Checking map terminal source contract$/i.test(activity.title)) {
    if (passed) return "Map terminal source checks passed";
    if (failed) return "Map terminal source checks failed";
    return "Running live map terminal source checks";
  }
  if (/verify:agent-status-summary/i.test(command) || /^Verifying agent status summary$/i.test(activity.title) || /^Checking status summary server contract$/i.test(activity.title)) {
    if (passed) return "Status summary server checks passed";
    if (failed) return "Status summary server checks failed";
    return "Checking local status summary server contract";
  }
  if (/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?build\b/i.test(command) || /^Building frontend$/i.test(activity.title)) {
    if (passed) return "Frontend build passed";
    if (failed) return "Frontend build failed";
    return "Building TypeScript and Vite production bundle";
  }
  return undefined;
}

function displayTitle(activity: TerminalActivitySummary, displayPath: string, extractedSummary?: WorkstreamStatusSummary) {
  const task = supportingTask(extractedSummary);
  if (task && (commandResultNow(activity) || isGenericTaskTitle(activity.title))) return task;

  const command = activity.command ?? "";
  const subtitle = cleanText(activity.subtitle);
  if (/^Verifying map terminals$/i.test(activity.title) || /^Checking map terminal source contract$/i.test(activity.title)) {
    if (activity.status === "success" || /\bpassed\b/i.test(subtitle ?? "")) return "Map terminal source checks passed";
    if (activity.status === "error" || /\bfailed\b/i.test(subtitle ?? "")) return "Map terminal source checks failed";
    return "Checking map terminal source contract";
  }
  if (/^Verifying agent status summary$/i.test(activity.title) || /^Checking status summary server contract$/i.test(activity.title)) {
    if (activity.status === "success" || /\bpassed\b|_OK\b/i.test(subtitle ?? "")) return "Status summary server checks passed";
    if (activity.status === "error" || /\bfailed\b/i.test(subtitle ?? "")) return "Status summary server checks failed";
    return "Checking status summary server contract";
  }
  if (/verify:map-terminals/i.test(command)) {
    if (activity.status === "success") return "Map terminal source checks passed";
    if (activity.status === "error") return "Map terminal source checks failed";
    return "Checking map terminal source contract";
  }

  const genericPlaywright = activity.title.match(/^Playwright tests (passed|failed)$/i);
  if (genericPlaywright) {
    const outcome = genericPlaywright[1].toLowerCase() as "passed" | "failed";
    if (displayPath !== "workspace path unknown") return readableTitleFromPath(displayPath, outcome);
    if (subtitle && /map card rendering contract/i.test(subtitle)) return `Map terminal card checks ${outcome}`;
    if (subtitle && /terminal status summary contract/i.test(subtitle)) return `Activity summary checks ${outcome}`;
  }
  return activity.title;
}

export function terminalActivityDetail(activity: TerminalActivitySummary, idleFallback = "Awaiting command") {
  const commandResult = commandResultNow(activity);
  if (commandResult) return commandResult;
  const subtitle = cleanText(activity.subtitle);
  if (subtitle && !repeatsTitle(activity.title, subtitle)) return subtitle;
  if (typeof activity.progress === "number") return `${Math.round(activity.progress)}% complete`;
  if (activity.status === "idle") return idleFallback;
  if (activity.status === "success") {
    return typeof activity.exitCode === "number" ? `Finished with exit ${activity.exitCode}` : "Completed";
  }
  if (activity.status === "error") {
    return typeof activity.exitCode === "number" ? `Stopped with exit ${activity.exitCode}` : "Needs attention";
  }
  if (activity.status === "cancelled") return "Cancelled";
  return activity.command ? "Command is running" : "Activity in progress";
}

export function summaryFromDurableActivity(
  activity: TerminalActivitySummary,
  path: string,
  extractedSummary?: WorkstreamStatusSummary,
): WorkstreamStatusSummary {
  const displayPath =
    cleanPath(activity.targetPath) ??
    pathFromCommand(activity.command) ??
    cleanPath(path) ??
    cleanPath(extractedSummary?.path) ??
    "workspace path unknown";

  return {
    ...extractedSummary,
    task: displayTitle(activity, displayPath, extractedSummary),
    path: displayPath,
    now: terminalActivityDetail(activity),
    status: activity.status === "success"
      ? "done"
      : activity.status === "error"
        ? "blocked"
        : activity.status === "idle"
          ? "idle"
          : "working",
    provider: "shell",
    confidence: activity.status === "idle" ? "low" : "high",
  };
}
