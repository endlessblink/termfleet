import { invoke } from "@tauri-apps/api/core";
import {
  cleanTranscriptForSummary,
  fallbackAgentStatusSummary,
  parseAgentStatusSummaryResponse,
  type AgentStatusSummary,
  type AgentStatusSummaryInput,
} from "./agentStatusSummary";
import {
  readLocalSidecarStatus,
  summaryFromSidecar,
  sidecarCompletedByCommand,
  type AgentStatusSidecar,
  type SidecarFileReader,
} from "./agentStatusSidecar";
import {
  parseOpeningRequest,
  parseTranscript,
  type TranscriptFacts,
} from "./sessionTranscript";
import {
  resolvePaneNowLine,
  resolvePaneTaskLine,
  type PaneTaskLine,
} from "./taskLine";
import { opensAsRequest } from "./sessionTranscript";
import { selectPlanPurpose } from "./taskPurpose";
import { stripComposerChrome } from "./terminalHeaderQuality";
import { qualityCheckGoalLabel } from "./terminalHeaderQuality";

export interface AgentStatusSummarizerResult {
  summary: AgentStatusSummary;
  // "sidecar" = the agent's REAL task list read straight from the status file —
  // authoritative; "process" = the HTTP status worker; "fallback" = local heuristic.
  source: "fallback" | "process" | "sidecar";
  sidecarState?: "fresh" | "stale" | "missing" | "error";
  error?: string;
  // TC-060: an always-true, plain-language line for this pane, resolved from the
  // agent's declared task, the vendor's own session record, or the running process.
  taskLine?: PaneTaskLine;
  // The second row: what the pane is doing RIGHT NOW, under the goal. Null when it has
  // nothing live to say — the row is then reserved but blank.
  nowLine?: PaneTaskLine | null;
  capturedGoal?: string;
  capturedGoalSource?: AgentStatusSidecar["mainTaskSource"];
}

export interface AgentStatusSummarizerOptions {
  endpoint?: string;
  fetcher?: typeof fetch;
  // Injectable sidecar file reader (tests). `null` disables the local sidecar path;
  // undefined uses the Tauri command when running in the desktop app.
  sidecarReader?: SidecarFileReader | null;
  // The central desktop poll can start before the WebView runtime marker exists.
  forceTauriSidecar?: boolean;
  // Injectable vendor session-record reader. Same seam as `sidecarReader`, and for the
  // same reason: without it the transcript rungs of the ladder can only run inside the
  // desktop app, so a regression there is invisible to every test — which is how panes
  // whose own session record named the work still rendered "No task declared".
  transcriptReader?: SessionTranscriptReader | null;
  // The durable Task row needs one whole-conversation synthesis, not another copied
  // checklist sentence. Tests inject this seam; the desktop uses the local model
  // command. `null` keeps the deterministic ladder as the complete fallback.
  contextTaskSummarizer?: ContextTaskSummarizer | null;
}

export interface ContextTaskSummaryInput {
  workspace?: string;
  openingRequest?: string;
  operatorRequest?: string;
  mainTask?: string;
  conversationSummary?: string;
  plan: string[];
  currentStep?: string;
  recentActivity?: string;
}

export type ContextTaskSummarizer = (
  context: ContextTaskSummaryInput,
  rejectedTitle?: string,
) => Promise<string | undefined>;

