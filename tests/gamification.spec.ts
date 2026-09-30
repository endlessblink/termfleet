import { expect, test } from "@playwright/test";
import { collectGamificationFacts, EMPTY_GAMIFICATION_RECORD, findMissionTarget, initializeGamificationRecord, loadGamificationRecord, mergeGamificationRecord, parallelBreakSecondsLeft, pruneRetiredGamificationStorage, rewardForTransition, saveGamificationRecord, summarizeGamification, syncGamificationRecord, type GamificationRecord } from "../src/lib/gamification";
import type { Tab } from "../src/lib/types";

// Workstream Quest is opt-in in the public preview; these specs exercise it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("termfleet.workstreamQuest.enabled", "1"));
});

function tab(terminals: Tab["terminals"]): Tab {
  return { id: "tab-1", title: "Workspace", emoji: "⬛", color: "#7aa2f7", groupId: null, terminals, splitLayout: { id: "pane-1", type: "terminal" }, activePaneId: terminals[0]?.paneId ?? "pane-1" };
}
// The quest clock advances per observed tick, like the 1-second panel refresh.
function advance(record: GamificationRecord, activeWorkstreams: number, from: number, to: number, step = 10_000) {
  let current = record;
  for (let at = from + step; at <= to; at += step) current = mergeGamificationRecord(current, { events: [], activeWorkstreams }, at);
  return current;
}
const WORKING = { task: "Build", path: "/tmp", now: "Working", status: "working" as const };
const terminal = (overrides: Record<string, unknown> = {}) => ({ id: "pty-1", paneId: "pane-1", cols: 80, rows: 24, status: "running", ...overrides }) as Tab["terminals"][number];

