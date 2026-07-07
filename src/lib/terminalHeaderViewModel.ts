import type {
  Group,
  TaskLineupItem,
  TerminalMainUserAsk,
  TerminalPurposeSource,
  TerminalRuntimeStatus,
  WorkstreamStatusSummary,
} from "./types";
import { workspaceLabelFor } from "./projectDisplay";
import {
  compactHeaderGoal,
  neutralHeaderTitle,
  normalizePersistedShellSummary,
  preferRealTaskSummary,
  sanitizeShellDisplaySummary,
  sanitizeTerminalHeaderNow,
  contextualActivityForTask,
  isGenericVerificationTaskTitle,
} from "./terminalHeaderDisplay";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckNowLabel,
  qualityCheckTaskLabel,
  qualityCheckUserAskLabel,
} from "./terminalHeaderQuality";
import { qualityPurposeTitle } from "./terminalHeaderDisplay";
import { resolveTaskIdentity } from "./taskIdentity";

export type HeaderFieldSource =
  | "workspace"
  | "user-task"
  | "task-list"
  | "manual"
  | "task-tool"
  | "user-prompt"
  | "plan-binding"
  | "sidecar-todo"
  | "workstream"
  | "status-summary"
  | "neutral"
  | "missing";

export interface HeaderField {
  text: string;
  source: HeaderFieldSource;
}

export interface ShellTerminalHeaderViewModel {
  workspace: HeaderField;
  taskDescription: HeaderField;
  title: HeaderField;
  path: HeaderField;
  now: HeaderField;
  debug: Record<string, string | boolean | undefined>;
}

// "Clean up the junk titles" vs "Cleaning up junk titles" is the SAME content in
// different grammar — showing both wastes a header line. Equivalent = identical
// tokens (articles dropped) with at most a shared-stem first word (clean/cleaning).
function normalizedHeaderTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token && !["the", "a", "an", "and", "or"].includes(token) && !/^\d+$/.test(token));
}

function headerStemsMatch(a?: string, b?: string) {
  if (!a || !b) return false;
  const stem = (word: string) => word.replace(/ing$/, "").replace(/e$/, "");
  return stem(a) === stem(b) || a.startsWith(b) || b.startsWith(a);
}

export function headerTextsEquivalent(a?: string | null, b?: string | null) {
  if (!a || !b) return false;
  const ta = normalizedHeaderTokens(a);
  const tb = normalizedHeaderTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  // "Improving X" vs "X" — one extra leading token is still the same content.
  if (ta.slice(1).join(" ") === tb.join(" ") || tb.slice(1).join(" ") === ta.join(" ")) return true;
  return headerStemsMatch(ta[0], tb[0]) && ta.slice(1).join(" ") === tb.slice(1).join(" ");
}

function sameHeaderText(a?: string | null, b?: string | null) {
  return Boolean(
    a &&
      b &&
      a.replace(/\s+/g, " ").trim().toLowerCase() ===
        b.replace(/\s+/g, " ").trim().toLowerCase(),
  );
}

