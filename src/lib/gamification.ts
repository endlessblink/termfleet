import type { Tab } from "./types";
import { paneBadgeAttention } from "./sessionStatus";

const GAMIFICATION_RELEASE_ID = import.meta.env?.VITE_TERMFLEET_RELEASE_ID ?? "dev";
export const GAMIFICATION_STORAGE_KEY = "termfleet.gamification.v6";

export const WORKSTREAM_QUEST_ENABLED_KEY = "termfleet.workstreamQuest.enabled";

/**
 * Workstream Quest is opt-in for the public preview. The first read decides once
 * (on only for a profile that already has quest progress) and records the answer,
 * so later quest writes or a saved layout can never flip it.
 */
export function workstreamQuestEnabledPreference() {
  try {
    const stored = window.localStorage.getItem(WORKSTREAM_QUEST_ENABLED_KEY);
    if (stored === "1") return true;
    if (stored === "0") return false;
    const enabled = window.localStorage.getItem(GAMIFICATION_STORAGE_KEY) !== null;
    window.localStorage.setItem(WORKSTREAM_QUEST_ENABLED_KEY, enabled ? "1" : "0");
    return enabled;
  } catch {
    return false;
  }
}

export function saveWorkstreamQuestEnabled(enabled: boolean) {
  try {
    window.localStorage.setItem(WORKSTREAM_QUEST_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
}
const LEGACY_GAMIFICATION_STORAGE_KEY = `termfleet.gamification.v6.${GAMIFICATION_RELEASE_ID}`;
export const GAMIFICATION_CHANGED_EVENT = "termfleet-gamification-changed";
export const WORKSTREAM_QUEST_ID = "parallel-work";
export const WORKSTREAM_QUEST_LABEL = "Workstream Quest";
export const QUEST_MISSION_ORDER = [WORKSTREAM_QUEST_ID, "finish-goal", "clean-run"] as const;

// A single missed status poll or a pane briefly reporting "idle" between two
// agent turns must not wipe a long Workstream Quest run. The run pauses and only
// resets when fewer than three workstreams stay live for this long.
export const PARALLEL_BREAK_GRACE_MS = 30_000;
// The quest clock only advances while the cockpit is actually watching. A gap
// longer than this between two ticks means the app was closed or the machine
// slept, and that gap is never counted as sustained work.
export const MAX_QUEST_TICK_GAP_MS = 90_000;
// Scheme 2 scoped goal ids per session; scheme 3 added finished agent jobs.
// records written before this scheme re-baseline once instead of re-counting.
const GOAL_ID_SCHEME = 3;
const MAX_STORED_EVENTS = 400;
const MAX_IGNORED_EVENT_IDS = 4000;

export type GamificationEventType = "goal-completed" | "command-succeeded" | "terminal-recovered";

export interface GamificationEvent {
  id: string;
  type: GamificationEventType;
  title: string;
  detail: string;
  points: number;
  occurredAt: number;
}

/** Totals for events that were compacted out of the stored event list. */
export interface GamificationArchive {
  points: number;
  completedGoals: number;
  successfulCommands: number;
  recoveredTerminals: number;
  firstGoalDetail: string | null;
  firstCommandDetail: string | null;
}

export interface GamificationRecord {
  version: 6;
  events: GamificationEvent[];
  ignoredEventIds: string[];
  maxActiveWorkstreams: number;
  baselineActiveWorkstreams: number;
  parallelWorkstreamStartedAt: number | null;
  parallelWorkstreamSeconds: number;
  parallelBestSeconds: number;
  activeQuestId: string | null;
  questAcceptedAt: number | null;
  initializedAt: number;
  updatedAt: number;
  /** Precise accumulated run time; seconds are derived from it. */
  parallelWorkstreamMs?: number;
  /** When fewer than three workstreams became live during a running quest. */
  parallelBreakStartedAt?: number | null;
  goalIdScheme?: number;
  archive?: GamificationArchive;
}

export interface GamificationFacts {
  events: GamificationEvent[];
  activeWorkstreams: number;
}

export function isLiveWorkstreamTerminal(terminal: Tab["terminals"][number]): boolean {
  // "Busy" must mean what the card's own badge says. The runtime status
  // "running" only means the terminal process is alive, so every idle prompt
  // used to glow and count toward "3 agents busy". Use the same Running rule as
  // the badge, plus a shell command that is still executing.
  return paneBadgeAttention(terminal) === "running" ||
    terminal.durableActivity?.status === "running";
}

export interface GamificationMission {
  id: string;
  title: string;
  detail: string;
  nextAction: string;
  progress: number;
  target: number;
  complete: boolean;
}

export interface GamificationSummary {
  points: number;
  completedGoals: number;
  successfulCommands: number;
  recoveredTerminals: number;
  maxActiveWorkstreams: number;
  level: number;
  currentLevelPoints: number;
  nextLevelPoints: number | null;
  levelProgressPercent: number;
  achievements: GamificationAchievement[];
  badges: string[];
  missions: GamificationMission[];
  recentEvents: GamificationEvent[];
}

export interface GamificationAchievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
  evidence?: string;
}

export interface GamificationReward {
  title: string;
  detail: string;
  points: number;
  eventId?: string;
  levelReached?: number;
}

export function findMissionTarget(tabs: Tab[], missionId: string): { tabId: string; paneId: string } | null {
  const candidates = tabs.flatMap((tab) => tab.terminals.map((terminal) => ({ tab, terminal })));
  const hasOpenGoal = (terminal: Tab["terminals"][number]) => Boolean(terminal.taskLineup?.some((task) => task.status === "in_progress"));
  // The workstream target uses the same liveness rule as the quest counter, so
  // "3/3 counting" never coexists with a missing Focus button.
  const match = missionId === "finish-goal"
    // Show an agent that is working right now (its finish will score), else any agent.
    ? candidates.find(({ terminal }) => terminal.statusSummary?.status === "working")
      ?? candidates.find(({ terminal }) => Boolean(terminal.statusSummary?.provider || terminal.agentProvider))
    : missionId === "clean-run"
      ? candidates.find(({ terminal }) => terminal.durableActivity?.status === "running")
      : candidates.find(({ terminal }) => isLiveWorkstreamTerminal(terminal) && hasOpenGoal(terminal))
        ?? candidates.find(({ terminal }) => isLiveWorkstreamTerminal(terminal));
  return match ? { tabId: match.tab.id, paneId: match.terminal.paneId } : null;
}

// Levels should mark durable progress, not every busy session. A normal goal
// takes several meaningful completions to move the level, while the track has
// room for long-lived TermFleet use. Past the table, every 5000 points is a level.
const LEVEL_THRESHOLDS = [0, 100, 300, 750, 1500, 3000, 6000];
const LEVEL_STEP_AFTER_TABLE = 5000;

// Repeatable milestones keep a challenge available after the first wins.
const GOAL_TIERS = [3, 10, 25, 50, 100, 250];
const COMMAND_TIERS = [1, 10, 50, 150];

export const GAMIFICATION_ACHIEVEMENTS = [
  { id: "first-finish", title: "First finish", description: "An agent finished a job you gave it." },
  { id: "on-a-roll", title: "On a roll", description: "Agents finished 10 jobs." },
  { id: "closer", title: "Closer", description: "Agents finished 25 jobs." },
  { id: "clean-run", title: "Clean run", description: "A command you ran finished without errors." },
  { id: "steady-hands", title: "Steady hands", description: "10 commands finished without errors." },
  { id: "parallel-warmup", title: "Parallel warm-up", description: "3 agents stayed busy at the same time for 10 minutes." },
  { id: "parallel-deep-focus", title: "Deep focus", description: "3 agents stayed busy at the same time for 30 minutes." },
  { id: "parallel-fleet-captain", title: "Fleet captain", description: "3 agents stayed busy at the same time for 3 hours." },
] as const;

const EMPTY_ARCHIVE: GamificationArchive = {
  points: 0, completedGoals: 0, successfulCommands: 0, recoveredTerminals: 0, firstGoalDetail: null, firstCommandDetail: null,
};

export const EMPTY_GAMIFICATION_RECORD: GamificationRecord = {
  version: 6,
  events: [],
  ignoredEventIds: [],
  maxActiveWorkstreams: 0,
  baselineActiveWorkstreams: 0,
  parallelWorkstreamStartedAt: null,
  parallelWorkstreamSeconds: 0,
  parallelBestSeconds: 0,
  activeQuestId: null,
  questAcceptedAt: null,
  initializedAt: 0,
  updatedAt: 0,
  parallelWorkstreamMs: 0,
  parallelBreakStartedAt: null,
  goalIdScheme: GOAL_ID_SCHEME,
  archive: EMPTY_ARCHIVE,
};

function activityEventId(terminalId: string, activity: NonNullable<Tab["terminals"][number]["durableActivity"]>) {
  const stableMoment = activity.completedAt;
  if (!stableMoment) return null;
  return `activity:${terminalId}:${stableMoment}:${activity.command ?? activity.title}`;
}

function shortHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

// Agent task ids restart at "1" in every session, so an id alone collides
// across sessions and panes and silently stops awarding goals. Scope it to the
// run (or the pane when no run is known) and the task text.
function goalEventId(terminal: Tab["terminals"][number], task: NonNullable<Tab["terminals"][number]["taskLineup"]>[number]) {
  const scope = task.runId ? `run:${task.runId}` : `pane:${terminal.paneId}`;
  return `goal:${scope}:${task.id}:${shortHash(task.content.trim())}`;
}

export function collectGamificationFacts(tabs: Tab[]): GamificationFacts {
  const events: GamificationEvent[] = [];
  const seen = new Set<string>();
  let activeWorkstreams = 0;

  for (const tab of tabs) {
    for (const terminal of tab.terminals) {
      if (isLiveWorkstreamTerminal(terminal)) activeWorkstreams += 1;

      for (const task of terminal.taskLineup ?? []) {
        if (task.status !== "completed") continue;
        const id = goalEventId(terminal, task);
        if (seen.has(id)) continue;
        seen.add(id);
        events.push({ id, type: "goal-completed", title: "Checklist item done", detail: task.content, points: 25, occurredAt: task.updatedAt });
      }

      // An agent job: the agent finished the turn you gave it and is waiting for
      // you again. The hook's last-write time is stable for that finished turn,
      // so repeated polls of the same idle pane never count it twice.
      const summary = terminal.statusSummary;
      const finishedTurnAt = summary?.updatedAt;
      if ((summary?.status === "idle" || summary?.status === "done") && finishedTurnAt
        && (summary.provider || terminal.agentProvider)
        && (Boolean(summary.narration) || (summary.recent?.length ?? 0) > 0)) {
        const id = `job:${terminal.paneId}:${finishedTurnAt}`;
        if (!seen.has(id)) {
          seen.add(id);
          const ask = terminal.mainUserAsk?.text?.trim() || summary.userTask?.trim() || summary.task?.trim() || "Agent finished your request";
          events.push({ id, type: "goal-completed", title: "Agent job finished", detail: ask, points: 10, occurredAt: finishedTurnAt });
        }
      }

      const activity = terminal.durableActivity;
      if (activity?.status === "success" && (activity.source === "command" || Boolean(activity.command))) {
        const id = activityEventId(terminal.id, activity);
        if (id && !seen.has(id)) {
          seen.add(id);
          events.push({ id, type: "command-succeeded", title: "Command succeeded", detail: activity.command ?? activity.title, points: 5, occurredAt: activity.completedAt ?? activity.updatedAt });
        }
      }

      if (terminal.status === "reconnected" && terminal.lastStatusAt) {
        const id = `recovery:${terminal.id}:${terminal.lastStatusAt}`;
        if (!seen.has(id)) {
          seen.add(id);
          events.push({ id, type: "terminal-recovered", title: "Terminal recovered", detail: terminal.purpose?.title ?? terminal.mainUserAsk?.text ?? "Workstream restored", points: 0, occurredAt: terminal.lastStatusAt });
        }
      }
    }
  }

  return { events: events.sort((a, b) => a.occurredAt - b.occurredAt), activeWorkstreams };
}

// Keep local storage bounded: old receipts fold into totals, and their ids stay
// ignored so a task still visible in a pane can never be counted twice.
function compactRecord(events: GamificationEvent[], ignored: string[], archive: GamificationArchive) {
  if (events.length <= MAX_STORED_EVENTS && ignored.length <= MAX_IGNORED_EVENT_IDS) return { events, ignored, archive };
  const overflow = Math.max(0, events.length - MAX_STORED_EVENTS);
  const retired = events.slice(0, overflow);
  const nextArchive = retired.reduce<GamificationArchive>((totals, event) => ({
    points: totals.points + event.points,
    completedGoals: totals.completedGoals + (event.type === "goal-completed" ? 1 : 0),
    successfulCommands: totals.successfulCommands + (event.type === "command-succeeded" ? 1 : 0),
    recoveredTerminals: totals.recoveredTerminals + (event.type === "terminal-recovered" ? 1 : 0),
    firstGoalDetail: totals.firstGoalDetail ?? (event.type === "goal-completed" ? event.detail : null),
    firstCommandDetail: totals.firstCommandDetail ?? (event.type === "command-succeeded" ? event.detail : null),
  }), archive);
  const nextIgnored = [...ignored, ...retired.map((event) => event.id)].slice(-MAX_IGNORED_EVENT_IDS);
  return { events: events.slice(overflow), ignored: nextIgnored, archive: nextArchive };
}

function questRunMs(record: GamificationRecord) {
  return typeof record.parallelWorkstreamMs === "number" ? record.parallelWorkstreamMs : record.parallelWorkstreamSeconds * 1000;
}

export function mergeGamificationRecord(record: GamificationRecord, facts: GamificationFacts, updatedAt: number): GamificationRecord {
  const ignored = new Set(record.ignoredEventIds);
  const existing = new Map(record.events.map((event) => [event.id, event]));
  for (const event of facts.events) {
    if (!ignored.has(event.id)) existing.set(event.id, event);
  }

  const parallelQuestAccepted =
    record.activeQuestId === "parallel-work" && record.questAcceptedAt !== null;
  const wasRunning = record.parallelWorkstreamStartedAt !== null;
  let parallelStartedAt: number | null = null;
  let parallelMs = 0;
  let breakStartedAt: number | null = null;
  if (parallelQuestAccepted && facts.activeWorkstreams >= 3) {
    // Advance by the time since the last observed tick, never by wall time
    // since the run began: a closed app or a sleeping laptop must not count.
    const tick = wasRunning ? Math.min(Math.max(0, updatedAt - record.updatedAt), MAX_QUEST_TICK_GAP_MS) : 0;
    parallelStartedAt = record.parallelWorkstreamStartedAt ?? updatedAt;
    parallelMs = questRunMs(record) + tick;
  } else if (parallelQuestAccepted && wasRunning) {
    breakStartedAt = record.parallelBreakStartedAt ?? updatedAt;
    if (updatedAt - breakStartedAt <= PARALLEL_BREAK_GRACE_MS) {
      parallelStartedAt = record.parallelWorkstreamStartedAt;
      parallelMs = questRunMs(record);
    } else {
      breakStartedAt = null;
    }
  }
  const parallelSeconds = Math.floor(parallelMs / 1000);
  const parallelBestSeconds = Math.max(record.parallelBestSeconds, parallelSeconds);

  const compacted = compactRecord(
    [...existing.values()].sort((a, b) => a.occurredAt - b.occurredAt),
    [...ignored],
    record.archive ?? EMPTY_ARCHIVE,
  );
  return {
    version: 6,
    events: compacted.events,
    ignoredEventIds: compacted.ignored,
    maxActiveWorkstreams: Math.max(record.maxActiveWorkstreams, Math.max(0, facts.activeWorkstreams - record.baselineActiveWorkstreams)),
    baselineActiveWorkstreams: record.baselineActiveWorkstreams,
    parallelWorkstreamStartedAt: parallelStartedAt,
    parallelWorkstreamSeconds: parallelSeconds,
    parallelBestSeconds,
    activeQuestId: record.activeQuestId,
    questAcceptedAt: record.questAcceptedAt,
    initializedAt: record.initializedAt || updatedAt,
    updatedAt: Math.max(updatedAt, record.updatedAt),
    parallelWorkstreamMs: parallelMs,
    parallelBreakStartedAt: breakStartedAt,
    goalIdScheme: record.goalIdScheme ?? GOAL_ID_SCHEME,
    archive: compacted.archive,
  };
}

/** Seconds left before a paused Workstream Quest run resets, or null when not paused. */
export function parallelBreakSecondsLeft(record: GamificationRecord, now: number): number | null {
  if (record.parallelBreakStartedAt == null || record.parallelWorkstreamStartedAt === null) return null;
  return Math.max(0, Math.ceil((PARALLEL_BREAK_GRACE_MS - (now - record.parallelBreakStartedAt)) / 1000));
}

export function syncGamificationRecord(record: GamificationRecord, tabs: Tab[], updatedAt: number): GamificationRecord {
  const facts = collectGamificationFacts(tabs);
  const initialized = initializeGamificationRecord(record, facts, updatedAt);
  return mergeGamificationRecord(initialized, facts, updatedAt);
}

export function initializeGamificationRecord(record: GamificationRecord, facts: GamificationFacts, initializedAt: number): GamificationRecord {
  if (record.initializedAt !== 0 && record.goalIdScheme === GOAL_ID_SCHEME) return record;
  const ignoredEventIds = [...new Set([...record.ignoredEventIds, ...facts.events.map((event) => event.id)])];
  if (record.initializedAt !== 0) {
    // Existing profile from before scoped goal ids: keep everything earned, but
    // treat work already on screen as seen so it is not awarded a second time.
    return { ...record, ignoredEventIds, goalIdScheme: GOAL_ID_SCHEME };
  }
  return {
    ...record,
    ignoredEventIds,
    baselineActiveWorkstreams: facts.activeWorkstreams,
    goalIdScheme: GOAL_ID_SCHEME,
    initializedAt,
    updatedAt: initializedAt,
  };
}

function levelForPoints(points: number) {
  const tableIndex = LEVEL_THRESHOLDS.reduce((index, threshold, candidate) => points >= threshold ? candidate : index, 0);
  const lastThreshold = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1];
  if (points < lastThreshold || tableIndex < LEVEL_THRESHOLDS.length - 1) {
    return { level: tableIndex + 1, currentThreshold: LEVEL_THRESHOLDS[tableIndex], nextThreshold: LEVEL_THRESHOLDS[tableIndex + 1] ?? lastThreshold + LEVEL_STEP_AFTER_TABLE };
  }
  const extra = Math.floor((points - lastThreshold) / LEVEL_STEP_AFTER_TABLE);
  const currentThreshold = lastThreshold + extra * LEVEL_STEP_AFTER_TABLE;
  return { level: LEVEL_THRESHOLDS.length + extra, currentThreshold, nextThreshold: currentThreshold + LEVEL_STEP_AFTER_TABLE };
}

