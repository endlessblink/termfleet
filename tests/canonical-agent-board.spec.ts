import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  CANONICAL_AGENT_OPS_MUTATION_BOUNDARY,
  CANONICAL_AGENT_OPS_SOURCE,
  filterCanonicalTasks,
  groupCanonicalTasks,
  parseCanonicalAuthorityIdentity,
  taskDescriptionSummary,
  taskProjectLabel,
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

  test("reduces a task to a glanceable project label", () => {
    expect(taskProjectLabel(tasks[0])).toBe("termfleet");
    expect(taskProjectLabel({ ...tasks[0], workspace: "" })).toBe("No project linked");
    expect(taskDescriptionSummary("- **Status**: PLANNED\n- **Workspace**: /tmp/project\n# Goal\n- [ ] Make the [task](https://example.com) understandable.")).toBe("Goal Make the task understandable.");
  });

  test("renders as the main workspace surface instead of the operations sidebar", () => {
    const surface = fs.readFileSync(path.resolve(process.cwd(), "src/components/WorkspaceSurface.tsx"), "utf8");
    const sidebar = fs.readFileSync(path.resolve(process.cwd(), "src/components/WorkbenchSidebar.tsx"), "utf8");
    expect(surface).toContain('effectiveWorkspaceMode === "tasks"');
    expect(surface).toContain("<CanonicalAgentBoard />");
    expect(sidebar).not.toContain('ui.primarySidebarPanel === "tasks" && <CanonicalAgentBoard />');
  });
});
