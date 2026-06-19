import type { TerminalActivitySummary, TerminalRuntimeStatus } from "./types";

const OSC_PATTERN = /\x1b\](\d+);([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
const COMMAND_PATTERN = /\b(?:npx\s+)?playwright\s+test\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:build|check|lint|test|typecheck|verify:[\w:-]+)\b|\bcargo\s+(?:build|check|test)\b/i;
const MIN_TITLE_CHANGE_MS = 2500;
const MIN_PROGRESS_CHANGE_MS = 450;

export interface TerminalActivityInput {
  transcript: string;
  previous?: TerminalActivitySummary;
  runtimeStatus?: TerminalRuntimeStatus;
  cwd?: string;
  now?: number;
}

interface ShellIntegrationEvent {
  kind: "command" | "start" | "end" | "cwd" | "progress";
  command?: string;
  cwd?: string;
  title?: string;
  subtitle?: string;
  progress?: number;
  exitCode?: number;
}

function cleanText(value?: string | null) {
  return value?.replace(/\s+/g, " ").replace(/^[•*-]\s+/, "").trim() || undefined;
}

function normalizeCommand(command: string) {
  return command.replace(/\\"/g, "\"").replace(/\\'/g, "'");
}

function transcriptLines(transcript: string) {
  return transcript
    .replace(/\r/g, "\n")
    .replace(OSC_PATTERN, "")
    .split("\n")
    .map((line) => cleanText(line))
    .filter((line): line is string => Boolean(line));
}

function parseKeyValues(raw: string) {
  const values: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const [key, ...rest] = part.split("=");
    if (!key || rest.length === 0) continue;
    values[key.trim()] = rest.join("=").trim();
  }
  return values;
}

function decodeShellValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseShellIntegrationEvents(transcript: string): ShellIntegrationEvent[] {
  return [...transcript.matchAll(OSC_PATTERN)].flatMap<ShellIntegrationEvent>((match) => {
    const code = match[1];
    const payload = match[2];
    if (code !== "133" && code !== "633") return [];

    const [marker = "", ...rest] = payload.split(";");
    const body = rest.join(";");
    if (marker === "A" || marker === "B" || marker === "C") return [{ kind: "start" as const }];
    if (marker === "D") {
      const exitCode = Number.parseInt(rest[0] ?? "", 10);
      return [{ kind: "end" as const, exitCode: Number.isInteger(exitCode) ? exitCode : undefined }];
    }
    if (marker === "E") return [{ kind: "command" as const, command: cleanText(decodeShellValue(body)) ?? cleanText(body) }];
    if (marker === "P") {
      const values = parseKeyValues(body);
      return [{
        kind: "progress" as const,
        title: cleanText(values.title),
        subtitle: cleanText(values.subtitle ?? values.summary),
        progress: progressValue(values.progress),
      }];
    }
    if (marker === "7") return [{ kind: "cwd" as const, cwd: cleanText(body) }];
    return [];
  });
}

function progressValue(raw?: string) {
  if (!raw) return undefined;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(100, value));
}

function shellPromptCommand(line: string) {
  const match = line.match(/^(?:[\w.-]+@[\w.-]+:[^$#>]*|[\w.-]+|web)\s*[$#>]\s+(.+)$/i);
  return cleanText(match?.[1]);
}

function isPromptOrMenuNoise(line: string) {
  return (
    /^Working\s+\([\dmh\s.]+[•·]\s*esc to interrupt\)$/i.test(line) ||
    /^Use\s+\/\w+/i.test(line) ||
    /^›\s*Use\s+\/\w+/i.test(line) ||
    /^gpt[-\w. ]+\s+default\b/i.test(line) ||
    /^«?\s*[|│]?\s*gpt[-\w. ]+\s+default\b/i.test(line) ||
    /^Implement this plan\??$/i.test(line) ||
    /^[1-3][.)]\s+(?:Yes|No)\b/i.test(line) ||
    /Press enter to confirm or esc to go back/i.test(line) ||
    /\bPlan mode\b/i.test(line)
  );
}

function commandCandidateAt(lines: string[], index: number) {
  const line = lines[index];
  if (!line || isPromptOrMenuNoise(line)) return undefined;
  const promptCommand = shellPromptCommand(line);
  if (promptCommand && index === lines.length - 1) return undefined;
  const candidate = promptCommand ?? line;
  return COMMAND_PATTERN.test(candidate) ? candidate : undefined;
}

function lastCommandLine(lines: string[]) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const command = commandCandidateAt(lines, index);
    if (command) return command;
  }
  return undefined;
}