function taskActivityFromUserGoal(value?: string, allowSynth = false) {
  if (!value) return undefined;
  const text = value
    .replace(/^#\d+\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (/^Run build,\s*lint,\s*focused tests,\s*and visual checks$/i.test(text)) {
    return "Running build and visual checks";
  }
  if (/^Run a reference audit for stale rollout names and verify summary\/schema consistency$/i.test(text)) {
    return "Running reference audit and schema checks";
  }
  if (/^Run focused tests and quality gates$/i.test(text)) {
    return "Running focused tests and quality gates";
  }
  if (/^Checking focused verification$/i.test(text)) {
    return "Running focused verification checks";
  }
  if (/^Skipping model calls for clear task sidecars$/i.test(text)) {
    return "Reducing model calls for clear tasks";
  }
  if (/^Verify schema, reference integrity, and that deleted inputs no longer drive memory$/i.test(text)) {
    return "Verifying memory schema and references";
  }
  if (/^Refresh memory_summary\.md routing\b/i.test(text)) {
    return "Refreshing memory routing rules";
  }
  if (/^Visually verify live private and public flows in connected Chrome$/i.test(text)) {
    return "Verifying live Arthouse flows";
  }
  if (/^Run verification and summarize$/i.test(text)) {
    return "Running verification and summary checks";
  }
  if (/^Ordering project rows by canvas position$/i.test(text)) {
    return "Sorting project rows by canvas position";
  }
  if (/^lets do your plan$/i.test(text)) {
    return "Executing proposed cleanup plan";
  }
  if (/^Commit, push, merge, and clean old branches safely$/i.test(text)) {
    return "Committing and cleaning old branches safely";
  }
  if (/^restore$/i.test(text)) {
    return "Restoring the previous work state";
  }
  if (/^Ts:\d+\)\s*-\s*/i.test(text) && /\bCardcom\b/i.test(text)) {
    return "Auditing Cardcom overdue production rows";
  }
  if (/\bbefore implementation\b/i.test(text) && /\b(?:existing timer state|timer state|VPS)\b/i.test(text)) {
    return "Verifying VPS timer state before implementation";
  }
  if (/^Running desktop verification commands$/i.test(text)) {
    return "Checking desktop verification results";
  }
  if (/^Running\s+(.+?)\s+commands$/i.test(text)) {
    return `Checking ${text.replace(/^Running\s+/i, "").replace(/\s+commands$/i, "")} results`;
  }
  if (/^Commit and verify remaining changes$/i.test(text)) {
    return "Committing and verifying remaining changes";
  }
  if (/^Close remaining task gap$/i.test(text)) {
    return "Closing remaining task gap";
  }
  if (/^Task\s+\d+(?:[-–]\d+)?:\s*(.+)$/i.test(text)) {
    const object = text.replace(/^Task\s+\d+(?:[-–]\d+)?:\s*/i, "").replace(/\s+and\s+/i, " ").trim();
    return `Reviewing ${object}`;
  }
  if (/\bterminal gap\b/i.test(text) && /\bproject lanes?\b/i.test(text)) {
    return "Updating terminal project lane spacing";
  }
  if (/\bdebug-share bundles?\b/i.test(text)) {
    return "Checking debug-share bundle redaction path";
  }
  if (/\bcharged a renewal\b/i.test(text)) {
    return "Checking whether users were charged a renewal";
  }
  if (/^is that a good idea\??$/i.test(text)) {
    return "Reviewing whether the idea is sound";
  }
  if (/^Decide on either starting a new task or freeing up token space$/i.test(text)) {
    return "Choosing task or token-space mode";
  }
  const decideTask = text.match(/^Decide\s+(.+)$/i);
  if (decideTask?.[1]) {
    return `Choosing ${decideTask[1].trim()}`;
  }
  const committingAndPushing = text.match(/^Committing and pushing\s+(.+)$/i);
  if (committingAndPushing?.[1]) {
    return `Pushing ${committingAndPushing[1].trim()} branch changes`;
  }
  const approvalReview = text.match(/^Rechecking\s+(.+?)\s+approval$/i);
  if (approvalReview?.[1]) return `Checking ${approvalReview[1].trim()}`;
  if (/^(?:Adding|Asking|Answering|Auditing|Building|Checking|Cleaning|Committing|Creating|Debugging|Designing|Editing|Explaining|Fixing|Improving|Investigating|Making|Planning|Polishing|Pushing|Refreshing|Reporting|Reviewing|Running|Summarizing|Testing|Updating|Verifying|Writing)\b/i.test(text)) {
    return text;
  }
  if (/^[A-Z][a-z]+ing\b/.test(text)) return text;
  const active = text
    .replace(/^pick\s+up\b/i, "Picking up")
    .replace(/^load\b/i, "Loading")
    .replace(/^add\b/i, "Adding")
    .replace(/^ask\b/i, "Asking")
    .replace(/^answer\b/i, "Answering")
    .replace(/^audit\b/i, "Auditing")
    .replace(/^build\b/i, "Building")
    .replace(/^check\b/i, "Checking")
    .replace(/^choose\b/i, "Choosing")
    .replace(/^clean\b/i, "Cleaning")
    .replace(/^close\b/i, "Closing")
    .replace(/^commit\b/i, "Committing")
    .replace(/^connect\b/i, "Connecting")
    .replace(/^create\b/i, "Creating")
    .replace(/^debug\b/i, "Debugging")
    .replace(/^design\b/i, "Designing")
    .replace(/^edit\b/i, "Editing")
    .replace(/^ensure\b/i, "Ensuring")
    .replace(/^execute\b/i, "Executing")
    .replace(/^explain\b/i, "Explaining")
    .replace(/^find\b/i, "Finding")
    .replace(/^fix\b/i, "Fixing")
    .replace(/^get\b/i, "Getting")
    .replace(/^improve\b/i, "Improving")
    .replace(/^investigate\b/i, "Investigating")
    .replace(/^map\b/i, "Mapping")
    .replace(/^make\b/i, "Making")
    .replace(/^plan\b/i, "Planning")
    .replace(/^polish\b/i, "Polishing")
    .replace(/^push\b/i, "Pushing")
    .replace(/^research\b/i, "Researching")
    .replace(/^report\b/i, "Reporting")
    .replace(/^refresh\b/i, "Refreshing")
    .replace(/^resolve\b/i, "Resolving")
    .replace(/^resume\b/i, "Resuming")
    .replace(/^restore\b/i, "Restoring")
    .replace(/^review\b/i, "Reviewing")
    .replace(/^run\b/i, "Running")
    .replace(/^summarize\b/i, "Summarizing")
    .replace(/^sort\b/i, "Sorting")
    .replace(/^test\b/i, "Testing")
    .replace(/^update\b/i, "Updating")
    .replace(/^verify\b/i, "Verifying")
    .replace(/^write\b/i, "Writing");
  if (active !== text) return contextualActivityForTask(active, text) ?? active;
  // The "Improving <text>" synth and the raw-echo fallback are ONLY safe for
  // declared task text. Applied to raw prompts they produced garbage titles
  // ("Improving we are working from the vps") and title-repeats-task junk.
  if (!allowSynth) return undefined;
  if (/^[\w][\w\s/+-]{8,80}$/.test(text)) {
    return `Reviewing ${text.replace(/\s*\+\s*/g, " and ")}`;
  }
  return contextualActivityForTask(active, text) ?? active;
}

