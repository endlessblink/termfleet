import type { Tab } from "./types";

const GAMIFICATION_RELEASE_ID = import.meta.env?.VITE_TERMFLEET_RELEASE_ID ?? "dev";
export const GAMIFICATION_STORAGE_KEY = `termfleet.gamification.v6.${GAMIFICATION_RELEASE_ID}`;

export type GamificationEventType = "goal-completed" | "command-succeeded" | "terminal-recovered";

export interface GamificationEvent {
  id: string;
  type: GamificationEventType;
  title: string;
  detail: string;
  points: number;
  occurredAt: number;
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
  initializedAt: number;
  updatedAt: number;
}

export interface GamificationFacts {
  events: GamificationEvent[];
  activeWorkstreams: number;
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
}

export function findMissionTarget(tabs: Tab[], missionId: string): { tabId: string; paneId: string } | null {
  const candidates = tabs.flatMap((tab) => tab.terminals.map((terminal) => ({ tab, terminal })));
  const match = missionId === "finish-goal"
    ? candidates.find(({ terminal }) => terminal.taskLineup?.some((task) => task.status === "in_progress"))
    : missionId === "clean-run"
      ? candidates.find(({ terminal }) => terminal.durableActivity?.status === "running")
      : candidates.find(({ terminal }) => (terminal.status === "running" || terminal.status === "reconnected") && terminal.taskLineup?.some((task) => task.status === "in_progress"));
  return match ? { tabId: match.tab.id, paneId: match.terminal.paneId } : null;
}

// Levels should mark durable progress, not every busy session. A normal goal
// takes several meaningful completions to move the level, while the track has
// room for long-lived TermFleet use.
const LEVEL_THRESHOLDS = [0, 100, 300, 750, 1500, 3000, 6000];

export const GAMIFICATION_ACHIEVEMENTS = [
  { id: "first-finish", title: "First finish", description: "Complete a tracked TermFleet goal." },
  { id: "clean-run", title: "Clean run", description: "Complete a command-backed activity successfully." },
  { id: "parallel-warmup", title: "Parallel warm-up", description: "Keep 3 tracked workstreams active together for 10 minutes." },
  { id: "parallel-deep-focus", title: "Deep focus", description: "Keep 3 tracked workstreams active together for 30 minutes." },
  { id: "parallel-fleet-captain", title: "Fleet captain", description: "Keep 3 tracked workstreams active together for 3 hours." },
] as const;

export const EMPTY_GAMIFICATION_RECORD: GamificationRecord = {
  version: 6,
  events: [],
  ignoredEventIds: [],
  maxActiveWorkstreams: 0,
  baselineActiveWorkstreams: 0,
  parallelWorkstreamStartedAt: null,
  parallelWorkstreamSeconds: 0,
  parallelBestSeconds: 0,
  initializedAt: 0,
  updatedAt: 0,
};

function activityEventId(terminalId: string, activity: NonNullable<Tab["terminals"][number]["durableActivity"]>) {
  const stableMoment = activity.completedAt;
  if (!stableMoment) return null;
  return `activity:${terminalId}:${stableMoment}:${activity.command ?? activity.title}`;
}