function quotedFlagValue(command: string, flag: string) {
  const normalized = normalizeCommand(command);
  const escaped = flag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escaped}\\s+(?:"([^"]+)"|'([^']+)'|([^\\s]+))`));
  const value = cleanText(match?.[1] ?? match?.[2] ?? match?.[3]);
  if (!value || /^["']/.test(value)) return undefined;
  return value;
}

function targetFile(command: string) {
  return normalizeCommand(command).match(/(?:^|\s)([\w./-]+\.(?:spec|test)\.(?:tsx?|jsx?))/i)?.[1];
}

function cargoManifest(command: string) {
  const normalized = normalizeCommand(command);
  const manifest = normalized.match(/--manifest-path\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/i);
  return cleanText(manifest?.[1] ?? manifest?.[2] ?? manifest?.[3]);
}

function scriptSummary(script: string) {
  if (/^verify:map-terminals$/i.test(script)) {
    return {
      title: "Checking map terminal source contract",
      detail: "live map terminal source checks",
      passedTitle: "Map terminal source checks passed",
      failedTitle: "Map terminal source checks failed",
    };
  }
  if (/^verify:agent-status-summary$/i.test(script)) {
    return {
      title: "Checking status summary server contract",
      detail: "local summary server contract",
      passedTitle: "Status summary server checks passed",
      failedTitle: "Status summary server checks failed",
    };
  }
  if (/^verify:/i.test(script)) {
    const target = script.replace(/^verify:/i, "").replace(/[-_:]+/g, " ");
    return {
      title: `Checking ${target}`,
      detail: `npm run ${script}`,
      passedTitle: `${target} checks passed`,
      failedTitle: `${target} checks failed`,
    };
  }
  if (/^build$/i.test(script)) {
    return {
      title: "Building frontend",
      detail: "TypeScript and Vite production build",
      passedTitle: "Frontend build passed",
      failedTitle: "Frontend build failed",
    };
  }
  if (/^(typecheck|check)$/i.test(script)) {
    return {
      title: "Checking TypeScript",
      detail: `npm run ${script}`,
      passedTitle: "TypeScript checks passed",
      failedTitle: "TypeScript checks failed",
    };
  }
  if (/^lint$/i.test(script)) {
    return {
      title: "Linting frontend",
      detail: "frontend lint checks",
      passedTitle: "Frontend lint passed",
      failedTitle: "Frontend lint failed",
    };
  }
  if (/^test$/i.test(script)) {
    return {
      title: "Running test suite",
      detail: "npm test",
      passedTitle: "Test suite passed",
      failedTitle: "Test suite failed",
    };
  }
  return {
    title: `Running ${script}`,
    detail: `npm run ${script}`,
    passedTitle: `${script} passed`,
    failedTitle: `${script} failed`,
  };
}

function scriptCompletionTitle(title: string, success: boolean) {
  if (/^Checking map terminal source contract$/i.test(title)) return success ? "Map terminal source checks passed" : "Map terminal source checks failed";
  if (/^Checking status summary server contract$/i.test(title)) return success ? "Status summary server checks passed" : "Status summary server checks failed";
  if (/^Building frontend$/i.test(title)) return success ? "Frontend build passed" : "Frontend build failed";
  if (/^Checking TypeScript$/i.test(title)) return success ? "TypeScript checks passed" : "TypeScript checks failed";
  if (/^Linting frontend$/i.test(title)) return success ? "Frontend lint passed" : "Frontend lint failed";
  if (/^Running test suite$/i.test(title)) return success ? "Test suite passed" : "Test suite failed";
  return undefined;
}

function humanizeSpecName(value: string) {
  const base = value.split("/").filter(Boolean).pop() ?? value;
  return base
    .replace(/\.(?:spec|test)\.(?:tsx?|jsx?)$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function activityForPlaywrightFile(value?: string) {
  const file = cleanText(value);
  if (!file) return null;
  const basename = file.split("/").filter(Boolean).pop() ?? file;
  if (/map-terminal-rendering\.spec\./i.test(basename)) {
    return {
      title: "Checking terminal cards on the map",
      detail: "map card rendering contract",
    };
  }
  if (/agent-status-summary\.spec\./i.test(basename)) {
    return {
      title: "Checking activity summary wording",
      detail: "terminal status summary contract",
    };
  }
  if (/checkout/i.test(basename)) {
    return {
      title: "Checking checkout flow",
      detail: "checkout regression",
    };
  }
  if (/login|auth|authentication|sign-in|signin/i.test(basename)) {
    return {
      title: "Checking login flow",
      detail: "authentication regression",
    };
  }
  return null;
}

function humanizeGrep(value: string) {
  const cleaned = value
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/\b(durable activity|stale transcript|header uses durable|summary.*glitch|terminal header)\b/i.test(cleaned)) {
    return "terminal header stability";
  }
  if (/\b(login|auth|authentication|sign in)\b/i.test(cleaned)) return "login flow";
  if (/\b(checkout|payment|order)\b/i.test(cleaned)) return "checkout flow";
  if (/\b(map|canvas)\b/i.test(cleaned)) return "map terminal behavior";
  return cleaned
    .replace(/^should\s+/i, "")
    .replace(/\b(header|summary|terminal|map|split|shell|playwright)\b/gi, (word) => word.toLowerCase())
    .trim();
}

function activityForPlaywrightName(value?: string) {
  const text = cleanText(value);
  if (!text) return null;
  if (/map shell header uses durable activity instead of stale transcript summary/i.test(text)) {
    return {
      title: "Verifying map card header stability",
      detail: "ignores stale transcript summaries",
    };
  }
  if (/durable terminal activity ignores prompt typing/i.test(text)) {
    return {
      title: "Verifying terminal header stability",
      detail: "ignores prompt typing and noisy output",
    };
  }
  if (/header uses durable activity/i.test(text)) {
    return {
      title: "Verifying terminal header stability",
      detail: "uses durable session activity",
    };
  }
  if (/header|summary|terminal activity/i.test(text)) {
    return {
      title: "Verifying terminal header behavior",
      detail: text.replace(/^should\s+/i, ""),
    };
  }
  if (/login|auth|authentication|sign in/i.test(text)) {
    return {
      title: "Checking login flow",
      detail: text.replace(/^should\s+/i, ""),
    };
  }
  if (/checkout|payment|order/i.test(text)) {
    return {
      title: "Checking checkout flow",
      detail: text.replace(/^should\s+/i, ""),
    };
  }
  return null;
}

function currentPlaywrightTestName(transcript: string) {
  const matches = [...transcript.matchAll(/(?:\[\d+\/\d+\]\s+)?[\w./-]+\.(?:spec|test)\.(?:tsx?|jsx?):\d+:\d+\s+›\s+(.+)/gi)];
  return cleanText(matches[matches.length - 1]?.[1]);
}

function playwrightProgressSubtitle(transcript: string) {
  const runningMatches = [...transcript.matchAll(/Running\s+(\d+)\s+tests?\s+using\s+(\d+)\s+workers?/gi)];
  const passedMatches = [...transcript.matchAll(/(\d+)\s+passed\s+\(([^)]+)\)/gi)];
  const failedMatches = [...transcript.matchAll(/(\d+)\s+failed(?:\s+\(([^)]+)\))?/gi)];
  const running = runningMatches[runningMatches.length - 1];
  const passed = passedMatches[passedMatches.length - 1];
  const failed = failedMatches[failedMatches.length - 1];
  const browser = transcript.match(/\b(chromium|firefox|webkit|chrome)\b/i)?.[1];
  if (failed) return [`${failed[1]} failed`, failed[2], browser].filter(Boolean).join(" · ");
  if (passed) return [`${passed[1]} passed`, passed[2], browser].filter(Boolean).join(" · ");
  if (running) {
    const testCount = Number.parseInt(running[1], 10);
    return [
      `${running[1]} test${testCount === 1 ? "" : "s"}`,
      `${running[2]} worker${running[2] === "1" ? "" : "s"}`,
      browser,
    ].filter(Boolean).join(" · ");
  }
  return browser ? `on ${browser}` : undefined;
}