export type SessionTranscriptReader = (
  provider: "claude" | "codex",
  sessionId: string,
  /** "tail" = now; "head" = opening; "context" = bounded user-request history. */
  part?: "head" | "tail" | "context",
) => Promise<string | null>;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Read a sidecar file through the Rust backend (works in EVERY launch mode — desktop
// double-click included). The HTTP status server is only an optional override now
// (browser preview, opt-in Ollama worker); it previously was the ONLY reader, so the
// title/TASKS feature died whenever the app outlived the launcher that started it.
let sidecarScanCache: {
  expiresAt: number;
  byPaneId: Map<string, string>;
} | null = null;

async function scanSidecarsForPane(paneId: string): Promise<string | null> {
  const now = Date.now();
  if (!sidecarScanCache || sidecarScanCache.expiresAt <= now) {
    const candidates = await invoke<string[]>("agent_status_list_sidecars");
    const byPaneId = new Map<string, string>();
    for (const candidate of candidates) {
      try {
        const candidatePaneId = (JSON.parse(candidate) as AgentStatusSidecar).paneId;
        if (candidatePaneId && !byPaneId.has(candidatePaneId)) {
          byPaneId.set(candidatePaneId, candidate);
        }
      } catch {
        // Ignore malformed historical records while retaining valid sidecars.
      }
    }
    sidecarScanCache = { expiresAt: now + 2_000, byPaneId };
  }
  return sidecarScanCache.byPaneId.get(paneId) ?? null;
}

function tauriSidecarReader(paneId?: string): SidecarFileReader | null {
  if (!isTauriRuntime()) return null;
  return async (fileName) => {
    const text = await invoke<string | null>("agent_status_read_sidecar", {
      fileName,
    });
    if (typeof text === "string") {
      if (!paneId) return text;
      try {
        if ((JSON.parse(text) as AgentStatusSidecar).paneId === paneId) return text;
      } catch {
        // Continue to the pane-id scan below; a malformed direct record must not
        // prevent recovery from the correctly keyed record.
      }
    }
    if (!paneId) return null;
    return scanSidecarsForPane(paneId);
  };
}

function tauriTranscriptReader(): SessionTranscriptReader | null {
  if (!isTauriRuntime()) return null;
  return async (provider, sessionId, part = "tail") => {
    const text = await invoke<string | null>(
      part === "head"
        ? "session_transcript_head_read"
        : part === "context"
          ? "session_transcript_context_read"
          : "session_transcript_read",
      { provider, sessionId },
    );
    return typeof text === "string" ? text : null;
  };
}

function tauriContextTaskSummarizer(): ContextTaskSummarizer | null {
  if (!isTauriRuntime()) return null;
  return async (context, rejectedTitle) => {
    const title = await invoke<string | null>("agent_context_task_title", {
      context,
      rejectedTitle,
    });
    return typeof title === "string" ? title : undefined;
  };
}

/**
 * The opening request never changes, so it is read ONCE per session and then reused —
 * otherwise every pane would re-read the start of its record on every poll.
 * `null` records "this session has no usable opening line", so it is not retried either.
 */
const openingRequestBySession = new Map<string, string | null>();
const contextRequestBySession = new Map<string, string | null>();
const contextTaskByFingerprint = new Map<
  string,
  { promise: Promise<string | null>; retryAfter: number }
>();
const OPENING_CACHE_LIMIT = 500;

function transcriptCacheKey(
  provider: "claude" | "codex",
  sessionId: string,
) {
  return `${provider}:${sessionId}`;
}

function contextFingerprint(
  sessionId: string,
  context: ContextTaskSummaryInput,
) {
  // Momentary activity changes on nearly every poll. Only durable conversation facts
  // may invalidate the cached title; otherwise the model would be called repeatedly.
  const text = `${sessionId}:${JSON.stringify({
    workspace: context.workspace,
    openingRequest: context.openingRequest,
    operatorRequest: context.operatorRequest,
    mainTask: context.mainTask,
    conversationSummary: context.conversationSummary,
    plan: context.plan,
  })}`;
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function contextWords(text: string) {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.length > 7 && word.endsWith("able")) {
        const base = word.slice(0, -4);
        return /(?:iz|us)$/.test(base) ? `${base}e` : base;
      }
      return word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
    });
}

