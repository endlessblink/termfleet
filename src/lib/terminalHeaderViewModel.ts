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
} from "./terminalHeaderDisplay";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckUserAskLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckNowLabel,
  qualityCheckNarrationLabel,
  titleIsCommentaryOrDangling,
} from "./terminalHeaderQuality";
import { activeTodoTask, resolveTaskIdentity } from "./taskIdentity";

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
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const commonPrefix = shorter.findIndex((token, index) => token !== longer[index]);
  const prefixLength = commonPrefix === -1 ? shorter.length : commonPrefix;
  if (shorter.length >= 5 && prefixLength / longer.length >= 0.7) return true;
  return headerStemsMatch(ta[0], tb[0]) && ta.slice(1).join(" ") === tb.slice(1).join(" ");
}

// The honest status words a title may show when no real step was captured.
const HONEST_TITLES =
  /^(?:Activity not captured|Awaiting next action|Awaiting terminal output|Idle|Working|Thinking|Ready|Ready for next task|No active work)$/i;

// A "Now Active" line adds nothing when it is one of these bare status/placeholder
// words — showing it as a second header row just reads as noise next to the task.
const NON_INFORMATIVE_ACTIVITY =
  /^(?:Activity not captured|Awaiting next action|Awaiting command|Awaiting terminal output|Idle|Working|Thinking|Ready|Ready for next task|No active work|Prompt submitted|Provider session is ready|Answering latest prompt|Answering user question|Running terminal command|Command is running)$/i;

/**
 * Whether the "Now Active" line says something the Task line does not. It doesn't
 * when it's empty, a bare status/placeholder word, or just the task reworded — in
 * which case the header collapses to the single honest Task line instead of showing
 * a redundant or meaningless second row.
 */