test.describe("meaningful TermFleet gamification", () => {
  test("extracts real events and ignores idle terminals", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ statusSummary: WORKING, taskLineup: [{ id: "goal-1", content: "Ship it", status: "completed", source: "operator", updatedAt: 1 }, { id: "work-1", content: "Build release", status: "in_progress", source: "operator", updatedAt: 1 }] }),
      terminal({ id: "pty-2", paneId: "pane-2", status: "idle" }),
    ])]);
    expect(facts.events.map(({ type, points }) => ({ type, points }))).toEqual([{ type: "goal-completed", points: 25 }]);
    expect(facts.activeWorkstreams).toBe(1);
  });

  test("an open terminal idling at its prompt is not a busy agent", () => {
    // The operator saw every idle card outlined: an alive process ("running")
    // or a reattached one ("reconnected") says nothing about work happening.
    const facts = collectGamificationFacts([tab([
      terminal({ id: "pty-1", paneId: "pane-1" }),
      terminal({ id: "pty-2", paneId: "pane-2", status: "reconnected" }),
      terminal({ id: "pty-3", paneId: "pane-3", statusSummary: { task: "Done", path: "/tmp", now: "Idle", status: "idle", updatedAt: 1 } }),
    ])]);
    expect(facts.activeWorkstreams).toBe(0);
  });

  test("counts only terminals the badge would call Running", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ status: undefined, statusSummary: { task: "Build", path: "/tmp", now: "Working", status: "working" } }),
      terminal({ id: "pty-2", paneId: "pane-2", status: undefined, durableActivity: { title: "Watch tests", status: "running", source: "command", updatedAt: 1 } }),
      terminal({ id: "pty-3", paneId: "pane-3", statusSummary: { task: "Build", path: "/tmp", now: "Working", status: "working" } }),
    ])]);
    expect(facts.activeWorkstreams).toBe(3);
  });

  test("starts the workstream timer only after the quest is accepted", () => {
    const facts = { events: [], activeWorkstreams: 3 };
    const beforeStart = mergeGamificationRecord(
      EMPTY_GAMIFICATION_RECORD,
      facts,
      1_000,
    );
    const stillWaiting = mergeGamificationRecord(beforeStart, facts, 11_000);
    expect(stillWaiting.parallelWorkstreamSeconds).toBe(0);

    const accepted = {
      ...stillWaiting,
      activeQuestId: "parallel-work",
      questAcceptedAt: 11_000,
    };
    const started = mergeGamificationRecord(accepted, facts, 11_000);
    const afterTenSeconds = mergeGamificationRecord(started, facts, 21_000);
    expect(afterTenSeconds.parallelWorkstreamSeconds).toBe(10);
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
    expect(summary.missions[0]).toMatchObject({ progress: 3, target: 10, complete: false });
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
    const tabs = [tab([terminal({ agentProvider: "claude", statusSummary: { task: "Review", path: "/tmp", now: "Working", status: "working", provider: "claude" } })])];
    expect(findMissionTarget(tabs, "finish-goal")).toEqual({ tabId: "tab-1", paneId: "pane-1" });
    expect(findMissionTarget(tabs, "clean-run")).toBeNull();
  });

  test("explains command challenge in plain language", () => {
    const mission = summarizeGamification(EMPTY_GAMIFICATION_RECORD).missions.find((item) => item.id === "clean-run");
    expect(mission).toMatchObject({
      title: "Finish one successful command",
      detail: "Type a command in a terminal, like running tests or a build. It counts when it finishes without errors.",
    });
    expect(mission?.nextAction).toContain("Clicking Focus work does not count");
  });

  test("tracks three active workstreams as consecutive time", () => {
    const started = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 1_000 }, { events: [], activeWorkstreams: 3 }, 1_000);
    const afterTenMinutes = advance(started, 3, 1_000, 601_000);
    expect(afterTenMinutes.parallelWorkstreamSeconds).toBe(600);
    expect(afterTenMinutes.parallelBestSeconds).toBe(600);
    expect(summarizeGamification(afterTenMinutes).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ progress: 600, target: 1800, complete: false });
    const blip = mergeGamificationRecord(afterTenMinutes, { events: [], activeWorkstreams: 2 }, 602_000);
    expect(blip.parallelWorkstreamSeconds).toBe(600);
    expect(parallelBreakSecondsLeft(blip, 602_000)).toBe(30);
    const interrupted = advance(blip, 2, 602_000, 642_000);
    expect(interrupted.parallelWorkstreamStartedAt).toBeNull();
    expect(interrupted.parallelWorkstreamSeconds).toBe(0);
    expect(interrupted.parallelBestSeconds).toBe(600);
    expect(summarizeGamification(interrupted).achievements.find((achievement) => achievement.id === "parallel-warmup")?.unlocked).toBe(true);
  });

  test("a short status blip pauses the run instead of resetting it", () => {
    const started = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 0 }, { events: [], activeWorkstreams: 3 }, 0);
    const running = advance(started, 3, 0, 300_000);
    const paused = advance(running, 2, 300_000, 320_000);
    expect(paused.parallelWorkstreamSeconds).toBe(300);
    const resumed = advance(paused, 3, 320_000, 380_000);
    expect(resumed.parallelWorkstreamSeconds).toBe(360);
    expect(resumed.parallelBreakStartedAt).toBeNull();
  });

  test("time while the app was closed or asleep never counts", () => {
    const started = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 0 }, { events: [], activeWorkstreams: 3 }, 0);
    const running = advance(started, 3, 0, 60_000);
    const afterSleep = mergeGamificationRecord(running, { events: [], activeWorkstreams: 3 }, 60_000 + 8 * 3_600_000);
    expect(afterSleep.parallelWorkstreamSeconds).toBeLessThanOrEqual(60 + 90);
    expect(summarizeGamification(afterSleep).achievements.find((achievement) => achievement.id === "parallel-fleet-captain")?.unlocked).toBe(false);
  });

  test("goal ids from different sessions do not collide", () => {
    const facts = collectGamificationFacts([tab([
      terminal({ taskLineup: [{ id: "1", runId: "run-a", content: "Write the tests", status: "completed", source: "operator", updatedAt: 1 }] }),
      terminal({ id: "pty-2", paneId: "pane-2", taskLineup: [{ id: "1", runId: "run-b", content: "Ship the release", status: "completed", source: "operator", updatedAt: 2 }] }),
    ])]);
    expect(facts.events).toHaveLength(2);
    const firstSession = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, initializedAt: 1 }, { events: facts.events.slice(0, 1), activeWorkstreams: 0 }, 3);
    const secondSession = mergeGamificationRecord(firstSession, facts, 4);
    expect(summarizeGamification(secondSession).completedGoals).toBe(2);
  });

  test("an older profile keeps its score but does not re-award work already on screen", () => {
    const legacy = { ...EMPTY_GAMIFICATION_RECORD, goalIdScheme: 1, initializedAt: 5, events: [{ id: "goal:1", type: "goal-completed" as const, title: "Goal completed", detail: "Old", points: 25, occurredAt: 1 }] };
    const tabs = [tab([terminal({ taskLineup: [{ id: "1", content: "Old", status: "completed", source: "operator", updatedAt: 1 }] })])];
    const synced = syncGamificationRecord(legacy, tabs, 10);
    expect(summarizeGamification(synced).points).toBe(25);
    expect(synced.goalIdScheme).toBe(3);
  });

  test("storage stays bounded without losing points or re-counting", () => {
    const events = Array.from({ length: 900 }, (_, index) => ({ id: `goal:${index}`, type: "goal-completed" as const, title: "Goal completed", detail: `Goal ${index}`, points: 25, occurredAt: index }));
    const record = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, initializedAt: 1 }, { events, activeWorkstreams: 0 }, 1_000);
    expect(record.events.length).toBeLessThanOrEqual(400);
    expect(summarizeGamification(record)).toMatchObject({ completedGoals: 900, points: 22_500 });
    const again = mergeGamificationRecord(record, { events, activeWorkstreams: 0 }, 2_000);
    expect(summarizeGamification(again)).toMatchObject({ completedGoals: 900, points: 22_500 });
    expect(summarizeGamification(again).achievements.find((achievement) => achievement.id === "first-finish")?.evidence).toBe("Goal 0");
  });

  test("goal and command challenges keep offering the next milestone", () => {
    const events = Array.from({ length: 4 }, (_, index) => ({ id: `goal:${index}`, type: "goal-completed" as const, title: "Goal completed", detail: `Goal ${index}`, points: 25, occurredAt: index }));
    const summary = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events, activeWorkstreams: 0 }, 10));
    expect(summary.missions.find((mission) => mission.id === "finish-goal")).toMatchObject({ progress: 4, target: 10, complete: false });
    const commands = Array.from({ length: 2 }, (_, index) => ({ id: `activity:${index}`, type: "command-succeeded" as const, title: "Command succeeded", detail: `check ${index}`, points: 5, occurredAt: index }));
    const commandSummary = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: commands, activeWorkstreams: 0 }, 10));
    expect(commandSummary.missions.find((mission) => mission.id === "clean-run")).toMatchObject({ title: "Finish 10 successful commands", progress: 2, target: 10 });
  });

  test("several wins at once become one reward with the total points", () => {
    const before = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events: [{ id: "goal:0", type: "goal-completed", title: "Goal completed", detail: "First", points: 25, occurredAt: 0 }], activeWorkstreams: 0 }, 1));
    const events = ["First", "Second", "Third"].map((detail, index) => ({ id: `goal:${index}`, type: "goal-completed" as const, title: "Goal completed", detail, points: 25, occurredAt: index }));
    const after = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events, activeWorkstreams: 0 }, 5));
    expect(rewardForTransition(before, after)).toMatchObject({ title: "2 wins", points: 50 });
    expect(rewardForTransition(after, before)).toBeNull();
  });

  test("levels keep rising after the table ends", () => {
    const events = Array.from({ length: 480 }, (_, index) => ({ id: `goal:${index}`, type: "goal-completed" as const, title: "Goal completed", detail: `Goal ${index}`, points: 25, occurredAt: index }));
    const summary = summarizeGamification(mergeGamificationRecord(EMPTY_GAMIFICATION_RECORD, { events, activeWorkstreams: 0 }, 500));
    expect(summary.points).toBe(12_000);
    expect(summary.level).toBe(8);
    expect(summary.nextLevelPoints).toBe(16_000);
  });

  test("refreshes a live quest clock even when terminal state is unchanged", () => {
    const tabs = [tab([
      terminal({ id: "pty-1", paneId: "pane-1", statusSummary: WORKING }),
      terminal({ id: "pty-2", paneId: "pane-2", statusSummary: WORKING }),
      terminal({ id: "pty-3", paneId: "pane-3", statusSummary: WORKING }),
    ])];
    const accepted = { ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 1_000, initializedAt: 1_000 };
    const started = syncGamificationRecord(accepted, tabs, 1_000);
    const afterTenSeconds = syncGamificationRecord(started, tabs, 11_000);
    expect(afterTenSeconds.parallelWorkstreamSeconds).toBe(10);
    expect(summarizeGamification(afterTenSeconds).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ progress: 10 });
  });

  test("promotes the sustained-work challenge from 10 minutes to 30 minutes to 3 hours", () => {
    const warmup = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 1_000 }, { events: [], activeWorkstreams: 3 }, 1_000);
    const thirty = advance(warmup, 3, 1_000, 1_801_000);
    const threeHours = advance(thirty, 3, 1_801_000, 10_801_000);
    expect(summarizeGamification(warmup).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 agents busy for 10 minutes", target: 600 });
    expect(summarizeGamification(thirty).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 agents busy for 3 hours", target: 10800 });
    expect(summarizeGamification(threeHours).missions.find((mission) => mission.id === "parallel-work")).toMatchObject({ title: "Keep 3 agents busy for 3 hours", target: 10800, complete: true });
    expect(summarizeGamification(threeHours).achievements.filter((achievement) => achievement.unlocked).map((achievement) => achievement.id)).toEqual(["parallel-warmup", "parallel-deep-focus", "parallel-fleet-captain"]);
  });

  test("an agent finishing the job you gave it counts once", () => {
    const finished = terminal({ status: "idle", agentProvider: "claude", mainUserAsk: { text: "Fix the login screen" }, statusSummary: { task: "Fix login", path: "/tmp", now: "Idle", status: "idle", provider: "claude", updatedAt: 500, recent: [{ text: "Edited login form", at: 400 }] } });
    const facts = collectGamificationFacts([tab([finished])]);
    expect(facts.events).toEqual([expect.objectContaining({ id: "job:pane-1:500", type: "goal-completed", title: "Agent job finished", detail: "Fix the login screen", points: 10 })]);
    const record = mergeGamificationRecord({ ...EMPTY_GAMIFICATION_RECORD, initializedAt: 1 }, facts, 600);
    const again = mergeGamificationRecord(record, collectGamificationFacts([tab([finished])]), 700);
    expect(summarizeGamification(again)).toMatchObject({ completedGoals: 1, points: 10 });
    const nextTurn = terminal({ ...finished, statusSummary: { ...finished.statusSummary!, updatedAt: 900 } });
    const later = mergeGamificationRecord(again, collectGamificationFacts([tab([nextTurn])]), 1_000);
    expect(summarizeGamification(later).completedGoals).toBe(2);
  });

  test("working agents, untouched agents and plain shells do not count as finished jobs", () => {
    const working = terminal({ agentProvider: "claude", statusSummary: { task: "Build", path: "/tmp", now: "Working", status: "working", provider: "claude", updatedAt: 5, recent: [{ text: "x", at: 1 }] } });
    const untouched = terminal({ id: "pty-2", paneId: "pane-2", status: "idle", agentProvider: "codex", statusSummary: { task: "", path: "/tmp", now: "Idle", status: "idle", provider: "codex", updatedAt: 5, recent: [] } });
    const shell = terminal({ id: "pty-3", paneId: "pane-3", status: "idle", statusSummary: { task: "ls", path: "/tmp", now: "Idle", status: "idle", updatedAt: 5, recent: [{ text: "x", at: 1 }] } });
    expect(collectGamificationFacts([tab([working, untouched, shell])]).events).toEqual([]);
  });

  test("every quest explains in one plain sentence what to do", () => {
    const missions = summarizeGamification(EMPTY_GAMIFICATION_RECORD).missions;
    expect(missions.find((mission) => mission.id === "finish-goal")).toMatchObject({ title: "Get agents to finish 3 jobs", detail: "Ask any agent to do something. It counts when the agent finishes and is waiting for you again." });
    expect(missions.find((mission) => mission.id === "parallel-work")?.title).toBe("Keep 3 agents busy for 10 minutes");
    for (const mission of missions) expect(mission.detail).not.toMatch(/tracked|workstream|checklist|command-backed/i);
  });

  // Mirrors the live profile: megabytes of retired v2/v3 scores filled storage,
  // every save threw, and Start quest was undone on the next reload.
  function fullStorage(limit: number) {
    const items = new Map<string, string>();
    const size = () => [...items.values()].reduce((total, value) => total + value.length, 0);
    return {
      items,
      get length() { return items.size; },
      key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null,
      removeItem: (key: string) => { items.delete(key); },
      setItem: (key: string, value: string) => {
        const previous = items.get(key)?.length ?? 0;
        if (size() - previous + value.length > limit) throw new DOMException("quota", "QuotaExceededError");
        items.set(key, value);
      },
    } as unknown as Storage & { items: Map<string, string> };
  }

  test("a full storage frees retired profiles so Start quest is saved", () => {
    const storage = fullStorage(10_000);
    storage.items.set("termfleet.gamification.v3", "x".repeat(9_900));
    storage.items.set("terminal-workspace.v1", "{}");
    const accepted = { ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "finish-goal", questAcceptedAt: 5, initializedAt: 1, updatedAt: 5 };
    expect(saveGamificationRecord(storage, accepted)).toBe(true);
    expect(storage.items.has("termfleet.gamification.v3")).toBe(false);
    expect(storage.items.get("terminal-workspace.v1")).toBe("{}");
    expect(loadGamificationRecord(storage).activeQuestId).toBe("finish-goal");
  });

  test("pruning keeps the current profile and a still-needed previous-release copy", () => {
    const storage = fullStorage(1_000_000);
    storage.items.set("termfleet.gamification.v2", "old");
    storage.items.set("termfleet.gamification.reset.v1", "old");
    storage.items.set("termfleet.gamification.v6.dev", JSON.stringify({ ...EMPTY_GAMIFICATION_RECORD, activeQuestId: "parallel-work", questAcceptedAt: 1 }));
    pruneRetiredGamificationStorage(storage);
    expect([...storage.items.keys()]).toEqual(["termfleet.gamification.v6.dev"]);
    storage.items.set("termfleet.gamification.v6", JSON.stringify(EMPTY_GAMIFICATION_RECORD));
    pruneRetiredGamificationStorage(storage);
    expect([...storage.items.keys()]).toEqual(["termfleet.gamification.v6"]);
  });
});