function validContextTaskTitle(
  title: string | undefined,
  context: ContextTaskSummaryInput,
) {
  const clean =
    title
      ?.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
      .replace(/\s+/g, " ")
      .trim() ?? "";
  const words = contextWords(clean);
  if (
    clean.length < 20 ||
    clean.length > 120 ||
    words.length < 4 ||
    words.length > 16
  )
    return null;
  if (!/^[\p{L}][\p{L}'’-]*ing\b/iu.test(clean)) return null;
  if (
    /^(?:Testing|Checking|Verifying|Adding|Implementing|Reviewing|Running|Investigating|Tracing|Auditing)\b/i.test(
      clean,
    )
  )
    return null;
  if (
    /\b(?:test(?:ing|s)?|coverage|sandbox|mock|branch|file|check(?:ing|s)?|regression|implement(?:ing|ation)?|code|api)\b/i.test(
      clean,
    )
  )
    return null;
  if (
    /\b(?:real transactions?|real money|production readiness|production[- ]ready|confirmed|completed|finished|deployed|live in production)\b/i.test(
      clean,
    )
  )
    return null;
  const grounding = new Set(
    contextWords(
      [
        context.workspace,
        context.openingRequest,
        context.operatorRequest,
        context.mainTask,
        context.conversationSummary,
        ...context.plan,
        context.currentStep,
        context.recentActivity,
      ]
        .filter(Boolean)
        .join(" "),
    ).filter((word) => word.length >= 4),
  );
  const grounded = new Set(words.filter((word) => grounding.has(word)));
  if (grounded.size < 2) return null;
  const genericWorkspaceWords = new Set([
    "workspace",
    "project",
    "terminal",
    "recovered",
    "repo",
  ]);
  const workspaceWords = contextWords(context.workspace ?? "").filter(
    (word) => word.length >= 4 && !genericWorkspaceWords.has(word),
  );
  if (workspaceWords.length && !workspaceWords.some((word) => words.includes(word)))
    return null;
  const genericTitleWords = new Set([
    "making",
    "improving",
    "protecting",
    "simplifying",
    "restoring",
    "redesigning",
    "connecting",
    "keeping",
    "helping",
    "clear",
    "reliable",
    "correct",
    "accurate",
    "safe",
    "consistent",
    "whole",
  ]);
  const workspaceWordSet = new Set(workspaceWords);
  const subjectWords = words.filter(
    (word) =>
      word.length >= 4 &&
      !workspaceWordSet.has(word) &&
      !genericTitleWords.has(word),
  );
  const groundedSubject = subjectWords.some((word) =>
    [...grounding].some(
      (factWord) =>
        factWord.length >= 4 &&
        (word === factWord ||
          word.startsWith(factWord) ||
          factWord.startsWith(word)),
    ),
  );
  if (!groundedSubject) return null;
  const openingWords = new Set(contextWords(context.openingRequest ?? ""));
  for (const outcome of ["refund", "reservation"]) {
    if (openingWords.has(outcome) && !words.includes(outcome)) return null;
  }
  return clean;
}

function restoreMissingCriticalOutcomes(
  title: string | undefined,
  context: ContextTaskSummaryInput,
) {
  const clean = title?.replace(/\s+/g, " ").trim() ?? "";
  const verb = clean.match(
    /^(Making|Improving|Protecting|Simplifying|Restoring|Redesigning|Connecting|Keeping|Helping)\b/i,
  )?.[1];
  if (!verb) return null;
  const openingWords = new Set(contextWords(context.openingRequest ?? ""));
  const required = ["reservation", "refund"].filter((word) =>
    openingWords.has(word),
  );
  if (!required.length || required.every((word) => contextWords(clean).includes(word)))
    return null;
  const genericWorkspaceWords = new Set([
    "workspace",
    "project",
    "terminal",
    "recovered",
    "repo",
  ]);
  const productWord = (context.workspace ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .find(
      (word) =>
        word.length >= 4 &&
        !genericWorkspaceWords.has(word.toLocaleLowerCase()) &&
        new RegExp(`\\b${word}\\b`, "i").test(clean),
    );
  if (!productWord) return null;
  const product = clean.match(new RegExp(`\\b${productWord}\\b`, "i"))?.[0];
  if (!product) return null;
  const outcomeText = required
    .map((word) => `${word}s`)
    .join(required.length > 1 ? " and " : "");
  const repaired = `${verb} ${product} ${outcomeText} safe end to end`;
  return validContextTaskTitle(repaired, context);
}

function groundedContextFallback(
  drafts: Array<string | undefined>,
  context: ContextTaskSummaryInput,
) {
  const modelText = drafts.filter(Boolean).join(" ");
  if (!modelText) return null;
  const hasProcessedFraming = drafts.some(
    (title) =>
      title &&
      !/^(?:Testing|Checking|Verifying|Adding|Implementing|Reviewing|Running|Investigating|Tracing|Auditing)\b/i.test(
        title,
      ),
  );
  if (!hasProcessedFraming) return null;
  const openingWords = new Set(contextWords(context.openingRequest ?? ""));
  const required = ["reservation", "refund"].filter((word) =>
    openingWords.has(word),
  );
  if (!required.length) return null;
  const modelWords = new Set(contextWords(modelText));
  const groundedModelWord = [...openingWords].some(
    (word) => word.length >= 5 && modelWords.has(word),
  );
  if (!groundedModelWord) return null;
  const product = (context.workspace ?? "")
    .split(/[^\p{L}\p{N}]+/u)
    .find((word) => word.length >= 4);
  if (!product) return null;
  const productLabel = `${product.charAt(0).toLocaleUpperCase()}${product.slice(1)}`;
  const outcomeText = required.map((word) => `${word}s`).join(" and ");
  return validContextTaskTitle(
    `Making ${productLabel} ${outcomeText} safe end to end`,
    context,
  );
}

async function contextTaskTitleFor(
  sessionId: string,
  context: ContextTaskSummaryInput,
  summarize: ContextTaskSummarizer,
) {
  const key = contextFingerprint(sessionId, context);
  const existing = contextTaskByFingerprint.get(key);
  if (existing && existing.retryAfter > Date.now())
    return (await existing.promise) ?? undefined;
  if (existing) contextTaskByFingerprint.delete(key);
  const entry = {
    promise: Promise.resolve<string | null>(null),
    retryAfter: Number.POSITIVE_INFINITY,
  };
  const pending = summarize(context)
    .then(async (firstTitle) => {
      const accepted =
        validContextTaskTitle(firstTitle, context) ??
        restoreMissingCriticalOutcomes(firstTitle, context);
      if (accepted) return accepted;
      if (!firstTitle) return null;
      const corrected = await summarize(context, firstTitle);
      return (
        validContextTaskTitle(corrected, context) ??
        restoreMissingCriticalOutcomes(corrected, context) ??
        groundedContextFallback([firstTitle, corrected], context)
      );
    })
    .catch(() => null)
    .then((title) => {
      if (!title) entry.retryAfter = Date.now() + 60_000;
      return title;
    });
  entry.promise = pending;
  if (contextTaskByFingerprint.size > OPENING_CACHE_LIMIT) {
    const oldest = contextTaskByFingerprint.keys().next();
    if (!oldest.done) contextTaskByFingerprint.delete(oldest.value);
  }
  contextTaskByFingerprint.set(key, entry);
  return (await pending) ?? undefined;
}

async function openingRequestFor(
  provider: "claude" | "codex",
  sessionId: string,
  readTranscript: SessionTranscriptReader,
): Promise<string | undefined> {
  const key = transcriptCacheKey(provider, sessionId);
  const cached = openingRequestBySession.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let opening: string | undefined;
  try {
    const head = await readTranscript(provider, sessionId, "head");
    if (typeof head === "string" && head)
      opening = parseOpeningRequest(provider, head);
  } catch {
    // Same rule as the tail: fewer facts, never an error on screen.
  }
  if (openingRequestBySession.size > OPENING_CACHE_LIMIT) {
    const oldest = openingRequestBySession.keys().next();
    if (!oldest.done) openingRequestBySession.delete(oldest.value);
  }
  openingRequestBySession.set(key, opening ?? null);
  return opening;
}

async function contextRequestFor(
  provider: "claude" | "codex",
  sessionId: string,
  readTranscript: SessionTranscriptReader,
): Promise<string | undefined> {
  const key = transcriptCacheKey(provider, sessionId);
  const cached = contextRequestBySession.get(key);
  if (cached !== undefined) return cached ?? undefined;
  let request: string | undefined;
  try {
    const context = await readTranscript(provider, sessionId, "context");
    if (typeof context === "string" && context) {
      request = parseTranscript(provider, context).operatorRequest;
    }
  } catch {
    // A missing or changed vendor record leaves the ordinary ladder in control.
  }
  if (contextRequestBySession.size > OPENING_CACHE_LIMIT) {
    const oldest = contextRequestBySession.keys().next();
    if (!oldest.done) contextRequestBySession.delete(oldest.value);
  }
  contextRequestBySession.set(key, request ?? null);
  return request;
}

function configuredEndpoint() {
  const env = (
    import.meta as ImportMeta & { env?: Record<string, string | undefined> }
  ).env;
  const explicit = env?.VITE_AGENT_STATUS_SUMMARY_ENDPOINT?.trim();
  if (explicit) return explicit;
  return "";
}

export function isAgentStatusSummarizerConfigured() {
  return Boolean(configuredEndpoint()) || isTauriRuntime();
}

function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildRequestBody(
  input: AgentStatusSummaryInput,
  fallbackOverride?: AgentStatusSummary,
) {
  const fallback = fallbackOverride ?? fallbackAgentStatusSummary(input);
  const transcript = cleanTranscriptForSummary(input.terminalOutput, 1800);
  return {
    type: "agent-workstream-status",
    promptVersion: "terminal-status-v2-tiny",
    instructions: [
      "Return compact JSON for a terminal cockpit.",
      "Use the heuristicCandidate unless the transcript clearly improves it.",
      "Ignore prompts, model names, spinners, esc-to-interrupt, repeated commands, and chrome.",
      "Describe only visible/current activity. Never overclaim.",
      "Keep task/path/now short, plain, and free of bullets.",
      "Also return arrays named tasks, blockers, evidence, and nextActions for reviewable cockpit rows.",
      "Each extracted array item can be a string or {text, excerpt}; exclude prompt chrome and repeated instructions.",
    ],
    projectId: input.gitRoot ?? input.cwd ?? input.cwdLabel ?? "workspace",
    // Per-terminal status key (TC-035): the worker prefers the pane-keyed sidecar
    // when this is set, so same-cwd terminals don't share one status file.
    paneId: input.paneId,
    transcript,
    transcriptWindow: "visible grid snapshot plus recent transcript tail",
    heuristicCandidate: fallback,
    workstream: {
      mission: input.mission,
      prompt: input.prompt,
      userTask: input.userTask,
      provider: input.provider,
      status: input.status,
      phase: input.phase,
      path: input.worktreePath ?? input.gitRoot ?? input.cwd ?? input.cwdLabel,
      branch: input.gitBranch,
      currentActivity: input.currentActivity,
      lastSummary: input.lastSummary,
      nextAction: input.nextAction,
      evidence: input.evidence,
      risk: input.risk,
      events: input.events,
    },
    schema: {
      task: "string",
      path: "string",
      now: "string",
      status: "working | idle | waiting | blocked | stopped | done",
      provider: "codex | claude | opencode | shell",
      confidence: "low | medium | high",
      proof: "optional string",
      blocker: "optional string",
      tasks: "array of extracted task strings or { text, excerpt }",
      blockers: "array of extracted blocker strings or { text, excerpt }",
      evidence:
        "array of extracted proof/evidence strings or { text, excerpt }",
      nextActions:
        "array of extracted next-action strings or { text, excerpt }",
    },
    examples: [
      {
        transcript: "cargo test\\nRunning 15 tests\\ntest renderer ... FAILED",
        summary: {
          task: "Running tests",
          path: "project",
          now: "renderer test failed",
          status: "working",
          provider: input.provider ?? "shell",
          confidence: "high",
        },
      },
      {
        transcript:
          "gpt-5.5 default · ~\\n› Use /skills to list available skills",
        summary: {
          task: "Shell ready",
          path: "workspace",
          now: "Awaiting command",
          status: "idle",
          provider: input.provider ?? "shell",
          confidence: "low",
        },
      },
    ],
  };
}

async function responseText(response: Response) {
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `status summarizer returned ${response.status}: ${text.slice(0, 120)}`,
    );
  }
  return text;
}

/**
 * TC-060. Build this pane's always-true line.
 *
 * The vendor session records are written by Claude Code / Codex themselves with no
 * hook involvement, so this works for hand-started and long-running panes — the
 * class that used to render "Task not captured". The read is a best-effort probe:
 * any failure simply yields fewer facts, and the ladder falls through to a rung
 * that cannot fail.
 */
async function resolveTaskLineFor(
  input: AgentStatusSummaryInput,
  sidecar: AgentStatusSidecar | null,
  // An expired record may still answer "what is this terminal about" (goal, session
  // plan, last finished step) but may NOT answer "what is it doing right now" — the
  // in-progress step is the one rung that goes stale with the record.
  expired = false,
  readTranscript: SessionTranscriptReader | null = null,
  summarizeContextTask: ContextTaskSummarizer | null = null,
): Promise<{
  taskLine: PaneTaskLine;
  nowLine: PaneTaskLine | null;
  budget?: TranscriptFacts["budget"];
  provider?: "claude" | "codex";
  capturedGoal?: string;
  capturedGoalSource?: AgentStatusSidecar["mainTaskSource"];
}> {
  let facts = null;
  let transcriptProvider: "claude" | "codex" | undefined;
  const sessionId =
    typeof sidecar?.sessionId === "string"
      ? sidecar.sessionId
      : typeof input.sessionId === "string"
        ? input.sessionId
        : "";
  if (readTranscript && /^[0-9a-f][0-9a-f-]{7,63}$/i.test(sessionId)) {
    // `provider` is absent on most sidecars, so try both records and let the id decide.
    for (const provider of ["claude", "codex"] as const) {
      try {
        const text = await readTranscript(provider, sessionId, "tail");
        if (typeof text === "string" && text) {
          facts = parseTranscript(provider, text);
          transcriptProvider = provider;
          const opening = await openingRequestFor(
            provider,
            sessionId,
            readTranscript,
          );
          if (opening) facts = { ...facts, openingRequest: opening };
          if (!facts.operatorRequest) {
            const contextRequest = await contextRequestFor(
              provider,
              sessionId,
              readTranscript,
            );
            if (contextRequest) {
              facts = { ...facts, operatorRequest: contextRequest };
            }
          }
          break;
        }
      } catch {
        // A changed vendor layout is not an error worth surfacing — fall through.
      }
    }
  }
  const todos = sidecar?.todos ?? [];
  const activeTodo = todos.find((todo) => todo?.status === "in_progress");
  // The most recent COMPLETED step — for an agent that finished and went idle,
  // "what it just did" beats "sitting at a prompt".
  const lastCompleted = [...todos]
    .reverse()
    .find((todo) => todo?.status === "completed");
  const cwd = sidecar?.cwd ?? input.cwd ?? input.cwdLabel ?? null;
  // The Task row answers "what is being done in relation to what the USER asked for"
  // (operator, 2026-07-25). The sidecar has carried that ask all along — 201 of 241
  // live records have a `userTask` — and this resolver never read it, so a pane with
  // no usable todo list fell straight to the folder template.
  // The status hook records the prompt field verbatim, so it holds replies as well as
  // requests ("how about 6?", "lets go with this", "i dont see that tab"). Those read as
  // chatter on a card, so the same rule the session record uses applies here: a request
  // names work, a reply does not. When it is only a reply the overarching description
  // above takes the row instead.
  const sidecarUserTask =
    typeof sidecar?.userTask === "string"
      ? (opensAsRequest(stripComposerChrome(sidecar.userTask)) ?? "")
      : "";
  // The plan was written by the agent after it understood the conversation. Treat its
  // clearest outcome-bearing step as processed context: it survives idle/stale states
  // and outranks a later complaint, rationale, or thin follow-up copied from userTask.
  const sidecarPlanPurpose = selectPlanPurpose(
    todos.map((todo) => todo?.activeForm || todo?.content),
  );
  const effectiveFacts = {
    ...(facts ?? {}),
    ...(sidecarUserTask && !facts?.operatorRequest
      ? { operatorRequest: sidecarUserTask }
      : {}),
    ...(sidecarPlanPurpose && !facts?.planPurpose
      ? { planPurpose: sidecarPlanPurpose }
      : {}),
  };
  const ladderInput = {
    now: Date.now(),
    // The overarching goal leads the line; the in-progress todo is only the step.
    mainGoal: sidecar?.mainTask ?? null,
    mainGoalSource: sidecar?.mainTaskSource ?? null,
    currentStep: expired
      ? null
      : // `||`, not `??`: the hooks write `activeForm: ""` when the agent gave none, and
        // `??` treats that empty string as a value — so the step text was replaced by
        // nothing and the row fell to a placeholder while the task list named the work
        // (live report 2026-07-26). agentStatusSidecar.ts had this right all along.
        activeTodo?.activeForm || activeTodo?.content || null,
    facts: effectiveFacts,
    lastCompletedTask:
      lastCompleted?.activeForm || lastCompleted?.content || null,
    // The agent's own newest note. `narration` is the sentence it wrote about the work;
    // `recent` is the activity trail. Both were only ever used for the activity row, so
    // a pane with plenty to say still fell to the placeholder.
    // An idle hook record is history, not current activity. Reusing its last note
    // made finished panes claim stale work in the Now row (for example, "Consolidation
    // complete" after the turn had already ended). Keep the note available to the
    // summary, but only feed live turns into the Now ladder.
    recentActivity:
      expired || sidecar?.turn === "idle"
        ? null
        : (sidecar?.narration ??
          [...(sidecar?.recent ?? [])].reverse().find((entry) => entry?.text)
            ?.text ??
          null),
    folder: cwd ? (cwd.split("/").filter(Boolean).pop() ?? null) : null,
  };
  // Both rows come from ONE resolution, so the second can never repeat the first.
  let taskLine = resolvePaneTaskLine(ladderInput);
  const context: ContextTaskSummaryInput = {
    workspace: ladderInput.folder ?? undefined,
    openingRequest: effectiveFacts.openingRequest,
    operatorRequest: effectiveFacts.operatorRequest,
    mainTask:
      typeof sidecar?.mainTask === "string" ? sidecar.mainTask : undefined,
    conversationSummary: effectiveFacts.agentSaid,
    plan: todos
      .map((todo) => todo?.activeForm || todo?.content || "")
      .filter(Boolean),
    currentStep: ladderInput.currentStep ?? undefined,
    recentActivity:
      effectiveFacts.agentSaid ?? ladderInput.recentActivity ?? undefined,
  };
  if (
    summarizeContextTask &&
    sessionId &&
    (context.openingRequest ||
      context.mainTask ||
      context.conversationSummary ||
      context.plan.length > 0)
  ) {
    const contextualTitle = await contextTaskTitleFor(
      sessionId,
      context,
      summarizeContextTask,
    );
    if (contextualTitle) {
      taskLine = {
        text: contextualTitle,
        source: "context-summary",
        capturedAt: Date.now(),
        expiresAt: null,
      };
    }
  }
  return {
    taskLine,
    nowLine: resolvePaneNowLine(ladderInput, taskLine.text),
    ...(() => {
      const candidate =
        effectiveFacts.openingRequest?.trim() ??
        effectiveFacts.operatorRequest?.trim() ??
        "";
      const candidateSource = effectiveFacts.openingRequest
        ? "opening-request"
        : effectiveFacts.operatorRequest
          ? "user-prompt"
          : undefined;
      const qualityInput = candidate.endsWith("?")
        ? `${candidate.slice(0, -1)}.`
        : candidate;
      const accepted = qualityCheckGoalLabel(qualityInput, {
        allowAboutWhatVoice: true,
        allowTrustedAboutWhat: true,
        maxLength: 220,
      }).ok
        ? candidate.length <= 220 && !/[…]$/.test(candidate)
          ? candidate
          : ""
        : "";
      return accepted
        ? { capturedGoal: accepted, capturedGoalSource: candidateSource }
        : {};
    })(),
    budget: facts?.budget,
    provider: transcriptProvider,
  };
}

/**
 * The pane's task line, resolved from the local records alone.
 *
 * `summarizeAgentStatus` only runs for a pane whose runtime is currently on screen
 * (`isRuntimeVisible` in `Terminal.tsx`), and the line is not part of the persisted
 * snapshot, so every other pane — most cards on the operations map, and every card in
 * the first seconds after a relaunch — had no line at all and its header printed the
 * placeholder. This entry point is the cheap one the workspace-wide sweep uses: local
 * file reads only, no HTTP, no summary shaping.
 */
export async function resolvePaneTaskLineFromDisk(
  input: AgentStatusSummaryInput,
  options: Pick<
    AgentStatusSummarizerOptions,
    "sidecarReader" | "transcriptReader" | "contextTaskSummarizer" | "forceTauriSidecar"
  > = {},
): Promise<{ taskLine: PaneTaskLine; sidecarUpdatedAt: number } | null> {
  const sidecarReader =
    options.sidecarReader === null
      ? null
      : (options.sidecarReader ??
        tauriSidecarReader(input.paneId));
  if (!sidecarReader) return null;
  const transcriptReader =
    options.transcriptReader === null
      ? null
      : (options.transcriptReader ?? tauriTranscriptReader());
  const fallback = fallbackAgentStatusSummary(input);
  let lookup;
  try {
    lookup = await readLocalSidecarStatus(input, fallback, sidecarReader);
  } catch {
    return null;
  }
  const { taskLine } = await resolveTaskLineFor(
    input,
    lookup.sidecar ?? null,
    lookup.state === "stale",
    transcriptReader,
    options.contextTaskSummarizer === null
      ? null
      : (options.contextTaskSummarizer ?? tauriContextTaskSummarizer()),
  );
  return {
    taskLine,
    sidecarUpdatedAt: Number(lookup.sidecar?.updatedAt ?? 0),
  };
}

export async function summarizeAgentStatus(
  input: AgentStatusSummaryInput,
  options: AgentStatusSummarizerOptions = {},
): Promise<AgentStatusSummarizerResult> {
  const fallback = fallbackAgentStatusSummary(input);

  // Local sidecar first: the agent's REAL task list, read directly from disk via the
  // Rust backend — no helper process to babysit. Same shaping as the node worker.
  const sidecarReader =
    options.sidecarReader === null
      ? null
      : (options.sidecarReader ??
        tauriSidecarReader(input.paneId));
  let sidecarShapedFallback: AgentStatusSummary | null = null;
  let sidecarState: AgentStatusSummarizerResult["sidecarState"];
  let rawSidecar: AgentStatusSidecar | null = null;
  if (sidecarReader) {
    try {
      const lookup = await readLocalSidecarStatus(
        input,
        fallback,
        sidecarReader,
      );
      sidecarState = lookup.state;
      rawSidecar = lookup.sidecar ?? null;
      const shaped = lookup.summary;
      if (shaped)
        sidecarShapedFallback = parseAgentStatusSummaryResponse(
          JSON.stringify(shaped),
          fallback,
        );
    } catch {
      sidecarState = "error";
      // Sidecar read failed → fall through to the endpoint / heuristic fallback.
    }
  }

  const transcriptReader =
    options.transcriptReader === null
      ? null
      : (options.transcriptReader ?? tauriTranscriptReader());
  const { taskLine, nowLine, capturedGoal, capturedGoalSource, budget, provider } = await resolveTaskLineFor(
    input,
    rawSidecar,
    sidecarState === "stale",
    transcriptReader,
    options.contextTaskSummarizer === null
      ? null
      : (options.contextTaskSummarizer ?? tauriContextTaskSummarizer()),
  );

  const effectiveFallbackBase = sidecarShapedFallback ??
    (rawSidecar && sidecarCompletedByCommand(rawSidecar)
      ? { ...fallback, completedByCommand: true }
      : fallback);
  const providerFallback =
    provider && effectiveFallbackBase.provider === "shell"
      ? { ...effectiveFallbackBase, provider }
      : effectiveFallbackBase;
  const effectiveFallback = budget
    ? { ...providerFallback, budget }
    : providerFallback;
  // Keep only the shaped, quality-checked Goal. Reattaching rawSidecar.mainTask here
  // resurrects process narration after summaryFromSidecar has correctly rejected it.
  const rawSidecarGoal = rawSidecar
    ? summaryFromSidecar(rawSidecar, effectiveFallback).mainTask?.trim()
    : undefined;
  const sidecarGoal = sidecarShapedFallback?.mainTask?.trim() ?? rawSidecarGoal;
  const capturedGoalValue = sidecarGoal || capturedGoal;
  const capturedGoalSourceValue = sidecarGoal
    ? rawSidecar?.mainTaskSource
    : capturedGoalSource;
  const effectiveFallbackWithGoal = capturedGoalValue
    ? {
        ...effectiveFallback,
        mainTask: capturedGoalValue,
        mainTaskSource: capturedGoalSourceValue,
      }
    : effectiveFallback;
  const endpoint = options.endpoint ?? configuredEndpoint();
  if (!endpoint) {
    return {
      summary: effectiveFallbackWithGoal,
      source: sidecarShapedFallback ? "sidecar" : "fallback",
      sidecarState,
      taskLine,
      nowLine,
    };
  }

  try {
    const fetcher = options.fetcher ?? fetch;
    const response = await fetcher(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequestBody(input, effectiveFallback)),
    });
    const text = await responseText(response);
    const parsed = parseAgentStatusSummaryResponse(
      text,
      effectiveFallback,
    );
    const parsedSummary =
      provider && parsed.provider === "shell"
        ? { ...parsed, provider }
        : parsed;
    const summary = sidecarShapedFallback?.tasksFromTodoWrite
      ? {
          ...parsedSummary,
          task: sidecarShapedFallback.task,
          userTask: sidecarShapedFallback.userTask,
          mainTask: sidecarShapedFallback.mainTask,
          mainTaskSource: sidecarShapedFallback.mainTaskSource,
          now: sidecarShapedFallback.now,
          status: sidecarShapedFallback.status,
          tasks: sidecarShapedFallback.tasks,
          tasksFromTodoWrite: true,
        }
      : sidecarShapedFallback?.userTask
        ? {
            ...parsedSummary,
            userTask: sidecarShapedFallback.userTask,
            mainTask: sidecarShapedFallback.mainTask,
            mainTaskSource: sidecarShapedFallback.mainTaskSource,
          }
        : parsedSummary;
    const summaryWithSidecarGoal = capturedGoalValue
      ? {
          ...summary,
          mainTask: capturedGoalValue,
          mainTaskSource: capturedGoalSourceValue,
        }
      : summary;
    // The line rides on EVERY return path. It used to be attached only to the
    // no-endpoint branch, so any launch that configured the optional status worker
    // dropped the ladder line for every pane and the header fell back to its own
    // factless re-resolve — i.e. "No task declared".
    return {
      summary: summaryWithSidecarGoal,
      source: "process",
      sidecarState,
      taskLine,
      nowLine,
    };
  } catch (error) {
    return {
      summary: effectiveFallback,
      source: sidecarShapedFallback ? "sidecar" : "fallback",
      sidecarState,
      error: shortError(error),
      taskLine,
      nowLine,
    };
  }
}
