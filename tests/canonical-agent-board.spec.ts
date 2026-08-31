import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  filterCanonicalTasks,
  groupCanonicalTasks,
  parseCanonicalAuthorityIdentity,
  taskAttentionLane,
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
  test("reports whichever shared queue the operator configured", () => {
    const configured = {
      schemaVersion: 1,
      source: "/srv/agent-ops/MASTER_PLAN.md",
      mutationBoundary: "/srv/agent-ops/agent_ops.py",
    };
    expect(parseCanonicalAuthorityIdentity(configured)).toEqual({
      source: configured.source,
      mutationBoundary: configured.mutationBoundary,
    });
    for (const unconfigured of [
      { schemaVersion: 1, source: "", mutationBoundary: "" },
      { schemaVersion: 1, source: "   ", mutationBoundary: "/srv/agent-ops/agent_ops.py" },
      { schemaVersion: 2, source: "/srv/agent-ops/MASTER_PLAN.md", mutationBoundary: "/srv/agent-ops/agent_ops.py" },
    ]) {
      expect(() => parseCanonicalAuthorityIdentity(unconfigured)).toThrow(/authority identity/);
    }
  });

  test("exposes canonical validation and mutation operations through the adapter", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/lib/canonicalAgentBoard.ts"), "utf8");
    for (const operation of ["validate", "claim", "progress", "done"]) {
      expect(source).toContain(`operation: "${operation}"`);
    }
    expect(source).toContain("parseCanonicalTasks({ schemaVersion: 1, tasks: [(payload as { task?: unknown }).task] })");
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

  test("does not present stale claimed work as actively running", () => {
    expect(taskAttentionLane({ status: "IN PROGRESS" }, "running-and-progressing")).toBe("working");
    expect(taskAttentionLane({ status: "IN PROGRESS" }, "disconnected")).toBe("needs-attention");
    expect(taskAttentionLane({ status: "IN PROGRESS" }, "claimed-not-running")).toBe("needs-attention");
    expect(taskAttentionLane({ status: "REVIEW" }, "no-worker")).toBe("working");
    expect(taskAttentionLane({ status: "DONE" }, "completed")).toBe("finished");
  });

  test("opens the canonical board on workflow status", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/CanonicalAgentBoard.tsx"), "utf8");
    expect(source).toContain('useState<"attention" | "workflow">("workflow")');
    expect(source).toContain("showAttention={false}");
    expect(source).toContain("showAttention && taskAttentionLane");
  });

  test("does not claim a task before launch choices are accepted", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "src/components/CanonicalAgentBoard.tsx"), "utf8");
    expect(source.indexOf("const claimed = await claimCanonicalTask")).toBeGreaterThan(source.indexOf("resolveWorkstreamOpsContext"));
  });

  test("reduces a task to a glanceable project label", () => {
    expect(taskProjectLabel(tasks[0])).toBe("termfleet");
    expect(taskProjectLabel({ ...tasks[0], workspace: "" })).toBe("No project linked");
    expect(taskDescriptionSummary("- **Status**: PLANNED\n- **Workspace**: /tmp/project\n# Goal\n- [ ] Make the [task](https://example.com) understandable.")).toBe("Goal Make the task understandable.");
  });

  test("renders as the main workspace surface instead of the operations sidebar", () => {
    const surface = fs.readFileSync(path.resolve(process.cwd(), "src/components/WorkspaceSurface.tsx"), "utf8");
    const sidebar = fs.readFileSync(path.resolve(process.cwd(), "src/components/WorkbenchSidebar.tsx"), "utf8");
    const header = fs.readFileSync(path.resolve(process.cwd(), "src/components/WorkbenchHeader.tsx"), "utf8");
    expect(surface).toContain('effectiveWorkspaceMode === "tasks"');
    expect(surface).toContain('restoredPanelMode === "tasks"');
    expect(surface).toContain('restoredPanelMode === "tasks"\n    ? "tasks"');
    expect(surface).toContain("<AgentOperationsBoard />");
    expect(surface).toContain("AgentOperationsBoard");
    const projectBoard = fs.readFileSync(path.resolve(process.cwd(), "src/components/ProjectPlansBoard.tsx"), "utf8");
    const operationsBoard = fs.readFileSync(path.resolve(process.cwd(), "src/components/AgentOperationsBoard.tsx"), "utf8");
    expect(projectBoard).toContain("useMasterPlanTasks");
    expect(projectBoard).toContain("All project plans");
    expect(projectBoard).toContain('aria-label="Search projects"');
    expect(projectBoard).toContain('aria-label="Search project plan tasks"');
    expect(projectBoard).not.toContain('aria-label="Select project plan"');
    expect(projectBoard).toContain("Copy task details");
    expect(projectBoard).toContain('fs_find_master_plan_roots');
    expect(operationsBoard).not.toContain("Shared agent queue");
    expect(sidebar).not.toContain('ui.primarySidebarPanel === "tasks" && <CanonicalAgentBoard />');
    expect(sidebar).toContain('<PanelButton panel="tasks" />');
    expect(sidebar).toContain('aria-label={label}');
    expect(sidebar).toContain('if (panel === "tasks") setWorkspaceMode("tasks")');
    expect(header).toContain('id: "show-tasks"');
    expect(header).toContain('setWorkspaceMode("tasks")');
  });

  test("keeps board grouping and controls styled in the packaged stylesheet", () => {
    const stylesheet = fs.readFileSync(path.resolve(process.cwd(), "src/styles/global.css"), "utf8");
    expect(stylesheet).toContain(".canonical-attention-grid");
    expect(stylesheet).toContain(".canonical-attention-heading > span:first-child");
    expect(stylesheet).toContain("display: grid;");
    expect(stylesheet).toContain(".canonical-view-switch button[aria-pressed=\"true\"]");
  });

  test("uses rendered control discovery and explicit window focus in the packaged map probe", () => {
    const verifier = fs.readFileSync(path.resolve(process.cwd(), "scripts/verify-map-connect-release.sh"), "utf8");
    const liveVerifier = fs.readFileSync(path.resolve(process.cwd(), "scripts/verify-map-connect-live.sh"), "utf8");
    expect(verifier).toContain('MAP_CONNECT_BINARY="$BINARY"');
    expect(liveVerifier).toContain('xdotool windowfocus --sync "$wid"');
    expect(verifier).not.toContain('CONNECT_X=949');
  });
});