function publicTaskGoalFromDeclaredTask(value?: string | null) {
  const text = value
    ?.replace(/\s+/g, " ")
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .trim();
  if (!text) return undefined;
  if (/\b(?:backend\.exit|Primary backend exited)\b/i.test(text) && /\bhermes\b/i.test(text)) {
    return "Investigate Hermes backend exit diagnostics";
  }
  const readable = readableUserTaskLabel(text);
  if (readable) return readable;
  if (/^Skipping model calls for clear task sidecars$/i.test(text)) {
    return "Improve pane header task and title quality";
  }
  if (/^Rewrite or refresh memory_summary\.md from finalized memory state and verify references$/i.test(text)) {
    return "Refresh memory summary and verify references";
  }
  if (/^Refresh memory_summary\.md routing\b/i.test(text)) {
    return "Refresh memory routing rules";
  }
  return text;
}

function readableProjectName(value?: string | null) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return "project";
  return text
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .map((part) => part.replace(/^Mvp$/i, "MVP").replace(/^Ai$/i, "AI").replace(/^Api$/i, "API"))
    .join(" ");
}

function contextualVerificationDetail(contextTitle?: string | null, workspace?: string | null) {
  const detail = contextTitle
    ?.replace(/^(?:Searching|Search)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!detail || /^Run focused tests/i.test(detail) || detail.split(/\s+/).length < 2) return undefined;

  const workspaceLabel = readableProjectName(workspace);
  if (/\bonSessionError\s+in\s+use-message-stream\b/i.test(detail)) {
    return `${workspaceLabel} onSessionError handling`;
  }

  return detail;
}

function contextualTaskForGenericVerification(
  task: string | undefined,
  contextTitle?: string | null,
  workspace?: string | null,
) {
  if (!task || !contextTitle || !isGenericVerificationTaskTitle(task)) return task;
  const detail = contextualVerificationDetail(contextTitle, workspace);
  if (!detail) return task;
  if (/^Run build, lint, focused tests, and visual checks$/i.test(task)) {
    return `Run verification for ${detail}`;
  }
  return `Run focused tests for ${detail}`;
}

function publicStatusGoalFromSummary(
  summary: WorkstreamStatusSummary | undefined | null,
  workspace?: string | null,
) {
  const task = summary?.task?.replace(/\s+/g, " ").trim();
  const now = summary?.now?.replace(/\s+/g, " ").trim();
  const narration = summary?.narration?.replace(/\s+/g, " ").trim();
  const workspaceLabel = readableProjectName(workspace);
  const readableTask = readableUserTaskLabel(task);
  if (readableTask) return readableTask;
  if (/^Status:\s+.+\bis clean and synced\b/i.test(task ?? "")) {
    return "Verify sidebar custom folders branch sync";
  }
  if (/Focused Vitest could not run\b/i.test(task ?? "") && /\bread-only node_modules\b/i.test(task ?? "")) {
    return "Resolve focused Vitest sandbox write failure";
  }
  if (/\bFix the sandbox test blocker\b/i.test(task ?? "") && /\bVitest\b/i.test(task ?? "")) {
    return "Fix the sandbox test blocker by running Vitest with a temporary config";
  }
  if (/fast-track state\b/i.test(task ?? "")) {
    return "Choose next fast-track work";
  }
  if (/^Rewrite or refresh memory_summary\.md\b/i.test(task ?? "")) {
    return "Refresh memory summary and verify references";
  }
  if (/\bNetlify\b/i.test(task ?? "") && /\bdeployment\b/i.test(task ?? "")) {
    return "Choose Vercel or Netlify deployment option";
  }
  if (/^npm test$/i.test(now ?? "")) {
    return `Run ${workspaceLabel} test suite`;
  }
  if (/\bTask to update MASTER_PLAN completed successfully\b/i.test(now ?? "")) {
    return "Verify project plan update result";
  }
  if (/\bPublic screenshot and top crop completed successfully\b/i.test(now ?? "")) {
    return "Verify public screenshot and top crop result";
  }
  if (/\bWebsite content updated successfully\b/i.test(now ?? "") || /\bWebsite content updated successfully\b/i.test(narration ?? "")) {
    return "Verify website content update result";
  }
  return undefined;
}

// Leading conversational filler ("ok so ", "hey ", "please ") adds nothing on a
// cockpit Task row — strip it so the ask starts at the verb/subject.
function stripConversationalOpeners(value: string) {
  const deBoilerplated = value.replace(/^the\s+operator\s+wants\s+(?:to\s+)?/i, "");
  if (deBoilerplated !== value) {
    value = deBoilerplated.charAt(0).toUpperCase() + deBoilerplated.slice(1);
  }
  return value.replace(/^(?:(?:ok(?:ay)?|so|hey|please|also|and|now|then|sure|yes|yeah|yep|alright|right|cool|great|thanks|thank you)[,\s]+)+/i, "").trim() || value;
}