export function collectGamificationFacts(tabs: Tab[]): GamificationFacts {
  const events: GamificationEvent[] = [];
  const seen = new Set<string>();
  let activeWorkstreams = 0;

  for (const tab of tabs) {
    for (const terminal of tab.terminals) {
      const isLive = terminal.status === "running" || terminal.status === "reconnected";
      const isWorking = terminal.taskLineup?.some((task) => task.status === "in_progress") || terminal.durableActivity?.status === "running";
      if (isLive && isWorking) activeWorkstreams += 1;

      for (const task of terminal.taskLineup ?? []) {
        if (task.status !== "completed") continue;
        const id = `goal:${task.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        events.push({ id, type: "goal-completed", title: "Goal completed", detail: task.content, points: 25, occurredAt: task.updatedAt });
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

export function mergeGamificationRecord(record: GamificationRecord, facts: GamificationFacts, updatedAt: number): GamificationRecord {
  const ignored = new Set(record.ignoredEventIds);
  const existing = new Map(record.events.map((event) => [event.id, event]));
  for (const event of facts.events) {
    if (!ignored.has(event.id)) existing.set(event.id, event);
  }
  const parallelActive = facts.activeWorkstreams >= 3;
  const parallelStartedAt = parallelActive ? (record.parallelWorkstreamStartedAt ?? updatedAt) : null;
  const parallelSeconds = parallelActive && parallelStartedAt !== null
    ? Math.max(record.parallelWorkstreamSeconds, Math.floor((updatedAt - parallelStartedAt) / 1000))
    : 0;
  const parallelBestSeconds = Math.max(record.parallelBestSeconds, parallelSeconds);
  return {
    version: 6,
    events: [...existing.values()].sort((a, b) => a.occurredAt - b.occurredAt),
    ignoredEventIds: [...ignored],
    maxActiveWorkstreams: Math.max(record.maxActiveWorkstreams, Math.max(0, facts.activeWorkstreams - record.baselineActiveWorkstreams)),
    baselineActiveWorkstreams: record.baselineActiveWorkstreams,
    parallelWorkstreamStartedAt: parallelStartedAt,
    parallelWorkstreamSeconds: parallelSeconds,
    parallelBestSeconds,
    initializedAt: record.initializedAt || updatedAt,
    updatedAt,
  };
}

export function initializeGamificationRecord(record: GamificationRecord, facts: GamificationFacts, initializedAt: number): GamificationRecord {
  if (record.initializedAt !== 0) return record;
  return {
    ...record,
    ignoredEventIds: [...new Set([...record.ignoredEventIds, ...facts.events.map((event) => event.id)])],
    baselineActiveWorkstreams: facts.activeWorkstreams,
    initializedAt,
    updatedAt: initializedAt,
  };
}

export function summarizeGamification(record: GamificationRecord): GamificationSummary {
  const completedGoals = record.events.filter((event) => event.type === "goal-completed").length;
  const successfulCommands = record.events.filter((event) => event.type === "command-succeeded").length;
  const recoveredTerminals = record.events.filter((event) => event.type === "terminal-recovered").length;
  const points = record.events.reduce((total, event) => total + event.points, 0);
  const levelIndex = LEVEL_THRESHOLDS.reduce((index, threshold, candidate) => points >= threshold ? candidate : index, 0);
  const level = levelIndex + 1;
  const currentThreshold = LEVEL_THRESHOLDS[levelIndex];
  const nextLevelPoints = levelIndex < LEVEL_THRESHOLDS.length - 1 ? LEVEL_THRESHOLDS[levelIndex + 1] : null;
  const levelSpan = nextLevelPoints === null ? 6000 - currentThreshold : nextLevelPoints - currentThreshold;
  const levelProgressPercent = Math.min(100, Math.max(0, Math.round(((points - currentThreshold) / levelSpan) * 100)));
  const unlocked = new Set([
    ...(completedGoals >= 1 ? ["first-finish"] : []),
    ...(successfulCommands >= 1 ? ["clean-run"] : []),
    ...(record.parallelBestSeconds >= 600 ? ["parallel-warmup"] : []),
    ...(record.parallelBestSeconds >= 1800 ? ["parallel-deep-focus"] : []),
    ...(record.parallelBestSeconds >= 10800 ? ["parallel-fleet-captain"] : []),
  ]);
  const evidenceById: Record<string, string> = {
    "first-finish": record.events.find((event) => event.type === "goal-completed")?.detail ?? "A tracked goal was completed",
    "clean-run": record.events.find((event) => event.type === "command-succeeded")?.detail ?? "A command-backed activity succeeded",
    "parallel-warmup": "Three tracked workstreams stayed active for 10 minutes",
    "parallel-deep-focus": "Three tracked workstreams stayed active for 30 minutes",
    "parallel-fleet-captain": "Three tracked workstreams stayed active for 3 hours",
  };
  const achievements = GAMIFICATION_ACHIEVEMENTS.map((achievement) => ({ ...achievement, unlocked: unlocked.has(achievement.id), evidence: unlocked.has(achievement.id) ? evidenceById[achievement.id] : undefined }));
  const missions: GamificationMission[] = [
    { id: "finish-goal", title: "Finish the next tracked goal", detail: "Complete work you already marked in TermFleet.", nextAction: "Open a workstream with a pending goal", progress: Math.min(completedGoals, 3), target: 3, complete: completedGoals >= 3 },
    { id: "clean-run", title: "Finish one successful command", detail: "Run a real command in TermFleet and let it finish successfully.", nextAction: "Run a command in the active workstream. Clicking Focus work does not count.", progress: Math.min(successfulCommands, 1), target: 1, complete: successfulCommands > 0 },
    { id: "parallel-work", title: record.parallelBestSeconds < 600 ? "Keep 3 workstreams running for 10 minutes" : record.parallelBestSeconds < 1800 ? "Keep 3 workstreams running for 30 minutes" : "Keep 3 workstreams running for 3 hours", detail: "Keep three live terminals carrying tracked work continuously. A break resets the current run, but earned badges stay earned.", nextAction: "Keep three active workstreams running; idle terminals do not count.", progress: Math.min(record.parallelWorkstreamSeconds, record.parallelBestSeconds < 600 ? 600 : record.parallelBestSeconds < 1800 ? 1800 : 10800), target: record.parallelBestSeconds < 600 ? 600 : record.parallelBestSeconds < 1800 ? 1800 : 10800, complete: record.parallelBestSeconds >= 10800 },
  ];
  return {
    points, completedGoals, successfulCommands, recoveredTerminals,
    maxActiveWorkstreams: record.maxActiveWorkstreams, level, currentLevelPoints: points - currentThreshold,
    nextLevelPoints, levelProgressPercent, achievements,
    badges: achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.title),
    missions, recentEvents: [...record.events].reverse().slice(0, 6),
  };
}

export function rewardForTransition(previous: GamificationSummary, next: GamificationSummary): GamificationReward | null {
  const newEvent = next.recentEvents.find((event) => !previous.recentEvents.some((old) => old.id === event.id));
  const achievement = next.achievements.find((candidate) => candidate.unlocked && !previous.achievements.some((old) => old.id === candidate.id && old.unlocked));
  if (achievement && newEvent?.type !== "terminal-recovered") return { title: "Achievement earned", detail: `${achievement.title} · ${achievement.evidence ?? achievement.description}`, points: newEvent?.points ?? 0, eventId: newEvent?.id };
  if (newEvent?.points) return { title: newEvent.title, detail: newEvent.detail, points: newEvent.points, eventId: newEvent.id };
  if (next.level > previous.level) return { title: `Level ${next.level} reached`, detail: `${next.points} points earned`, points: 0 };
  return null;
}

export function loadGamificationRecord(storage: Pick<Storage, "getItem"> | undefined): GamificationRecord {
  if (!storage) return EMPTY_GAMIFICATION_RECORD;
  try {
    const parsed = JSON.parse(storage.getItem(GAMIFICATION_STORAGE_KEY) ?? "null") as Partial<GamificationRecord> | null;
    if (parsed?.version !== 6 || !Array.isArray(parsed.events)) return EMPTY_GAMIFICATION_RECORD;
    return {
      version: 6,
      events: parsed.events.filter((event): event is GamificationEvent => Boolean(event && typeof event.id === "string" && typeof event.type === "string" && typeof event.points === "number")),
      ignoredEventIds: Array.isArray(parsed.ignoredEventIds) ? parsed.ignoredEventIds.filter((id): id is string => typeof id === "string") : [],
      maxActiveWorkstreams: typeof parsed.maxActiveWorkstreams === "number" ? parsed.maxActiveWorkstreams : 0,
      baselineActiveWorkstreams: typeof parsed.baselineActiveWorkstreams === "number" ? parsed.baselineActiveWorkstreams : 0,
      parallelWorkstreamStartedAt: typeof parsed.parallelWorkstreamStartedAt === "number" ? parsed.parallelWorkstreamStartedAt : null,
      parallelWorkstreamSeconds: typeof parsed.parallelWorkstreamSeconds === "number" ? parsed.parallelWorkstreamSeconds : 0,
      parallelBestSeconds: typeof parsed.parallelBestSeconds === "number" ? parsed.parallelBestSeconds : 0,
      initializedAt: typeof parsed.initializedAt === "number" ? parsed.initializedAt : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return EMPTY_GAMIFICATION_RECORD;
  }
}

export function saveGamificationRecord(storage: Pick<Storage, "setItem"> | undefined, record: GamificationRecord) {
  try { storage?.setItem(GAMIFICATION_STORAGE_KEY, JSON.stringify(record)); } catch { /* local progress must never break the cockpit */ }
}
