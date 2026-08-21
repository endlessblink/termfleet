import { test, expect } from "@playwright/test";
import {
  CANONICAL_AGENT_OPS_MUTATION_BOUNDARY,
  CANONICAL_AGENT_OPS_SOURCE,
  filterCanonicalTasks,
  groupCanonicalTasks,
  parseCanonicalAuthorityIdentity,
  type CanonicalTask,
} from "../src/lib/canonicalAgentBoard";

const tasks: CanonicalTask[] = [
  {
    id: "FEATURE-12",
    type: "FEATURE",
    title: "Build the board",
    status: "IN PROGRESS",
    priority: "P1",
    owner: "codex",
    source: "test",
    workspace: "/work/termfleet",
    dependencies: [],
    description: "Board",
    acceptance: [],
    progress: [],
  },
  {
    id: "BUG-9",
    type: "BUG",
    title: "A blocked bug",
    status: "BLOCKED",
    priority: "P2",
    owner: "hermes",
    source: "test",
    workspace: "/work/lifeboat",
    dependencies: ["TASK-1"],
    description: "Bug",
    acceptance: [],
    progress: [],
  },
];

test.describe("canonical agent board", () => {
  test("accepts only the shared agent-ops authority identity", () => {
    expect(parseCanonicalAuthorityIdentity({
      schemaVersion: 1,
      source: CANONICAL_AGENT_OPS_SOURCE,
      mutationBoundary: CANONICAL_AGENT_OPS_MUTATION_BOUNDARY,
    })).toEqual({ source: CANONICAL_AGENT_OPS_SOURCE, mutationBoundary: CANONICAL_AGENT_OPS_MUTATION_BOUNDARY });
    for (const substitute of [
      "FlowState",
      "Life-Boat release matrix",
      "/media/endlessblink/data/my-projects/ai-development/devops/termfleet/MASTER_PLAN.md",
    ]) {
      expect(() => parseCanonicalAuthorityIdentity({ schemaVersion: 1, source: substitute, mutationBoundary: substitute })).toThrow(/authority identity/);
    }
  });

  test("groups canonical tasks into the six visible columns", () => {
    const grouped = groupCanonicalTasks(tasks);
    expect(Object.keys(grouped)).toEqual([
      "TRIAGE",
      "PLANNED",
      "IN PROGRESS",
      "BLOCKED",
      "REVIEW",
      "DONE",
    ]);
    expect(grouped["IN PROGRESS"].map((task) => task.id)).toEqual(["FEATURE-12"]);
    expect(grouped.BLOCKED.map((task) => task.id)).toEqual(["BUG-9"]);
  });

  test("combines search, owner, and priority filters without duplicating authority", () => {
    expect(filterCanonicalTasks(tasks, { query: "board", owner: "codex", priority: "P1" })).toEqual([
      tasks[0],
    ]);
    expect(filterCanonicalTasks(tasks, { query: "board", owner: "hermes" })).toEqual([]);
  });
});
