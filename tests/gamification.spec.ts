import { test, expect } from "@playwright/test";
import {
  collectGamificationFacts,
  EMPTY_GAMIFICATION_RECORD,
  mergeGamificationRecord,
  rewardForTransition,
  summarizeGamification,
} from "../src/lib/gamification";
import type { Tab } from "../src/lib/types";

function tab(terminals: Tab["terminals"]): Tab {
  return {
    id: "tab-1",
    title: "Workspace",
    emoji: "⬛",
    color: "#7aa2f7",
    groupId: null,
    terminals,
    splitLayout: { id: "pane-1", type: "terminal" },
    activePaneId: terminals[0]?.paneId ?? "pane-1",
  };
}

test.describe("gamification", () => {
  test("counts completed goals once and records live terminal concurrency", () => {
    const facts = collectGamificationFacts([
      tab([
        { id: "pty-1", paneId: "pane-1", cols: 80, rows: 24, status: "running", taskLineup: [
          { id: "goal-1", content: "Ship it", status: "completed", source: "operator", updatedAt: 1 },
        ] } as Tab["terminals"][number],
        { id: "pty-2", paneId: "pane-2", cols: 80, rows: 24, status: "reconnected", taskLineup: [
          { id: "goal-1", content: "Ship it", status: "completed", source: "operator", updatedAt: 1 },
        ] } as Tab["terminals"][number],
      ]),
    ]);

    expect(facts).toEqual({ completedTaskIds: ["goal-1"], concurrentTerminals: 2 });
  });

  test("keeps a high-water mark and produces explainable points", () => {
    const record = mergeGamificationRecord(
      EMPTY_GAMIFICATION_RECORD,
      { completedTaskIds: ["goal-1", "goal-2"], concurrentTerminals: 3 },
      100,
    );

    expect(summarizeGamification(record)).toEqual({
      points: 80,
      completedGoals: 2,
      maxConcurrentTerminals: 3,
      level: 1,
      currentLevelPoints: 80,
      nextLevelPoints: 100,
      levelProgressPercent: 80,
      achievements: [
        { id: "first-finish", title: "First finish", description: "Complete your first tracked goal.", unlocked: true },
        { id: "finisher", title: "Finisher", description: "Complete 10 tracked goals.", unlocked: false },
        { id: "multi-tasker", title: "Multi-tasker", description: "Keep 3 live terminals working together.", unlocked: true },
        { id: "control-room", title: "Control room", description: "Reach 6 simultaneous live terminals.", unlocked: false },
      ],
      badges: ["First finish", "Multi-tasker"],
    });
  });

  test("advances lifetime levels at fixed thresholds", () => {
    const record = mergeGamificationRecord(
      EMPTY_GAMIFICATION_RECORD,
      { completedTaskIds: Array.from({ length: 10 }, (_, index) => `goal-${index}`), concurrentTerminals: 0 },
      100,
    );

    expect(summarizeGamification(record).level).toBe(3);
    expect(summarizeGamification(record).nextLevelPoints).toBe(500);
  });

  test("describes achievement and level-up rewards", () => {
    const before = summarizeGamification(EMPTY_GAMIFICATION_RECORD);
    const after = summarizeGamification(mergeGamificationRecord(
      EMPTY_GAMIFICATION_RECORD,
      { completedTaskIds: ["goal-1"], concurrentTerminals: 0 },
      100,
    ));

    expect(rewardForTransition(before, after)).toEqual({ title: "Achievement unlocked", detail: "First finish" });
    expect(rewardForTransition(after, { ...after, level: 2, points: 100 })).toEqual({ title: "Level 2 reached", detail: "100 points earned" });
  });
});
