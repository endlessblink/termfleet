import type { Tab } from "./types";

export const GAMIFICATION_STORAGE_KEY = "termfleet.gamification.v1";

export interface GamificationRecord {
  version: 1;
  completedTaskIds: string[];
  maxConcurrentTerminals: number;
  updatedAt: number;
}

export interface GamificationFacts {
  completedTaskIds: string[];
  concurrentTerminals: number;
}

export interface GamificationSummary {
  points: number;
  completedGoals: number;
  maxConcurrentTerminals: number;
  level: number;
  currentLevelPoints: number;
  nextLevelPoints: number | null;
  levelProgressPercent: number;
  achievements: GamificationAchievement[];
  badges: string[];
}

export interface GamificationAchievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

export interface GamificationReward {
  title: string;
  detail: string;
}

const LEVEL_THRESHOLDS = [0, 100, 250, 500, 1000];

export const GAMIFICATION_ACHIEVEMENTS = [
  { id: "first-finish", title: "First finish", description: "Complete your first tracked goal." },
  { id: "finisher", title: "Finisher", description: "Complete 10 tracked goals." },
  { id: "multi-tasker", title: "Multi-tasker", description: "Keep 3 live terminals working together." },
  { id: "control-room", title: "Control room", description: "Reach 6 simultaneous live terminals." },
] as const;

export function rewardForTransition(previous: GamificationSummary, next: GamificationSummary): GamificationReward | null {
  const achievement = next.achievements.find(
    (candidate) => candidate.unlocked && !previous.achievements.some((old) => old.id === candidate.id && old.unlocked),
  );
  if (achievement) return { title: "Achievement unlocked", detail: achievement.title };
  if (next.level > previous.level) return { title: `Level ${next.level} reached`, detail: `${next.points} points earned` };
  return null;
}

export const EMPTY_GAMIFICATION_RECORD: GamificationRecord = {
  version: 1,
  completedTaskIds: [],
  maxConcurrentTerminals: 0,
  updatedAt: 0,
};

export function collectGamificationFacts(tabs: Tab[]): GamificationFacts {
  const completedTaskIds = new Set<string>();
  let concurrentTerminals = 0;

  for (const tab of tabs) {
    for (const terminal of tab.terminals) {
      if (terminal.status === "running" || terminal.status === "reconnected") {
        concurrentTerminals += 1;
      }
      for (const task of terminal.taskLineup ?? []) {
        if (task.status === "completed") completedTaskIds.add(task.id);
      }
    }
  }

  return { completedTaskIds: [...completedTaskIds], concurrentTerminals };
}

export function mergeGamificationRecord(
  record: GamificationRecord,
  facts: GamificationFacts,
  updatedAt: number,
): GamificationRecord {
  return {
    version: 1,
    completedTaskIds: [...new Set([...record.completedTaskIds, ...facts.completedTaskIds])].sort(),
    maxConcurrentTerminals: Math.max(record.maxConcurrentTerminals, facts.concurrentTerminals),
    updatedAt,
  };
}

export function summarizeGamification(record: GamificationRecord): GamificationSummary {
  const completedGoals = record.completedTaskIds.length;
  const points = completedGoals * 25 + record.maxConcurrentTerminals * 10;
  const levelIndex = LEVEL_THRESHOLDS.reduce((index, threshold, candidate) => points >= threshold ? candidate : index, 0);
  const level = levelIndex + 1;
  const currentThreshold = LEVEL_THRESHOLDS[levelIndex];
  const nextLevelPoints = levelIndex < LEVEL_THRESHOLDS.length - 1 ? LEVEL_THRESHOLDS[levelIndex + 1] : null;
  const levelSpan = nextLevelPoints === null ? 500 : nextLevelPoints - currentThreshold;
  const levelProgressPercent = nextLevelPoints === null
    ? Math.min(100, Math.round(((points - currentThreshold) / levelSpan) * 100))
    : Math.min(100, Math.round(((points - currentThreshold) / levelSpan) * 100));
  const unlocked = new Set([
    ...(completedGoals >= 1 ? ["first-finish"] : []),
    ...(completedGoals >= 10 ? ["finisher"] : []),
    ...(record.maxConcurrentTerminals >= 3 ? ["multi-tasker"] : []),
    ...(record.maxConcurrentTerminals >= 6 ? ["control-room"] : []),
  ]);
  const achievements = GAMIFICATION_ACHIEVEMENTS.map((achievement) => ({ ...achievement, unlocked: unlocked.has(achievement.id) }));
  return {
    points,
    completedGoals,
    maxConcurrentTerminals: record.maxConcurrentTerminals,
    level,
    currentLevelPoints: points - currentThreshold,
    nextLevelPoints,
    levelProgressPercent,
    achievements,
    badges: achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.title),
  };
}

export function loadGamificationRecord(storage: Pick<Storage, "getItem"> | undefined): GamificationRecord {
  if (!storage) return EMPTY_GAMIFICATION_RECORD;
  try {
    const parsed = JSON.parse(storage.getItem(GAMIFICATION_STORAGE_KEY) ?? "null") as Partial<GamificationRecord> | null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.completedTaskIds)) return EMPTY_GAMIFICATION_RECORD;
    return {
      version: 1,
      completedTaskIds: parsed.completedTaskIds.filter((id): id is string => typeof id === "string"),
      maxConcurrentTerminals: typeof parsed.maxConcurrentTerminals === "number" ? parsed.maxConcurrentTerminals : 0,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
    };
  } catch {
    return EMPTY_GAMIFICATION_RECORD;
  }
}

export function saveGamificationRecord(storage: Pick<Storage, "setItem"> | undefined, record: GamificationRecord) {
  try {
    storage?.setItem(GAMIFICATION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Progress is useful but must never make the cockpit fail in restricted storage contexts.
  }
}