function playwrightTitle(command: string) {
  const grep = quotedFlagValue(command, "-g") ?? quotedFlagValue(command, "--grep");
  const file = targetFile(command);
  const named = activityForPlaywrightName(grep);
  if (named) return named.title;
  if (grep) return `Verifying ${humanizeGrep(grep)}`;
  const fileActivity = activityForPlaywrightFile(file);
  if (fileActivity) return fileActivity.title;
  if (file) return `Checking ${humanizeSpecName(file)} tests`;
  return "Running Playwright tests";
}

function playwrightSubtitle(command: string, transcript: string) {
  const named = activityForPlaywrightName(currentPlaywrightTestName(transcript) ?? quotedFlagValue(command, "-g") ?? quotedFlagValue(command, "--grep"));
  const file = targetFile(command)?.split("/").filter(Boolean).pop();
  const fileActivity = activityForPlaywrightFile(file);
  const progress = playwrightProgressSubtitle(transcript);
  return [named?.detail ?? fileActivity?.detail, progress, file].filter(Boolean).join(" · ") || undefined;
}

function playwrightCompletionTitle(intent: string, success: boolean) {
  const outcome = success ? "passed" : "failed";
  if (/^Checking terminal cards on the map$/i.test(intent)) return `Map terminal card checks ${outcome}`;
  if (/^Checking activity summary wording$/i.test(intent)) return `Activity summary checks ${outcome}`;
  if (/^Checking login flow$/i.test(intent)) return `Login flow checks ${outcome}`;
  if (/^Checking checkout flow$/i.test(intent)) return `Checkout flow checks ${outcome}`;
  if (/^Verifying\s+(.+)/i.test(intent)) {
    const target = intent.replace(/^Verifying\s+/i, "");
    return success ? `${target} verified` : `${target} failed`;
  }
  if (/^Running Playwright tests$/i.test(intent)) return `Playwright tests ${outcome}`;
  return `${intent} ${outcome}`;
}