function nextTier(tiers: number[], count: number) {
  return tiers.find((tier) => count < tier) ?? tiers[tiers.length - 1];
}

export function summarizeGamification(record: GamificationRecord): GamificationSummary {
  const archive = record.archive ?? EMPTY_ARCHIVE;
  const completedGoals = archive.completedGoals + record.events.filter((event) => event.type === "goal-completed").length;
  const successfulCommands = archive.successfulCommands + record.events.filter((event) => event.type === "command-succeeded").length;
  const recoveredTerminals = archive.recoveredTerminals + record.events.filter((event) => event.type === "terminal-recovered").length;
  const points = archive.points + record.events.reduce((total, event) => total + event.points, 0);
  const { level, currentThreshold, nextThreshold } = levelForPoints(points);
  const levelProgressPercent = Math.min(100, Math.max(0, Math.round(((points - currentThreshold) / (nextThreshold - currentThreshold)) * 100)));
  const unlocked = new Set([
    ...(completedGoals >= 1 ? ["first-finish"] : []),
    ...(completedGoals >= 10 ? ["on-a-roll"] : []),
    ...(completedGoals >= 25 ? ["closer"] : []),
    ...(successfulCommands >= 1 ? ["clean-run"] : []),
    ...(successfulCommands >= 10 ? ["steady-hands"] : []),
    ...(record.parallelBestSeconds >= 600 ? ["parallel-warmup"] : []),
    ...(record.parallelBestSeconds >= 1800 ? ["parallel-deep-focus"] : []),
    ...(record.parallelBestSeconds >= 10800 ? ["parallel-fleet-captain"] : []),
  ]);
  const goalEvents = record.events.filter((event) => event.type === "goal-completed");
  const commandEvents = record.events.filter((event) => event.type === "command-succeeded");
  const evidenceById: Record<string, string> = {
    "first-finish": archive.firstGoalDetail ?? goalEvents[0]?.detail ?? "An agent finished a job",
    "on-a-roll": goalEvents[goalEvents.length - 1]?.detail ?? "Agents finished ten jobs",
    "closer": goalEvents[goalEvents.length - 1]?.detail ?? "Agents finished twenty-five jobs",
    "clean-run": archive.firstCommandDetail ?? commandEvents[0]?.detail ?? "A command finished without errors",
    "steady-hands": commandEvents[commandEvents.length - 1]?.detail ?? "Ten commands finished without errors",
    "parallel-warmup": "Three agents stayed busy together for 10 minutes",
    "parallel-deep-focus": "Three agents stayed busy together for 30 minutes",
    "parallel-fleet-captain": "Three agents stayed busy together for 3 hours",
  };
  const achievements = GAMIFICATION_ACHIEVEMENTS.map((achievement) => ({ ...achievement, unlocked: unlocked.has(achievement.id), evidence: unlocked.has(achievement.id) ? evidenceById[achievement.id] : undefined }));
  const goalTarget = nextTier(GOAL_TIERS, completedGoals);
  const commandTarget = nextTier(COMMAND_TIERS, successfulCommands);
  const parallelTarget = record.parallelBestSeconds < 600 ? 600 : record.parallelBestSeconds < 1800 ? 1800 : 10800;
  const missions: GamificationMission[] = [
    // Every quest must be doable from what the operator already does, and say
    // so in one plain sentence. "Tracked goal" and "checklist item" both failed
    // that test; a finished agent job is something they see many times a day.
    { id: "finish-goal", title: `Get agents to finish ${goalTarget} jobs`, detail: "Ask any agent to do something. It counts when the agent finishes and is waiting for you again.", nextAction: "Ask an agent to do something", progress: Math.min(completedGoals, goalTarget), target: goalTarget, complete: completedGoals >= GOAL_TIERS[GOAL_TIERS.length - 1] },
    { id: "clean-run", title: commandTarget === 1 ? "Finish one successful command" : `Finish ${commandTarget} successful commands`, detail: "Type a command in a terminal, like running tests or a build. It counts when it finishes without errors.", nextAction: "Run a command in any terminal. Clicking Focus work does not count.", progress: Math.min(successfulCommands, commandTarget), target: commandTarget, complete: successfulCommands >= COMMAND_TIERS[COMMAND_TIERS.length - 1] },
    { id: "parallel-work", title: parallelTarget === 600 ? "Keep 3 agents busy for 10 minutes" : parallelTarget === 1800 ? "Keep 3 agents busy for 30 minutes" : "Keep 3 agents busy for 3 hours", detail: `Have three terminals working at the same time. A short pause is fine; a break over ${PARALLEL_BREAK_GRACE_MS / 1000} seconds restarts the clock. Badges you earned stay.`, nextAction: "Keep three terminals working; idle ones do not count.", progress: Math.min(record.parallelWorkstreamSeconds, parallelTarget), target: parallelTarget, complete: record.parallelBestSeconds >= 10800 },
  ];
  return {
    points, completedGoals, successfulCommands, recoveredTerminals,
    maxActiveWorkstreams: record.maxActiveWorkstreams, level, currentLevelPoints: points - currentThreshold,
    nextLevelPoints: nextThreshold, levelProgressPercent, achievements,
    badges: achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.title),
    missions, recentEvents: [...record.events].reverse().slice(0, 6),
  };
}