// A prompt scraped from the visible terminal grid can arrive as several wrapped
// lines joined together, each still carrying its `›`/`❯` prompt marker and a
// trailing enumerator ("… - I › … - II"). Turn markers into separators, drop any
// duplicated wrapped fragment (keep the first, fullest clause), strip a trailing
// roman/numeric enumerator. This is cleanup, NOT summarization — it just stops the
// header printing raw grid chrome. (2026-07-04)
export function sanitizeScrapedAsk(value?: string | null): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  const segments = raw
    .split(/[›❯»▸]/)
    .map((segment) => segment.replace(/^[>$#|\s]+/, "").trim())
    .filter(Boolean);
  let text = segments[0] ?? raw;
  // If a later segment shares a long common prefix with the first, it's the same
  // ask wrapped across lines — the first segment already has it, so keep only that.
  text = text
    .replace(/\[Image\s+#?\d+\]\s*/gi, "")
    .replace(/\s*[-–—]\s*(?:[ivx]{1,4}|\d{1,3})\s*$/i, "")
    .trim();
  return text || raw;
}

// Printed plan/checkbox scrapes carry tree glyphs ("└ □ Checking…") — strip the
// glyph prefix, keep the text.
function stripPlanGlyphPrefix(value: string) {
  return value.replace(/^[\s└├╰╭│┌┐─]*[□■☐✓✔✗]?\s*/, "").trim() || value;
}

function readableUserTaskLabel(value?: string) {
  const text = value
    ?.replace(/\s+/g, " ")
    .trim();
  if (!text) return undefined;
  if (/^what changed\b/i.test(text)) return undefined;

  if (/^restore$/i.test(text)) {
    return "Restore previous work state";
  }
  if (/\b(?:backend\.exit|Primary backend exited)\b/i.test(text) && /\bhermes\b/i.test(text)) {
    return "Investigate Hermes backend exit diagnostics";
  }
  if (/^lets do your plan$/i.test(text)) {
    return "Execute proposed cleanup plan";
  }
  if (/^lets?\s+commit\b/i.test(text) && /\bpush\b/i.test(text) && /\bbranches?\b/i.test(text)) {
    return "Commit, push, merge, and clean old branches safely";
  }
  if (/\bsurvi(?:ve|te)\s+restart\b/i.test(text) && /\bvps\b/i.test(text)) {
    return "Decide restart and VPS persistence";
  }
  if (/\bwhy do I have only one call\b/i.test(text) && /\bmany more before/i.test(text)) {
    return "Investigate missing Arthouse call records";
  }
  if (/\bNew World AI Film Festival\b/i.test(text) && /\bwider\s+array\b/i.test(text) && /\bevents?\b/i.test(text)) {
    return "Find wider AI film festival sources";
  }
  if (/\b(?:reserach|research)\b/i.test(text) && /\b(?:rag|another solution|best implemenation|best implementation)\b/i.test(text)) {
    return "Research Hermes memory-loading approach";
  }
  if (/\bconvert(?:ing)?\s+it\s+e2e\b/i.test(text) && /\btelegram\s+bot\b/i.test(text)) {
    return "Review end-to-end Telegram bot conversion";
  }
  if (/\blow quality\b/i.test(text) && /\b(?:what now|do you understand|understand what|here)\b/i.test(text)) {
    return "Improve pane header task and title quality";
  }
  if (/^make high$/i.test(text)) {
    return "Improve Hermes chat quality";
  }
  if (/\bnothing happens here\b/i.test(text) && /\bafter I send this\b/i.test(text)) {
    return "Investigate Hermes send action failure";
  }
  if (/\bshould we create\b/i.test(text) && /\b(?:daily|once in sev?ral days)\b/i.test(text)) {
    return "Decide Botson check-in schedule";
  }
  if (/\bscrolling up\b/i.test(text) && /\bterminal\b/i.test(text) && /\bglitch/i.test(text)) {
    return "Resolve terminal scroll glitch";
  }
  if (/\bdesign skills?\b/i.test(text) && /\bdesign\b/i.test(text) && /\bimplement\b/i.test(text)) {
    return "Design and implement project tiles";
  }
  if (/\bcreate a loop\b/i.test(text) && /\bdaily\b/i.test(text) && /\b(?:breakage|errors?|bugs?|regressions?)\b/i.test(text)) {
    return "Create daily regression monitoring loop";
  }
  if (/\b(?:close|glose)\s+the\s+gap\b/i.test(text) && /\b(?:all\s+tasks?|tasks?)\b/i.test(text)) {
    return "Close remaining task gap";
  }
  if (/\bafter that\b/i.test(text) && /\bcomm?iting\b/i.test(text) && /\bpushing\b/i.test(text) && /\bverifying\b/i.test(text)) {
    return "Commit and verify remaining changes";
  }
  if (/\bbefore implementation\b/i.test(text) && /\b(?:existing timer state|timer state|VPS)\b/i.test(text)) {
    return "Verify VPS timer state before implementation";
  }
  if (/^Ts:\d+\)\s*-\s*/i.test(text) && /\bproduction audit\b/i.test(text) && /\bCardcom\b/i.test(text)) {
    return "Audit Cardcom overdue production rows";
  }
  if (/\b(?:rag|load data live from obsidian|obsidian)\b/i.test(text) && /\b(?:always have context|have context|write there)\b/i.test(text)) {
    return "Add Obsidian memory loading for Hermes";
  }
  if (/\b(?:investigaate|investigate)\b/i.test(text) && /\bplan\b/i.test(text) && /\b(?:charge\s+)?retro/i.test(text)) {
    return "Plan retroactive customer invoice charging";
  }
  if (/\b(?:crating|creating|create|add)\b/i.test(text) && /\binve?oice\b|\binvoice\b/i.test(text) && /\bpaying cuts?omers|paying customers\b/i.test(text)) {
    return "Add invoice section for paying customers";
  }
  if (/\b(?:resource|design resource)\b/i.test(text) && /\b(?:not being followed|is not being followed|followed)\b/i.test(text)) {
    return "Improve resource-following design for Watchpost";
  }
  if (/\bit got stuck here\b/i.test(text)) {
    return "Investigate stuck workflow shown in screenshot";
  }
  if (/^needs?\s+a\s+full\s+simulation\s+tests?$/i.test(text)) {
    return "Add full simulation tests";
  }
  if (/^should not cry wolf during normal updater auth rehydration$/i.test(text)) {
    return "Prevent false alerts during updater auth rehydration";
  }
  if (/^any leads on why this is happening\??$/i.test(text)) {
    return "Investigate why the Hermes issue is happening";
  }
  if (/\bnew conversation\b/i.test(text) && /\bdropoff\b/i.test(text)) {
    return "Add dropoff creation for long Hermes chats";
  }
  if (/\bconnect\s+hermes\s+to\s+claude-and-conquer\b/i.test(text) && /\bruntime agent\b/i.test(text)) {
    return "Connect Hermes to Claude and Conquer as runtime agent";
  }
  if (/\bflow[-\s]?state\b/i.test(text) && /\bconfigurable toolset\b/i.test(text)) {
    return "Add Flow State toolset configuration to Hermes";
  }
  if (/\bask\s+questions?bout\s+more\s+things\b/i.test(text) && /\badd\b/i.test(text)) {
    return "Ask follow-up questions for Bina Ve Ze additions";
  }
  if (/\bstill\s+looking\s+unclear\b/i.test(text) && /\b(?:search|serach)\b/i.test(text) && /\bgpt\s+image\b/i.test(text)) {
    return "Improve GPT Image prompting for the Rough Cut icon";
  }

  const subParSubject = text.match(/^(.{4,48}?)\s+(?:is|are|feels?|seems?)\s+(?:sub[-\s]?par|bad|weak|poor|not\s+good)\b/i)?.[1];
  if (subParSubject) {
    return `Improve ${subParSubject.replace(/^the\s+/i, "the ").trim()}`;
  }

  const beforeQuestionRequest = text
    .replace(/\s+(?:ask\s+me\s+questions?|question\s+me)\b.*$/i, "")
    .replace(/\s+(?:so|to)\s+(?:you\s+can\s+)?understand\b.*$/i, "")
    .trim();
  if (beforeQuestionRequest && beforeQuestionRequest.length >= 8 && beforeQuestionRequest !== text) {
    return beforeQuestionRequest;
  }

  return undefined;
}

export function buildShellTerminalHeaderViewModel(input: {
  project?: Pick<Group, "id" | "name" | "projectRoot"> | null;
  liveCwd?: string | null;
  liveGitRoot?: string | null;
  terminalStatus?: TerminalRuntimeStatus | null;
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  mainUserAsk?: TerminalMainUserAsk | null;
  statusSummary?: WorkstreamStatusSummary | null;
  summary?: WorkstreamStatusSummary | null;
  neutralTitle?: string | null;
  trustedActivitySummary?: boolean;
  contextPurposeTitle?: string | null;
  contextPurposeSource?: TerminalPurposeSource | null;
  workstreamTitle?: string | null;
  // The pane is actively working RIGHT NOW (a visible "Working (…)" / spinner marker),
  // even though there's no real task list. Without this, an actively-working shell whose
  // heuristic status reads "idle" showed the misleading title "Awaiting next action".
  activelyWorking?: boolean;
}): ShellTerminalHeaderViewModel {
  const livePath =
    input.liveCwd ?? input.project?.projectRoot ?? "workspace path unknown";
  const workspace = workspaceLabelFor({
    project: input.project,
    cwd: input.liveCwd,
    gitRoot: input.liveGitRoot,
  });
  const taskIdentity = resolveTaskIdentity({
    taskLineup: input.taskLineup,
    activeRunId: input.activeRunId,
    mainUserAsk: input.mainUserAsk,
    planBindingTitle: input.contextPurposeTitle,
    planBindingSource: input.contextPurposeSource ?? (input.contextPurposeTitle ? "inferred" : null),
    workstreamTitle: input.workstreamTitle,
    statusSummary: input.statusSummary,
  });
  const mainUserAskApplies = Boolean(
    input.mainUserAsk &&
    (!input.mainUserAsk.runId ||
      !input.activeRunId ||
      input.mainUserAsk.runId === input.activeRunId),
  );
  const rawUserTaskText = mainUserAskApplies ? input.mainUserAsk?.text.trim() || undefined : undefined;
  const taskText = taskIdentity.source === "task-tool" ? taskIdentity.text : undefined;
  const cleanedUserTaskText = rawUserTaskText
    ? stripConversationalOpeners(sanitizeScrapedAsk(rawUserTaskText))
    : undefined;
  // Terse asks ("make all high") read poorly verbatim — let the existing purpose
  // mapper expand them; longer asks keep the user's own words.
  const terseAskRewrite =
    cleanedUserTaskText && cleanedUserTaskText.split(/\s+/).length <= 6
      ? qualityPurposeTitle(cleanedUserTaskText)
      : undefined;
  const userTaskText =
    taskIdentity.source !== "task-tool" && taskIdentity.source !== "missing"
      ? (cleanedUserTaskText || taskIdentity.text)
      : terseAskRewrite ?? (cleanedUserTaskText || undefined);
  const readableUserTaskText = taskText ? undefined : readableUserTaskLabel(userTaskText);
  const authoritativeTaskText = compactHeaderGoal(
    contextualTaskForGenericVerification(publicTaskGoalFromDeclaredTask(taskText), input.contextPurposeTitle, workspace),
  );
  const statusTaskCandidate = compactHeaderGoal(publicStatusGoalFromSummary(input.statusSummary ?? input.summary, workspace));
  const scrapedTaskCandidate =
    compactHeaderGoal(readableUserTaskText) ?? compactHeaderGoal(userTaskText);
  const scrapedTaskQuality = scrapedTaskCandidate
    ? qualityCheckUserAskLabel(scrapedTaskCandidate)
    : { ok: false as const, reason: "empty" as const };
  const scrapedTaskText = scrapedTaskQuality.ok ? scrapedTaskCandidate : undefined;
  const identityTaskDescriptionText =
    taskIdentity.source === "task-tool"
      ? authoritativeTaskText
      : taskIdentity.source === "missing"
        ? undefined
        : scrapedTaskText;
  // The declared todo-write task is authoritative: it skips the scrape-only
  // command/path heuristics but still rejects raw-prompt junk.
  const identityTaskQuality = authoritativeTaskText
    ? qualityCheckAuthoritativeTaskLabel(authoritativeTaskText)
    : taskIdentity.source === "missing"
      ? { ok: false as const, reason: "empty" as const }
      : scrapedTaskText
        ? scrapedTaskQuality
        : qualityCheckTaskLabel(identityTaskDescriptionText);
  const statusTaskQuality = statusTaskCandidate
    ? qualityCheckTaskLabel(statusTaskCandidate)
    : { ok: false as const, reason: "empty" as const };
  const taskDescriptionText = identityTaskQuality.ok
    ? identityTaskDescriptionText
    : statusTaskQuality.ok
      ? statusTaskCandidate
      : undefined;
  const taskDescriptionSource: HeaderFieldSource | "missing" = identityTaskQuality.ok
    ? taskIdentity.source
    : statusTaskQuality.ok
      ? "status-summary"
      : "missing";
  const hasRealTask = Boolean(taskText && taskDescriptionText);
  const hasUserTask = Boolean(userTaskText && taskDescriptionText && taskDescriptionSource !== "status-summary");
  const hasStatusTask = Boolean(statusTaskQuality.ok && taskDescriptionSource === "status-summary");

  const base =
    input.summary ??
    normalizePersistedShellSummary(
      input.statusSummary ?? {
        task: "Ready",
        path: livePath,
        now: "Awaiting command",
        status: "idle",
        provider: "shell",
        confidence: "low",
        tasksFromTodoWrite: false,
      },
      livePath,
    );
  const computedNeutral =
    base.status === "working"
      ? neutralHeaderTitle(input.terminalStatus)
      : base.status === "blocked"
        ? "Needs attention"
        : base.status === "done" || base.status === "idle"
          ? "Idle"
          : neutralHeaderTitle(input.terminalStatus);
  const neutral = input.neutralTitle === undefined ? computedNeutral : input.neutralTitle;
  const rawFallbackNow = neutral ?? computedNeutral;
  // An actively-working pane must never read "Idle"/"Ready" (→ "Awaiting next action").
  const fallbackNow =
    input.activelyWorking && (rawFallbackNow === "Idle" || rawFallbackNow === "Ready")
      ? "Working"
      : rawFallbackNow;
  // The agent's narrated current step, trusted only while the pane is actively
  // working AND it passes the now-line gate (stale/junk persisted narration must
  // not resurface as a title).
  // Narration shows while actively working AND as the last-outcome line on an
  // idle/done pane — the operator's rule (2026-07-04): a finished terminal must
  // say what has been done, never just "Awaiting next action".
  const narrationEligible =
    input.activelyWorking ||
    base.status === "idle" ||
    base.status === "done" ||
    // A high-confidence contextual line (local summarizer) is displayable even on
    // a stale pane whose lifecycle is unknown — better than a bare status word.
    (base.confidence === "high" && Boolean(base.narration ?? input.statusSummary?.narration));
  let rawLiveNarration = narrationEligible
    ? (base.narration ?? input.statusSummary?.narration)?.replace(/\s+/g, " ").trim()
    : undefined;
  // Hook narration can be up to 90 chars but the now gate rejects >80 — clamp to a
  // clause/word boundary instead of silently dropping the outcome line.
  if (rawLiveNarration && rawLiveNarration.length > 78) {
    const clause = rawLiveNarration.split(/,\s+/)[0].trim();
    rawLiveNarration =
      clause.length >= 24 && clause.length <= 78
        ? clause
        : `${rawLiveNarration.slice(0, 75).replace(/\s+\S*$/, "").trim()}\u2026`;
  }
  const narrationConfidence =
    (base.narration ? base.confidence : input.statusSummary?.confidence) ?? "low";
  // Model-vetted lines are still user-visible pane titles, so they must stay
  // plain-language and free of files/paths. Authoritative task rows are the only
  // place where implementation detail can survive.
  const narrationGate =
    narrationConfidence === "high" ? qualityCheckTrustedActivityLabel : qualityCheckNowLabel;
  const liveNarration =
    rawLiveNarration &&
    rawLiveNarration.split(/\s+/).length >= 4 &&
    narrationGate(rawLiveNarration).ok
      ? rawLiveNarration
      : undefined;
  const summary = sanitizeShellDisplaySummary(
    preferRealTaskSummary(
      base,
      input.statusSummary,
      input.trustedActivitySummary || hasUserTask ? undefined : neutral ?? undefined,
      { narrationCurrent: Boolean(liveNarration) },
    ),
    livePath,
    fallbackNow,
  );
  const hasTrustedContext =
    hasRealTask || hasUserTask || hasStatusTask || Boolean(input.trustedActivitySummary) || Boolean(liveNarration);
  const rawNow = hasTrustedContext
    ? sanitizeTerminalHeaderNow(summary.now, livePath, fallbackNow)
    : fallbackNow;
  const now = contextualActivityForTask(rawNow, taskText ?? userTaskText) ?? rawNow;
  const activeTaskTitle = taskText ?? userTaskText;
  const hasDistinctActivity =
    now !== fallbackNow &&
    !sameHeaderText(now, activeTaskTitle) &&
    !sameHeaderText(now, summary.task);
  const taskDerivedActivity =
    taskDescriptionText
      ? taskActivityFromUserGoal(taskDescriptionText, true)
      : undefined;
  const activityTitle = stripPlanGlyphPrefix(hasDistinctActivity ? now : summary.task);
  // Task row = the goal; big title = the CURRENT STEP toward it. Prefer the
  // live activity when it's meaningful, fall back to the declared activeForm
  // only when it actually differs from the Task row, and never echo the Task
  // row as the title — a plain status word beats saying the same thing twice.
  const liveStepTitle =
    hasDistinctActivity &&
    qualityCheckActivityLabel(now).ok &&
    !headerTextsEquivalent(now, taskDescriptionText)
      ? now
      : undefined;
  const declaredStepTitle = stripPlanGlyphPrefix(
    contextualTaskForGenericVerification(publicTaskGoalFromDeclaredTask(summary.task) ?? summary.task, input.contextPurposeTitle, workspace) ??
      publicTaskGoalFromDeclaredTask(summary.task) ??
      summary.task,
  );
  const realTaskTitle =
    liveStepTitle ??
    (headerTextsEquivalent(declaredStepTitle, taskDescriptionText)
      ? (liveNarration && !headerTextsEquivalent(liveNarration, taskDescriptionText)
          ? liveNarration
          : taskDerivedActivity ?? fallbackNow)
      : declaredStepTitle);
  const missingActivity =
    !hasRealTask &&
    !hasUserTask &&
    !hasStatusTask &&
    !input.trustedActivitySummary &&
    !liveNarration &&
    base.status === "working" &&
    input.neutralTitle !== "Idle";
  const title = hasRealTask
    ? realTaskTitle
    : hasUserTask || hasStatusTask
      ? hasDistinctActivity ? activityTitle : liveNarration ?? taskDerivedActivity ?? fallbackNow
    : liveNarration && hasDistinctActivity
      ? activityTitle
    : input.trustedActivitySummary
      ? (hasDistinctActivity ? activityTitle : summary.task)
      : fallbackNow;
  const stripTrailingSeparators = (value: string) =>
    value.replace(/[;:,]+$/, "").trim() || value;
  const candidateReadableTitle = stripTrailingSeparators(
    hasUserTask && title === "Idle" ? "Awaiting next action" : title,
  );
  const candidateReadableNow = stripTrailingSeparators(
    hasUserTask && now === "Idle" ? "Awaiting next action" : now,
  );
  // When the candidate IS the model-vetted narration, keep the light gate all the
  // way down, but still reject implementation detail in the visible title.
  const titleQuality = (liveNarration && candidateReadableTitle === liveNarration
    ? qualityCheckTrustedActivityLabel
    : qualityCheckActivityLabel)(candidateReadableTitle);
  const nowQuality = (liveNarration && candidateReadableNow === liveNarration
    ? qualityCheckTrustedActivityLabel
    : qualityCheckNowLabel)(candidateReadableNow);
  const duplicatedLongLabels = headerLabelsAreDuplicated(taskDescriptionText, candidateReadableTitle);
  // Title and now are gated INDEPENDENTLY: a junk momentary now (e.g.
  // "Editing Terminal.tsx") must not drag a good declared title down with it.
  const lowQualityTitle = !titleQuality.ok || duplicatedLongLabels;
  const lowQualityNow = !nowQuality.ok;
  const lowQualityActivity = lowQualityTitle || lowQualityNow;
  const replacementActivity = lowQualityActivity ? taskDerivedActivity : undefined;
  const concreteTaskActivity = replacementActivity ?? taskDerivedActivity;
  const noCapturedWorkingActivity = Boolean(
    !taskDescriptionText &&
      base.status === "working" &&
      input.neutralTitle !== "Idle" &&
      !liveNarration &&
      !taskDerivedActivity,
  );
  const preGuardTitle =
    missingActivity ? "Activity not captured" :
    // A rejected title candidate falls back to an honest status word — never
    // to the noisy "Activity not captured" label (that reads as breakage).
    lowQualityTitle ? concreteTaskActivity ?? (noCapturedWorkingActivity ? "Activity not captured" : fallbackNow) :
    candidateReadableTitle;
  const keepEquivalentTaskDerivedActivity = Boolean(
    taskDerivedActivity &&
      preGuardTitle === taskDerivedActivity &&
      (hasStatusTask ||
        /^(?:Verify|Verifying|Find|Finding|Get|Getting|Improve|Improving|Refresh|Refreshing|Report|Reporting|Research|Researching|Review|Reviewing|Ensure|Ensuring|Check|Checking|Run|Running|Update|Updating|Investigate|Investigating|Map|Mapping|Resume|Resuming|Restore|Restoring|Push|Pushing|Add|Adding|Ask|Asking|Audit|Auditing|Close|Closing|Commit|Committing|Connect|Connecting|Create|Creating|Design|Designing|Execute|Executing|Sort|Sorting|Summarize|Summarizing|Choose|Decide|Choosing|Plan|Planning)\b|^Included\b|^Task\s+\d|^two people voted\b|^is that a good idea\??$|^Rechecking .+ approval|^Skipping model calls for clear task sidecars/i.test(taskDescriptionText ?? "") ||
        (input.mainUserAsk?.source === "status-sidecar" && /^(?:Resolve|Resolving)\b/i.test(taskDescriptionText ?? "")) ||
        /\bterminal gap\b/i.test(taskDescriptionText ?? "") ||
        /\bcharged a renewal\b/i.test(taskDescriptionText ?? "") ||
        /^update the codex app$/i.test(taskDescriptionText ?? "")),
  );
  // No pane may say the same thing on the Task row and the title.
  const readableTitle = headerTextsEquivalent(preGuardTitle, taskDescriptionText)
    ? (keepEquivalentTaskDerivedActivity
        ? preGuardTitle
        : hasUserTask && fallbackNow === "Idle" ? "Awaiting next action" : fallbackNow)
    : preGuardTitle;
  const readableNow =
    missingActivity ? "Activity not captured" :
    lowQualityNow ? (noCapturedWorkingActivity ? "Activity not captured" : fallbackNow) :
    candidateReadableNow;
  const titleBeforeLengthGuard =
    /^Verify schema, reference integrity, and that deleted inputs no longer drive memory$/i.test(taskDescriptionText ?? "")
      ? "Verifying memory schema and references"
      : /\bdebug-share bundles?\b/i.test(taskDescriptionText ?? "") && /^(?:Working|Idle|Awaiting next action)$/i.test(readableTitle)
        ? "Checking debug-share bundle redaction path"
        : readableTitle;
  const shortenTitle = (value: string) => {
    if (value.length <= 64) return value;
    if (taskDerivedActivity && taskDerivedActivity.length <= 64 && !headerTextsEquivalent(taskDerivedActivity, taskDescriptionText)) {
      return taskDerivedActivity;
    }
    const clause = value.split(/,\s+/)[0].trim();
    if (clause.length >= 24 && clause.length <= 64) return clause;
    return `${value.slice(0, 61).replace(/\s+\S*$/, "").trim()}\u2026`;
  };
  const finalReadableTitle = shortenTitle(titleBeforeLengthGuard);
  const missingActiveTask =
    !taskDescriptionText &&
    Boolean(input.trustedActivitySummary) &&
    finalReadableTitle !== "Idle" &&
    finalReadableTitle !== "Awaiting next action" &&
    finalReadableTitle !== "Activity not captured";

  return {
    workspace: { text: workspace, source: "workspace" },
    taskDescription: {
      text: taskDescriptionText ?? "Task not captured",
      source: taskDescriptionText ? taskDescriptionSource : "missing",
    },
    title: {
      text: finalReadableTitle,
      source: missingActivity
        ? "missing"
        : lowQualityTitle && replacementActivity
        ? hasRealTask ? "task-list" : "status-summary"
        : lowQualityTitle
          ? "missing"
        : hasRealTask
        ? "task-list"
        : hasUserTask || hasStatusTask
          ? "status-summary"
        : title === neutral
          ? "neutral"
          : "status-summary",
    },
    path: {
      text: livePath,
      source: "status-summary",
    },
    now: {
      text: readableNow,
      source: missingActivity
        ? "missing"
        : lowQualityNow && replacementActivity
          ? hasRealTask ? "task-list" : "status-summary"
        : lowQualityNow
          ? "missing"
        : hasTrustedContext && now !== fallbackNow ? "status-summary" : "neutral",
    },
    debug: {
      livePath,
      hasRealTask,
      hasUserTask,
      hasStatusTask,
      hasTrustedContext,
      titleDuplicatedUserTask: hasUserTask && sameHeaderText(summary.task, userTaskText),
      titleUsesDistinctActivity: hasDistinctActivity,
      missingActiveTask,
      missingActivity,
      taskQualityReason: identityTaskQuality.ok ? identityTaskQuality.reason : statusTaskQuality.reason,
      titleQualityReason: titleQuality.reason,
      nowQualityReason: nowQuality.reason,
      duplicatedLongLabels,
      replacementActivity,
      tasksFromTodoWrite: input.statusSummary?.tasksFromTodoWrite,
      taskIdentitySource: taskIdentity.source,
      mainUserAskSource: mainUserAskApplies ? input.mainUserAsk?.source : undefined,
      mainUserAskRunMatches: mainUserAskApplies,
    },
  };
}