function completionTitle(previous: TerminalActivitySummary | undefined, success: boolean) {
  if (!previous) return success ? "Command completed" : "Command failed";
  const scriptCompletion = scriptCompletionTitle(previous.title, success);
  if (scriptCompletion) return scriptCompletion;
  const base = previous.title.replace(/\s+(passed|failed|completed)$/i, "");
  if (/^Verifying terminal header stability$/i.test(base)) {
    return success ? "Terminal header verification passed" : "Terminal header verification failed";
  }
  if (/^Verifying /i.test(base)) {
    return success ? `${base.replace(/^Verifying /i, "")} verified` : `${base} failed`;
  }
  return success ? `${base} completed` : `${base} failed`;
}

function summarizeCommand(command: string, transcript: string, now: number): TerminalActivitySummary {
  if (/\bplaywright\s+test\b/i.test(command)) {
    const failed = /\b\d+\s+failed\b/i.test(transcript);
    const passed = /\b\d+\s+passed\s+\([^)]+\)/i.test(transcript);
    const intent = playwrightTitle(command);
    return {
      title: passed
        ? playwrightCompletionTitle(intent, true)
        : failed
          ? playwrightCompletionTitle(intent, false)
          : intent,
      subtitle: playwrightSubtitle(command, transcript),
      targetPath: targetFile(command),
      status: failed ? "error" : passed ? "success" : "running",
      command: normalizeCommand(command),
      source: "command",
      updatedAt: now,
    };
  }

  const script = command.match(/\b(?:npm|pnpm|yarn)\s+(?:run\s+)?([^\s]+)/i)?.[1];
  if (script) {
    const summary = scriptSummary(script);
    const failed = /\b(?:failed|error)\b/i.test(transcript);
    const passed = !failed && /\b(?:passed|_OK|checks passed|built in)\b/i.test(transcript);
    return {
      title: passed ? summary.passedTitle : failed ? summary.failedTitle : summary.title,
      subtitle: summary.detail,
      status: failed ? "error" : passed ? "success" : "running",
      command: normalizeCommand(command),
      source: "command",
      updatedAt: now,
    };
  }

  const cargo = command.match(/\bcargo\s+(build|check|test)\b/i)?.[1]?.toLowerCase();
  if (cargo) {
    return {
      title: cargo === "test" ? "Testing Rust backend" : cargo === "build" ? "Building Rust backend" : "Checking Rust backend",
      subtitle: cargoManifest(command) ?? normalizeCommand(command),
      targetPath: cargoManifest(command),
      status: "running",
      command: normalizeCommand(command),
      source: "command",
      updatedAt: now,
    };
  }

  return {
    title: "Running terminal command",
    subtitle: normalizeCommand(command).slice(0, 96),
    status: "running",
    command: normalizeCommand(command),
    source: "command",
    updatedAt: now,
  };
}