export function activeQuestMission(record: GamificationRecord, summary = summarizeGamification(record)) {
  if (!record.activeQuestId || record.questAcceptedAt === null) return null;
  const mission = summary.missions.find((candidate) => candidate.id === record.activeQuestId);
  return mission && !mission.complete ? mission : null;
}

export function nextAvailableQuest(summary: GamificationSummary) {
  return QUEST_MISSION_ORDER
    .map((id) => summary.missions.find((mission) => mission.id === id))
    .find((mission): mission is GamificationMission => Boolean(mission && !mission.complete)) ?? null;
}

export function retireCompletedQuest(record: GamificationRecord): GamificationRecord {
  if (!record.activeQuestId || record.questAcceptedAt === null) return record;
  const mission = summarizeGamification(record).missions.find((candidate) => candidate.id === record.activeQuestId);
  return mission?.complete
    ? { ...record, activeQuestId: null, questAcceptedAt: null }
    : record;
}

export function rewardForTransition(previous: GamificationSummary, next: GamificationSummary): GamificationReward | null {
  const newEvents = next.recentEvents.filter((event) => !previous.recentEvents.some((old) => old.id === event.id));
  // A shrinking or reset profile is never a reward.
  if (next.points < previous.points) return null;
  const scoring = newEvents.filter((event) => event.points > 0);
  const gained = next.points - previous.points;
  const levelReached = next.level > previous.level ? next.level : undefined;
  const achievement = next.achievements.find((candidate) => candidate.unlocked && !previous.achievements.some((old) => old.id === candidate.id && old.unlocked));
  const newEvent = scoring[0] ?? newEvents[0];
  if (achievement && newEvent?.type !== "terminal-recovered") return { title: "Achievement earned", detail: `${achievement.title} · ${achievement.evidence ?? achievement.description}`, points: gained, eventId: newEvent?.id, levelReached };
  if (scoring.length > 1) return { title: `${scoring.length} wins`, detail: `${scoring[0].detail} and ${scoring.length - 1} more`, points: gained, eventId: scoring[0].id, levelReached };
  if (scoring.length === 1) return { title: scoring[0].title, detail: scoring[0].detail, points: gained, eventId: scoring[0].id, levelReached };
  if (levelReached) return { title: `Level ${levelReached} reached`, detail: `${next.points} points earned`, points: 0, levelReached };
  return null;
}

