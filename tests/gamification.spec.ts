import { expect, test } from "@playwright/test";
import { collectGamificationFacts, EMPTY_GAMIFICATION_RECORD, findMissionTarget, initializeGamificationRecord, loadGamificationRecord, mergeGamificationRecord, rewardForTransition, summarizeGamification, syncGamificationRecord } from "../src/lib/gamification";
import type { Tab } from "../src/lib/types";

function tab(terminals: Tab["terminals"]): Tab {
  return { id: "tab-1", title: "Workspace", emoji: "⬛", color: "#7aa2f7", groupId: null, terminals, splitLayout: { id: "pane-1", type: "terminal" }, activePaneId: terminals[0]?.paneId ?? "pane-1" };
}
const terminal = (overrides: Record<string, unknown> = {}) => ({ id: "pty-1", paneId: "pane-1", cols: 80, rows: 24, status: "running", ...overrides }) as Tab["terminals"][number];

test.describe("meaningful TermFleet gamification", () => {
  test("extracts real events and ignores idle terminals", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ taskLineup: [{ id: "goal-1", content: "Ship it", status: "completed", source: "operator", updatedAt: 1 }, { id: "work-1", content: "Build release", status: "in_progress", source: "operator", updatedAt: 1 }] }),
      terminal({ id: "pty-2", paneId: "pane-2", status: "idle" }),
    ])]);
    expect(facts.events.map(({ type, points }) => ({ type, points }))).toEqual([{ type: "goal-completed", points: 25 }]);
    expect(facts.activeWorkstreams).toBe(1);
  });

  test("counts three live terminals even without task metadata", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ id: "pty-1", paneId: "pane-1" }),
      terminal({ id: "pty-2", paneId: "pane-2" }),
      terminal({ id: "pty-3", paneId: "pane-3", status: "reconnected" }),
    ])]);
    expect(facts.activeWorkstreams).toBe(3);
  });

  test("counts restored workstreams whose live proof is in the status summary", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ status: undefined, statusSummary: { task: "Build", path: "/tmp", now: "Working", status: "working" } }),
      terminal({ id: "pty-2", paneId: "pane-2", status: undefined, durableActivity: { title: "Watch tests", status: "running", source: "command", updatedAt: 1 } }),
      terminal({ id: "pty-3", paneId: "pane-3", status: "reconnected" }),
    ])]);
    expect(facts.activeWorkstreams).toBe(3);
  });

  test("records successful activities and stable recovery receipts once", () => {
    const facts = collectGamificationFacts([tab([terminal({ status: "reconnected", lastStatusAt: 20, durableActivity: { title: "cargo test", command: "cargo test", status: "success", source: "command", completedAt: 10, updatedAt: 10 } })])]);
    const record = mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, facts, 30);
    const again = mergeGamificationRecord(record, facts, 40);
    expect(record.events.map((event) => event.type)).toEqual(["command-succeeded", "terminal-recovered"]);
    expect(again.events).toHaveLength(2);
    const unstable = collectGamificationFacts([tab([terminal({ durableActivity: { title: "unknown", status: "success", source: "output", updatedAt: 99 } })])]);
    expect(unstable.events).toEqual([]);
  });

  test("keeps normal activity from racing through levels", () => {
    const events = Array.from({ length: 12 }, (_, index) => ({ id: `activity:${index}`, type: "command-succeeded" as const, title: "Command succeeded", detail: `check ${index}`, points: 5, occurredAt: index }));
    const summary = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events, activeWorkstreams: 0 }, 20));
    expect(summary.points).toBe(60);
    expect(summary.level).toBe(1);
    expect(summary.nextLevelPoints).toBe(100);
  });

  test("does not celebrate a zero-point recovery receipt", () => {
    const before = summarizeGamification(EMPTY_GAMIFICATION_RECORD);
    const after = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [{ id: "recovery:1", type: "terminal-recovered", title: "Terminal recovered", detail: "Workstream restored", points: 0, occurredAt: 1 }], activeWorkstreams: 0 }, 2));
    expect(rewardForTransition(before, after)).toBeNull();
  });

  test("builds missions and contextual achievements from receipts", () => {
    const record = mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [{ id: "goal:1", type: "goal-completed", title: "Goal completed", detail: "Verify release", points: 25, occurredAt: 1 }], activeWorkstreams: 3 }, 2000);
    const summary = summarizeGamification(record);
    expect(summary.points).toBe(25);
    expect(summary.missions.some((mission) => mission.id === "parallel-work" && mission.progress === 0)).toBe(true);
    expect(summary.achievements.find((achievement) => achievement.id === "first-finish")?.unlocked).toBe(true);
  });

  test("shows completed mission progress truthfully", () => {
    const events = Array.from({ length: 3 }, (_, index) => ({ id: `goal:${index}`, type: "goal-completed" as const, title: "Goal completed", detail: `Goal ${index}`, points: 25, occurredAt: index }));
    const summary = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events, activeWorkstreams: 0 }, 4));
    expect(summary.missions[0]).toMatchObject({ progress: 3, target: 3, complete: true });
  });

  test("reset baseline ignores old receipts but permits future receipts", () => {
    const reset = { ...EMPTY_GAMIFICATION_RECORD, ignoredEventIds: ["goal:old"], baselineActiveWorkstreams: 2 };
    const current = mergeGamificationRecord(reset, { events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }], activeWorkstreams: 2 }, 2);
    const future = mergeGamificationRecord(current, { events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }, { id: "goal:new", type: "goal-completed", title: "Goal completed", detail: "New", points: 25, occurredAt: 3 }], activeWorkstreams: 3 }, 4);
    expect(summarizeGamification(current).points).toBe(0);
    expect(summarizeGamification(future).points).toBe(25);
    expect(future.maxActiveWorkstreams).toBe(1);
  });

  test("migrates old score storage to a clean v4 record", () => {
    const storage = { getItem: () => JSON.stringify({ version: 1, completedTaskIds: ["old"], maxConcurrentTerminals: 9 }) } as Storage;
    expect(loadGamificationRecord(storage)).toEqual(EMPTY_GAMIFICATION_RECORD);
  });

  test("does not backfill old completed work on first launch", () => {
    const facts = { events: [{ id: "goal:old", type: "goal-completed" as const, title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }], activeWorkstreams: 0 };
    const initialized = initializeGamificationRecord(EMPTY_GAMIFICATION_RECORD, facts, 10);
    const afterLaunch = mergeGamificationRecord(initialized, facts, 11);
    expect(summarizeGamification(afterLaunch).points).toBe(0);
    expect(afterLaunch.ignoredEventIds).toContain("goal:old");
  });

  test("does not load the contaminated v3 profile", () => {
    const storage = { getItem: () => JSON.stringify({ version: 3, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 925, occurredAt: 1 }] }) } as Storage;
    expect(loadGamificationRecord(storage)).toEqual(EMPTY_GAMIFICATION_RECORD);
  });

  test("does not import the previous noisy v2 profile", () => {
    const storage = { getItem: () => JSON.stringify({ version: 2, events: [{ id: "goal:old", type: "goal-completed", title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }] }) } as Storage;
    expect(loadGamificationRecord(storage)).toEqual(EMPTY_GAMIFICATION_RECORD);
  });

  test("describes the exact new event in a reward", () => {
    const before = summarizeGamification(EMPTY_GAMIFICATION_RECORD);
    const after = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [{ id: "goal:1", type: "goal-completed", title: "Goal completed", detail: "Verify release", points: 25, occurredAt: 1 }], activeWorkstreams: 0 }, 2));
    expect(rewardForTransition(before, after)).toMatchObject({ title: "Achievement earned", detail: "First finish · Verify release", points: 25, eventId: "goal:1" });
    expect(after.achievements.find((achievement) => achievement.id === "first-finish")).toMatchObject({ unlocked: true, evidence: "Verify release" });
  });

  test("mission focus targets existing work instead of creating a terminal", () => {
    const tabs = [tab([terminal({ taskLineup: [{ id: "work", content: "Review", status: "in_progress", source: "operator", updatedAt: 1 }] })])];
    expect(findMissionTarget(tabs, "finish-goal")).toEqual({ tabId: "tab-1", paneId: "pane-1" });
    expect(findMissionTarget(tabs, "clean-run")).toBeNull();
  });

  test("explains command challenge in plain language", () => {
    const mission = summarizeGamification(EMPTY_GAMIFICATION_RECORD).missions.find((item) => item.id === "clean-run");
    expect(mission).toMatchObject({
      title: "Finish one successful command",
      detail: "Run a real command in TermFleet and let it finish successfully.",
    });
    expect(mission?.nextAction).toContain("Clicking Focus work does not count");
  });

  test("tracks three active workstreams as consecutive time", () => {
    const started = mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [], activeWorkstreams: 3 }, 1_000);
    const afterTenMinutes = mergeGamificationRecord(started, { events: [], activeWorkstreams: 3 }, 601_000);
    expect(afterTenMinutes.parallelWorkstreamSeconds).toBe(600);
    expect(afterTenMinutes.parallelBestSeconds).toBe(600);
    expect(summarizeGamification(afterTenMinutes).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ progress: 600, target: 1800, complete: false });
    const interrupted = mergeGamificationRecord(afterTenMinutes, { events: [], activeWorkstreams: 2 }, 602_000);
    expect(interrupted.parallelWorkstreamStartedAt).toBeNull();
    expect(interrupted.parallelWorkstreamSeconds).toBe(0);
    expect(interrupted.parallelBestSeconds).toBe(600);
    expect(summarizeGamification(interrupted).achievements.find((achievement) => achievement.id === "parallel-warmup")?.unlocked).toBe(true);
  });

  test("refreshes a live quest clock even when terminal state is unchanged", () => {
    const tabs = [tab([
      terminal({ id: "pty-1", paneId: "pane-1" }),
      terminal({ id: "pty-2", paneId: "pane-2" }),
      terminal({ id: "pty-3", paneId: "pane-3" }),
    ])];
    const accepted = { ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 1_000, initializedAt: 1_000 };
    const started = syncGamificationRecord(accepted, tabs, 1_000);
    const afterTenSeconds = syncGamificationRecord(started, tabs, 11_000);
    expect(afterTenSeconds.parallelWorkstreamSeconds).toBe(10);
    expect(summarizeGamification(afterTenSeconds).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ progress: 10 });
  });

  test("promotes the sustained-work challenge from 10 minutes to 30 minutes to 3 hours", () => {
    const warmup = mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [], activeWorkstreams: 3 }, 1_000);
    const thirty = mergeGamificationRecord(warmup, { events: [], activeWorkstreams: 3 }, 1_801_000);
    const threeHours = mergeGamificationRecord(thirty, { events: [], activeWorkstreams: 3 }, 10_801_000);
    expect(summarizeGamification(warmup).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 workstreams running for 10 minutes", target: 600 });
    expect(summarizeGamification(thirty).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 workstreams running for 3 hours", target: 10800 });
    expect(summarizeGamification(threeHours).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 workstreams running for 3 hours", target: 10800, complete: true });
    expect(summarizeGamification(threeHours).achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.id)).toEqual(["parallel-warmup", "parallel-deep-focus", "parallel-fleet-captain"]);
  });
});