function readyActivity(cwd: string | undefined, now: number): TerminalActivitySummary {
  return {
    title: "Ready",
    subtitle: cwd?.split("/").filter(Boolean).pop() ?? "Awaiting command",
    status: "idle",
    source: "system",
    updatedAt: now,
  };
}

function canChangeTitle(previous: TerminalActivitySummary | undefined, next: TerminalActivitySummary, now: number) {
  if (!previous || previous.title === next.title) return true;
  if (next.status === "success" || next.status === "error" || previous.status === "idle") return true;
  return now - previous.updatedAt >= MIN_TITLE_CHANGE_MS;
}

function shouldApply(previous: TerminalActivitySummary | undefined, next: TerminalActivitySummary, now: number) {
  if (!previous) return true;
  if (previous.title !== next.title) return canChangeTitle(previous, next, now);
  if (previous.status !== next.status) return true;
  if (previous.subtitle !== next.subtitle) return now - previous.updatedAt >= MIN_PROGRESS_CHANGE_MS;
  if (previous.progress !== next.progress) return now - previous.updatedAt >= MIN_PROGRESS_CHANGE_MS;
  return false;
}

export function deriveTerminalActivity(input: TerminalActivityInput): TerminalActivitySummary {
  const now = input.now ?? Date.now();
  const events = parseShellIntegrationEvents(input.transcript);
  const lastEvent = events[events.length - 1];
  if (lastEvent?.kind === "progress" && (lastEvent.title || lastEvent.subtitle || typeof lastEvent.progress === "number")) {
    const next: TerminalActivitySummary = {
      title: lastEvent.title ?? input.previous?.title ?? "Running terminal command",
      subtitle: lastEvent.subtitle ?? input.previous?.subtitle,
      progress: lastEvent.progress ?? input.previous?.progress,
      status: input.previous?.status === "error" || input.previous?.status === "success" ? input.previous.status : "running",
      command: input.previous?.command,
      startedAt: input.previous?.startedAt,
      source: "shell-integration",
      updatedAt: now,
    };
    return shouldApply(input.previous, next, now) ? next : input.previous ?? next;
  }
  if (lastEvent?.kind === "end") {
    const success = (lastEvent.exitCode ?? 0) === 0;
    return {
      title: completionTitle(input.previous, success),
      subtitle: typeof lastEvent.exitCode === "number" ? `exit ${lastEvent.exitCode}` : input.previous?.subtitle,
      status: success ? "success" : "error",
      command: input.previous?.command,
      startedAt: input.previous?.startedAt,
      completedAt: now,
      exitCode: lastEvent.exitCode,
      source: "shell-integration",
      updatedAt: now,
    };
  }

  const command = [...events].reverse().find((event) => event.kind === "command" && event.command)?.command ?? lastCommandLine(transcriptLines(input.transcript));
  if (command) {
    const next = summarizeCommand(command, input.transcript, now);
    next.startedAt = input.previous?.command === command ? input.previous.startedAt : now;
    if (input.runtimeStatus === "exited" && next.status === "running") next.status = "success";
    if (input.runtimeStatus === "failed" && next.status === "running") next.status = "error";
    return shouldApply(input.previous, next, now) ? next : input.previous ?? next;
  }

  if (input.runtimeStatus === "exited" && input.previous && input.previous.status === "running") {
    return { ...input.previous, status: "success", completedAt: now, updatedAt: now, source: "system" };
  }
  if (input.runtimeStatus === "failed" && input.previous && input.previous.status === "running") {
    return { ...input.previous, status: "error", completedAt: now, updatedAt: now, source: "system" };
  }

  return input.previous ?? readyActivity(input.cwd, now);
}