function parseArchive(value: unknown): GamificationArchive {
  if (!value || typeof value !== "object") return EMPTY_ARCHIVE;
  const archive = value as Partial<GamificationArchive>;
  const count = (field: unknown) => (typeof field === "number" && Number.isFinite(field) && field >= 0 ? field : 0);
  return {
    points: count(archive.points),
    completedGoals: count(archive.completedGoals),
    successfulCommands: count(archive.successfulCommands),
    recoveredTerminals: count(archive.recoveredTerminals),
    firstGoalDetail: typeof archive.firstGoalDetail === "string" ? archive.firstGoalDetail : null,
    firstCommandDetail: typeof archive.firstCommandDetail === "string" ? archive.firstCommandDetail : null,
  };
}

export function loadGamificationRecord(storage: Pick<Storage, "getItem"> | undefined): GamificationRecord {
  if (!storage) return EMPTY_GAMIFICATION_RECORD;
  if (unsavedRecord && typeof window !== "undefined" && storage === window.localStorage) return unsavedRecord;
  try {
    const parsed = JSON.parse(storage.getItem(GAMIFICATION_STORAGE_KEY) ?? storage.getItem(LEGACY_GAMIFICATION_STORAGE_KEY) ?? "null") as Partial<GamificationRecord> | null;
    if (parsed?.version !== 6 || !Array.isArray(parsed.events)) return EMPTY_GAMIFICATION_RECORD;
    const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
    return {
      version: 6,
      events: parsed.events.filter((event): event is GamificationEvent => Boolean(event && typeof event.id === "string" && typeof event.type === "string" && finite(event.points) && finite(event.occurredAt))),
      ignoredEventIds: Array.isArray(parsed.ignoredEventIds) ? parsed.ignoredEventIds.filter((id): id is string => typeof id === "string") : [],
      maxActiveWorkstreams: finite(parsed.maxActiveWorkstreams) ? parsed.maxActiveWorkstreams : 0,
      baselineActiveWorkstreams: finite(parsed.baselineActiveWorkstreams) ? parsed.baselineActiveWorkstreams : 0,
      parallelWorkstreamStartedAt: finite(parsed.parallelWorkstreamStartedAt) ? parsed.parallelWorkstreamStartedAt : null,
      parallelWorkstreamSeconds: finite(parsed.parallelWorkstreamSeconds) ? parsed.parallelWorkstreamSeconds : 0,
      parallelBestSeconds: finite(parsed.parallelBestSeconds) ? parsed.parallelBestSeconds : 0,
      activeQuestId: typeof parsed.activeQuestId === "string" ? parsed.activeQuestId : null,
      questAcceptedAt: finite(parsed.questAcceptedAt) ? parsed.questAcceptedAt : null,
      initializedAt: finite(parsed.initializedAt) ? parsed.initializedAt : 0,
      updatedAt: finite(parsed.updatedAt) ? parsed.updatedAt : 0,
      ...(finite(parsed.parallelWorkstreamMs) ? { parallelWorkstreamMs: parsed.parallelWorkstreamMs } : {}),
      parallelBreakStartedAt: finite(parsed.parallelBreakStartedAt) ? parsed.parallelBreakStartedAt : null,
      // A saved profile without a scheme predates scoped goal ids.
      goalIdScheme: finite(parsed.goalIdScheme) ? parsed.goalIdScheme : 1,
      archive: parseArchive(parsed.archive),
    };
  } catch {
    return EMPTY_GAMIFICATION_RECORD;
  }
}