export function activityAddsInfo(
  task?: string | null,
  activity?: string | null,
  attention?: "running" | "waiting" | "idle" | "unavailable",
): boolean {
  if (!activity) return false;
  const trimmed = activity.trim();
  if (!trimmed) return false;
  if (/^Provider requires authentication$/i.test(trimmed) && attention !== "waiting") return false;
  if (NON_INFORMATIVE_ACTIVITY.test(trimmed)) return false;
  if (
    attention === "idle" &&
    /^(?:Checking|Running|Verifying|Testing|Building|Fixing|Reviewing|Confirming|Preparing|Writing|Reading|Tracing|Investigating|Making|Adding|Updating|Removing|Publishing|Deploying)\b/i.test(trimmed)
  ) {
    return false;
  }
  return !headerTextsEquivalent(trimmed, task);
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
  if (/^Run fresh production audit and charge approved candidates one by one$/i.test(text)) {
    return "Charging approved candidates one by one";
  }
  if (/^Resuming active TermFleet work$/i.test(text)) {
    return "Checking current repo state";
  }
  if (/^Improving cockpit header quality$/i.test(text)) {
    return "Checking cockpit header quality";
  }
  if (/^Capturing all terminal task and active labels$/i.test(text)) {
    return "Checking every terminal header";
  }
  if (/^Extending watchdog to selected terminal surface$/i.test(text)) {
    return "Checking selected terminal surface";
  }
  if (/^Normalizing final-answer prose and placeholder prompt labels$/i.test(text)) {
    return "Checking prose and placeholder labels";
  }
  if (/^Re-running live loop until clean$/i.test(text)) {
    return "Checking live loop results";
  }
  if (/^Capturing the TermFleet terminal header$/i.test(text)) {
    return "Checking the TermFleet terminal header";
  }
  if (/^Fixing broken cockpit header capture$/i.test(text)) {
    return "Repairing cockpit header capture";
  }
  if (/^Monitoring the visible TermFleet header$/i.test(text)) {
    return "Checking the visible TermFleet header";
  }
  if (/^Guarding the second repayment step$/i.test(text)) {
    return "Checking the repayment step boundary";
  }
  if (/^Finishing false-positive regression$/i.test(text)) {
    return "Checking false-positive regression";
  }
  if (/^Reviewing bot regression watchdog$/i.test(text)) {
    return "Checking bot regression watchdog";
  }
  if (/^Checking production deployment status$/i.test(text)) {
    return "Verifying production deployment status";
  }
  if (/^Improving false-positive detection$/i.test(text)) {
    return "Checking false-positive coverage";
  }
  if (/^Verifying high quality results$/i.test(text)) {
    return "Checking quality evidence";
  }
  if (/^Protecting account access before adding credentials$/i.test(text)) {
    return "Checking why credentials are safe";
  }
  if (/^Protecting sensitive credentials in Doppler$/i.test(text)) {
    return "Checking sensitive credential storage";
  }
  if (/^Writing tests for selected file$/i.test(text)) {
    return "Planning selected-file tests";
  }
  if (/^Fixing selected-file bug$/i.test(text)) {
    return "Checking selected-file bug";
  }
  if (/^Fixing scraper credential reuse$/i.test(text)) {
    return "Checking scraper credential reuse";
  }
  if (/^Running scraper with success capture$/i.test(text)) {
    return "Checking scraper capture run";
  }
  if (/^Inspect exact state\/test seams for profile restore$/i.test(text)) {
    return "Checking profile restore test seams";
  }
  if (/^Running requested safety check$/i.test(text)) {
    return "Checking requested safety gate";
  }
  if (/^Charging approved customer$/i.test(text)) {
    return "Preparing approved charge";
  }
  if (/^Loading next approved record$/i.test(text)) {
    return "Checking next approved record";
  }
  if (/^Proceeding with requested change$/i.test(text)) {
    return "Testing requested change";
  }
  if (/^Executing agreed plan independently$/i.test(text)) {
    return "Checking independent execution plan";
  }
  if (/^Building requested changes$/i.test(text)) {
    return "Checking requested build";
  }
  if (/^Verifying credentials safely$/i.test(text)) {
    return "Checking credential safety proof";
  }
  if (/^Clarifying requested quality target$/i.test(text)) {
    return "Asking what needs higher quality";
  }
  if (/^Applying requested change$/i.test(text)) {
    return "Checking requested change";
  }
  if (/^Changing busy default port$/i.test(text)) {
    return "Checking default port change";
  }
  if (/^Checking RiseUp API key name$/i.test(text)) {
    return "Reviewing RiseUp API key name";
  }
  if (/^Confirming approved action$/i.test(text)) {
    return "Checking confirmation outcome";
  }
  if (/^Adding cockpit label alerts$/i.test(text)) {
    return "Checking label alert workflow";
  }
  if (/^Summarizing recent commits$/i.test(text)) {
    return "Checking recent commit summary";
  }
  if (/^Reviewing current changes$/i.test(text)) {
    return "Checking current changes";
  }
  if (/^Committing and cleaning completed work safely$/i.test(text)) {
    return "Checking safe commit and cleanup";
  }
  if (/^Checking WhatsApp spam appeal path$/i.test(text)) {
    return "Reviewing spam appeal path";
  }
  if (/^Reviewing group spam moderation rules$/i.test(text)) {
    return "Checking moderation rule behavior";
  }
  if (/^Updating club price$/i.test(text)) {
    return "Checking club price update";
  }
  if (/^Running live cockpit watchdog loop$/i.test(text)) {
    return "Checking live cockpit labels";
  }
  if (/^Fixing unreliable cockpit monitor loop$/i.test(text)) {
    return "Checking cockpit monitor reliability";
  }
  if (/^Fixing failed tool selection$/i.test(text)) {
    return "Checking available tool selection";
  }
  if (/^Fixing missed visible cockpit label$/i.test(text)) {
    return "Checking missed cockpit label";
  }
  if (/^Fixing reported cockpit failure$/i.test(text)) {
    return "Checking cockpit failure report";
  }
  if (/^Reading cockpit labels directly$/i.test(text)) {
    return "Checking structured label data";
  }
  if (/^Clarifying cockpit label change names$/i.test(text)) {
    return "Checking label wording specificity";
  }
  if (/^Clarifying vague cockpit task labels$/i.test(text)) {
    return "Asking what each task refers to";
  }
  if (/^Designing narrative cockpit task labels$/i.test(text)) {
    return "Checking label purpose and context";
  }
  if (/^Designing cockpit status card labels$/i.test(text)) {
    return "Checking status card design rationale";
  }
  if (/^Choosing appropriate design skills$/i.test(text)) {
    return "Checking design skill coverage";
  }
  if (/^Improving cockpit label goal wording$/i.test(text)) {
    return "Checking main goal label clarity";
  }
  if (/^Writing browser-control verification prompt$/i.test(text)) {
    return "Checking browser verification prompt";
  }
  if (/^Reading project documentation$/i.test(text)) {
    return "Checking documentation context";
  }
  if (/^Designing high-quality event page$/i.test(text)) {
    return "Checking event page visual quality";
  }
  if (/^Fixing stuck cockpit workflow$/i.test(text)) {
    return "Checking stuck workflow state";
  }
  if (/^Fixing duplicate cockpit labels$/i.test(text)) {
    return "Checking duplicate label detection";
  }
  if (/^Inspecting renewal helpers and cron tests$/i.test(text)) {
    return "Checking renewal helper tests";
  }
  if (/^Patching renewal cron payload$/i.test(text)) {
    return "Checking renewal cron payload";
  }
  if (/^Restricting group invite link access$/i.test(text)) {
    return "Checking member-only invite access";
  }
  if (/^Monitor active terminal work$/i.test(text)) {
    return "Checking active terminal work";
  }
  if (/^Planning account safety prevention$/i.test(text)) {
    return "Checking account safety prevention";
  }
  if (/^Finalizing Income Zen plan update$/i.test(text)) {
    return "Checking Income Zen plan update";
  }
  if (/^Advancing FlowState Hermes assistant integration$/i.test(text)) {
    return "Checking Hermes assistant integration";
  }
  if (/^Fixing cut off question prompt display$/i.test(text)) {
    return "Checking question prompt display";
  }
  if (/^Fixing question tool workflow$/i.test(text)) {
    return "Checking question tool workflow";
  }
  if (/^Fixing clicked control behavior$/i.test(text)) {
    return "Checking clicked control behavior";
  }
  if (/^Running Yahav scrape$/i.test(text)) {
    return "Checking Yahav scraper prompt";
  }
  if (/^Using project test command$/i.test(text)) {
    return "Checking project test command";
  }
  if (/^Ordering sidebar terminals by map position$/i.test(text)) {
    return "Checking sidebar map order";
  }
  if (/^Ordering stacked terminals by map position$/i.test(text)) {
    return "Checking stacked terminal order";
  }
  if (/^Improving mailbox visual design$/i.test(text)) {
    return "Checking mailbox visual design";
  }
  if (/^Investigating missing event results$/i.test(text)) {
    return "Checking missing event results";
  }
  if (/^Verifying reliable event results$/i.test(text)) {
    return "Checking reliable event results";
  }
  if (/^Reviewing puzzle content coverage$/i.test(text)) {
    return "Checking puzzle content coverage";
  }
  if (/^Diagnosing main workflow issue$/i.test(text)) {
    return "Checking main workflow diagnosis";
  }
  if (/^Explaining current status in plain language$/i.test(text)) {
    return "Checking plain-language next steps";
  }
  if (/^Planning release priorities$/i.test(text)) {
    return "Checking release priorities";
  }
  if (/^Finding production contact section$/i.test(text)) {
    return "Checking production contact section";
  }
  if (/^Deploying finished visual updates$/i.test(text)) {
    return "Checking visual deployment scope";
  }
  if (/^Planning grandfathered subscription pricing$/i.test(text)) {
    return "Checking 89-to-99 pricing rule";
  }
  if (/^Planning safe write protocol$/i.test(text)) {
    return "Checking safe write architecture";
  }
  if (/^Adding concrete section examples$/i.test(text)) {
    return "Checking section example depth";
  }
  if (/^Planning live event landing page$/i.test(text)) {
    return "Checking event page build plan";
  }
  if (/^Checking Yahav RiseUp scraper path$/i.test(text)) {
    return "Reviewing Yahav RiseUp scraper path";
  }
  if (/^Checking future purchase price transition$/i.test(text)) {
    return "Reviewing future purchase pricing";
  }
  if (/^Updating old link locations$/i.test(text)) {
    return "Resetting group invite link";
  }
  if (/^Deploying everything safely$/i.test(text)) {
    return "Checking safe deployment";
  }
  if (/^Adding production Doppler token$/i.test(text)) {
    return "Checking production env token";
  }
  if (/^Checking WhatsApp content privacy$/i.test(text)) {
    return "Reviewing content privacy boundary";
  }
  if (/^Restoring last used chat from profile$/i.test(text)) {
    return "Checking profile chat restore";
  }
  if (/^Fixing about section content gaps$/i.test(text)) {
    return "Checking about section content";
  }
  if (/^Close current agent task$/i.test(text)) {
    return "Closing current agent task";
  }
  if (/\bimplement this\b/i.test(text) && /\bstop before\b/i.test(text) && /\brepayment step\b/i.test(text)) {
    return "Checking the repayment step boundary";
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
  if (/^(?:Adding|Asking|Answering|Auditing|Building|Checking|Cleaning|Committing|Creating|Debugging|Designing|Editing|Explaining|Exploring|Fixing|Improving|Investigating|Making|Planning|Polishing|Pushing|Refreshing|Reporting|Reviewing|Running|Summarizing|Testing|Updating|Verifying|Writing)\b/i.test(text)) {
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
    .replace(/^deploy\b/i, "Deploying")
    .replace(/^design\b/i, "Designing")
    .replace(/^edit\b/i, "Editing")
    .replace(/^ensure\b/i, "Ensuring")
    .replace(/^execute\b/i, "Executing")
    .replace(/^explain\b/i, "Explaining")
    .replace(/^explore\b/i, "Exploring")
    .replace(/^find\b/i, "Finding")
    .replace(/^fix\b/i, "Fixing")
    .replace(/^get\b/i, "Getting")
    .replace(/^improve\b/i, "Improving")
    .replace(/^implement\b/i, "Implementing")
    .replace(/^investigate\b/i, "Investigating")
    .replace(/^locate\b/i, "Locating")
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

function qualifyAmbiguousLabel(value: string, workspace: string) {
  if (!/\b(?:speed settings|the handoff|proposed repair|the repair|behavior rules)\b/i.test(value)) {
    return value;
  }
  if (new RegExp(`\\b${workspace.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(value)) {
    return value;
  }
  const workspaceLabel = workspace
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `${workspaceLabel} — ${value}`;
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
  const contextPurposeTitle = input.contextPurposeTitle;
  const taskIdentity = resolveTaskIdentity({
    taskLineup: input.taskLineup,
    activeRunId: input.activeRunId,
    mainUserAsk: input.mainUserAsk,
    planBindingTitle: contextPurposeTitle,
    planBindingSource: input.contextPurposeSource,
    workstreamTitle: input.workstreamTitle,
    statusSummary: input.statusSummary,
  });
  const activePlanItem = activeTodoTask(input.taskLineup, input.activeRunId);
  const mainUserAskApplies = Boolean(
    input.mainUserAsk &&
      (!input.mainUserAsk.runId ||
      !input.activeRunId ||
      input.mainUserAsk.runId === input.activeRunId ||
      input.mainUserAsk.source === "status-sidecar"),
  );
  const taskText = taskIdentity.source === "task-tool" ? taskIdentity.text : undefined;
  const userTaskText =
    taskIdentity.source !== "task-tool" && taskIdentity.source !== "missing"
      ? taskIdentity.text
      : undefined;
  const identityTaskDescriptionText =
    taskIdentity.source === "missing"
      ? undefined
      : compactHeaderGoal(taskIdentity.text);
  // The user's own words are gated leniently: informal phrasing and typos are
  // still what they asked for. Declared task text gets the authoritative gate.
  const identityIsUserAsk = taskIdentity.source === "manual" || taskIdentity.source === "user-prompt";
  const identityTaskQuality = identityTaskDescriptionText
    ? identityIsUserAsk
      ? qualityCheckUserAskLabel(identityTaskDescriptionText)
      : qualityCheckAuthoritativeTaskLabel(identityTaskDescriptionText)
    : { ok: false as const, reason: "empty" as const };
  const taskDescriptionText = identityTaskQuality.ok ? identityTaskDescriptionText : undefined;
  const taskDescriptionSource: HeaderFieldSource | "missing" = identityTaskQuality.ok
    ? taskIdentity.source
    : "missing";
  const hasRealTask = Boolean(taskText && taskDescriptionText);
  const hasUserTask = Boolean(userTaskText && taskDescriptionText);
  const hasStatusTask = false;

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
  // Model-vetted lines are still user-visible pane titles, so they must stay
  // plain-language and free of files/paths. Authoritative task rows are the only
  // place where implementation detail can survive. Confidence does not license
  // report prose: a confidently-worded "I committed the fix" is still not work.
  const narrationGate = (text: string) =>
    qualityCheckNarrationLabel(
      text,
      base.status === "working" || input.activelyWorking ? "working" : "settled",
    );
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
    (hasUserTask || !sameHeaderText(now, summary.task));
  const taskDerivedActivity =
    taskDescriptionText
      ? /^Close current agent task$/i.test(taskDescriptionText)
        ? "Closing current agent task"
        : taskActivityFromUserGoal(taskDescriptionText, true)
      : undefined;
  const activePlanStep = activePlanItem?.content
    ? stripPlanGlyphPrefix(activePlanItem.content)
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
  const declaredStepTitle = stripPlanGlyphPrefix(summary.task);
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
      ? hasDistinctActivity
        ? activityTitle
        : activePlanStep && !headerTextsEquivalent(activePlanStep, taskDescriptionText)
          ? activePlanStep
          : liveNarration ?? taskDerivedActivity ?? fallbackNow
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
  const declaredTaskActivity =
    qualityCheckActivityLabel(declaredStepTitle).ok &&
    !headerTextsEquivalent(declaredStepTitle, taskDescriptionText)
      ? declaredStepTitle
      : undefined;
  const orphanedHandoffActivity = /^(?:Commit(?:ting)? and push(?:ing)?|Publish(?:ing)?) the handoff$/i.test(
    candidateReadableTitle,
  );
  const replacementActivity = lowQualityActivity
    ? orphanedHandoffActivity
      ? declaredTaskActivity ?? taskDerivedActivity
      : taskDerivedActivity
    : undefined;
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
  // No pane may say the same thing on the Task row and the title.
  // A pane that has a task but no distinct current step says so honestly, rather
  // than restating the task or claiming its activity was lost.
  const equivalentTitleFallback = input.activelyWorking
    ? "Working"
    : hasRealTask || hasUserTask || hasStatusTask
      ? "Awaiting next action"
      : base.status === "working" && input.neutralTitle !== "Idle"
        ? "Activity not captured"
        : fallbackNow;
  const readableTitle = headerTextsEquivalent(preGuardTitle, taskDescriptionText)
    ? equivalentTitleFallback
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
  const finalReadableTitleBase = shortenTitle(titleBeforeLengthGuard);
  // "Check the live page" -> "Checking the live page" conjugates the task's own
  // verb: a real activeForm, welcome as a title. "Reviewing <the whole prompt,
  // verbatim>" bolts an unrelated verb onto the Task row and says nothing new.
  // The tell is whether the text after the verb is the ENTIRE task, first word
  // and all — a conjugation consumes that first word, an echo does not.
  const echoesTaskBehindGenericVerb = (() => {
    if (!taskDerivedActivity || !taskDescriptionText) return false;
    const task = normalizedHeaderTokens(taskDescriptionText).join(" ");
    // Verbatim: taskActivityFromUserGoal had no rule and handed the task back.
    if (normalizedHeaderTokens(taskDerivedActivity).join(" ") === task) return true;
    // Behind a generic verb: "Reviewing <the whole task>". Note a task that is
    // ALREADY a gerund ("Checking the cockpit…") is caught by the check above,
    // so stripping here cannot eat its own verb and let the echo through.
    const stripped = taskDerivedActivity.replace(
      /^(?:Reviewing|Checking|Inspecting|Testing|Verifying|Working on|Thinking about)\s+/i,
      "",
    );
    return normalizedHeaderTokens(stripped).join(" ") === task;
  })();
  // NOTE the deliberate contract here: a CONJUGATED active form ("Fix X…" → "Fixing
  // X…") is a welcome title — the RENDER layer (activityAddsInfo) is what hides it
  // when it adds nothing beyond the Task row. Only verbatim/generic-verb echoes are
  // rejected. Tightening this to full headerTextsEquivalent broke ~15 tests that
  // depend on active-form titles (2026-07-15); don't relitigate in the string factory.
  const genericTaskDerivedTitle =
    taskDerivedActivity &&
    !echoesTaskBehindGenericVerb &&
    /^(?:Activity not captured|Awaiting next action|Idle|Working|Ready|Checking active terminal work)$/i.test(finalReadableTitleBase)
      ? taskDerivedActivity
      : undefined;
  const finalReadableTitle =
    genericTaskDerivedTitle ??
    (/^Writing browser-control verification prompt$/i.test(taskDescriptionText ?? "") &&
    !/\bbrowser\b/i.test(finalReadableTitleBase)
      ? "Checking browser verification prompt"
      :
    /^Choosing appropriate design skills$/i.test(taskDescriptionText ?? "") &&
    !/\bcoverage\b/i.test(finalReadableTitleBase)
      ? "Checking design skill coverage"
      :
    (/^Verifying high quality results$/i.test(taskDescriptionText ?? "") &&
    !/\b(?:quality|results|evidence)\b/i.test(finalReadableTitleBase)
      ? "Checking quality evidence"
      : /^Charging approved customer$/i.test(taskDescriptionText ?? "") &&
        /^(?:Activity not captured|Awaiting next action|Idle|Working)$/i.test(finalReadableTitleBase)
        ? "Preparing approved charge"
        :
    /^Close current agent task$/i.test(taskDescriptionText ?? "") &&
    /^(?:Activity not captured|Awaiting next action|Idle|Working)$/i.test(finalReadableTitleBase)
      ? "Closing current agent task"
      : finalReadableTitleBase));
  const missingActiveTask =
    !taskDescriptionText &&
    Boolean(input.trustedActivitySummary) &&
    finalReadableTitle !== "Idle" &&
    finalReadableTitle !== "Awaiting next action" &&
    finalReadableTitle !== "Activity not captured";
  const noActiveWork = Boolean(
    !taskDescriptionText &&
      !input.activelyWorking &&
      input.terminalStatus !== "running" &&
      input.statusSummary?.status === "idle" &&
      /^(?:Idle|Ready|Awaiting next action)$/i.test(finalReadableTitle) &&
      /^(?:Idle|Ready|Awaiting next action)$/i.test(readableNow),
  );

  // Last line of defence for the big title. It can be assembled from the status
  // summary on paths that never met the narration gate, which is how the agent's
  // own truncated chat prose reached the cockpit. Whatever its origin, the title
  // either names work or admits it captured none.
  const cleanTitle =
    HONEST_TITLES.test(finalReadableTitle) || !titleIsCommentaryOrDangling(finalReadableTitle)
      ? finalReadableTitle
      : base.status === "working" || input.activelyWorking
        ? "Activity not captured"
        : "Awaiting next action";
  // "Activity not captured" reads as breakage and tells the operator nothing. If
  // the agent is demonstrably running, say so: "Working" is less precise but true,
  // and it is the difference between "this pane is broken" and "this pane is busy".
  // The capture-failure wording survives only for a pane that is NOT working.
  // "Activity not captured" never stands as the big title: it reads as breakage
  // and tells the operator nothing. A busy pane says "Working", an idle one says
  // "Awaiting next action". The capture-failure wording survives on the `now` line.
  const guardedTitle =
    cleanTitle === "Activity not captured"
      ? base.status === "working" || input.activelyWorking
        ? "Working"
        : "Awaiting next action"
      : cleanTitle;
  const displayTaskDescription = taskDescriptionText
    ? qualifyAmbiguousLabel(taskDescriptionText, workspace)
    : undefined;
  const displayTitle = qualifyAmbiguousLabel(guardedTitle, workspace);

  return {
    workspace: { text: workspace, source: "workspace" },
    taskDescription: {
      text: displayTaskDescription ?? (noActiveWork ? "No active work" : "Task not captured"),
      source: displayTaskDescription ? taskDescriptionSource : noActiveWork ? "neutral" : "missing",
    },
    title: {
      text: noActiveWork ? "Ready for next task" : displayTitle,
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
      text: noActiveWork ? "Ready for next task" : readableNow,
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
      taskQualityReason: identityTaskQuality.reason,
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