const GAMIFICATION_KEY_PREFIX = "termfleet.gamification.";

/**
 * Remove retired quest profiles. Old releases left several megabytes of scores
 * under earlier keys; once browser storage is full every save fails silently,
 * so pressing Start quest appeared to do nothing. The current key is always
 * kept; the previous-release key is kept only while it is still the sole copy.
 */
export function pruneRetiredGamificationStorage(storage: Pick<Storage, "getItem" | "removeItem" | "key" | "length"> | undefined, dropLegacy = false) {
  if (!storage) return 0;
  try {
    const keepLegacy = !dropLegacy && storage.getItem(GAMIFICATION_STORAGE_KEY) === null;
    const retired: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key || !key.startsWith(GAMIFICATION_KEY_PREFIX) || key === GAMIFICATION_STORAGE_KEY) continue;
      if (keepLegacy && key === LEGACY_GAMIFICATION_STORAGE_KEY) continue;
      retired.push(key);
    }
    retired.forEach((key) => storage.removeItem(key));
    return retired.length;
  } catch {
    return 0;
  }
}

// When storage refuses a write, keep the newest record in memory so the
// player's click still takes effect this session instead of being undone by
// the next reload of the stale saved copy.
let unsavedRecord: GamificationRecord | null = null;

export function saveGamificationRecord(storage: Pick<Storage, "setItem"> | undefined, record: GamificationRecord): boolean {
  if (!storage) return false;
  const serialized = JSON.stringify(record);
  let saved = false;
  try {
    storage.setItem(GAMIFICATION_STORAGE_KEY, serialized);
    saved = true;
  } catch {
    // Most likely full: free the retired profiles and try once more.
    const full = storage as Partial<Storage>;
    if (typeof full.removeItem === "function" && typeof full.key === "function") {
      pruneRetiredGamificationStorage(full as Storage, true);
      try {
        storage.setItem(GAMIFICATION_STORAGE_KEY, serialized);
        saved = true;
      } catch { /* local progress must never break the cockpit */ }
    }
  }
  const isLiveStorage = typeof window !== "undefined" && storage === window.localStorage;
  if (isLiveStorage) {
    unsavedRecord = saved ? null : record;
    if (!saved) console.warn("[termfleet] Quest progress could not be saved; keeping it for this session");
    window.dispatchEvent(new CustomEvent(GAMIFICATION_CHANGED_EVENT));
  }
  return saved;
}

export function isWorkstreamQuestAccepted(record: GamificationRecord) {
  return record.activeQuestId === WORKSTREAM_QUEST_ID && activeQuestMission(record)?.id === WORKSTREAM_QUEST_ID;
}
