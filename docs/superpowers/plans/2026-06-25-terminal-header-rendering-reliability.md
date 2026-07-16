# Terminal Header And Rendering Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TermFleet terminal cards reliably show truthful header identity/activity and separately stop AskUserQuestion terminal text from duplicating/breaking under map rendering.

**Architecture:** Replace scattered visible-header decisions with one pure `TerminalHeaderViewModel` builder, then make map and split headers render only that object. Keep terminal rendering corruption separate: reproduce it with a grid/snapshot fixture first, then fix the lowest layer that duplicates/reflows text.

**Tech Stack:** React 19, TypeScript, Playwright, Tauri grid snapshots, existing TermFleet stores and terminal summary helpers.

---

## File Structure

- Create `src/lib/terminalHeaderViewModel.ts`
  - Owns all visible shell terminal header fields: `workspace`, `taskDescription`, `title`, `path`, `now`, and source/debug metadata.
  - Imports existing helpers from `projectDisplay.ts`, `terminalHeaderDisplay.ts`, `agentStatusSummary.ts`, `taskLineup.ts`, and `stableHeader.ts` only where necessary.
- Modify `src/components/MagicCanvas.tsx`
  - Deletes local header-assembly logic and renders `TerminalHeaderViewModel`.
  - Keeps layout and DOM test ids unchanged.
- Modify `src/components/SplitPane.tsx`
  - Uses the same view model for shell panes.
  - Agent pane behavior remains separate unless a regression proves it shares the bug.
- Modify `src/lib/projectDisplay.ts`
  - Keep workspace identity rules there, but call them from the view model only.
- Modify `src/lib/terminalHeaderDisplay.ts`
  - Keep low-level summary normalization helpers, but stop using it as the final visible-header source of truth.
- Modify `src/components/Terminal.tsx`
  - Ensure snapshot excerpts never update semantic summary/title state.
  - Keep excerpt updates for preview/debug only.
- Test `tests/terminal-header-view-model.spec.ts`
  - Pure unit tests for every visible field and source priority.
- Test `tests/terminal-summary-visual.spec.ts`
  - Screenshot-shaped Playwright tests for map/split terminal cards.
- Test `tests/terminal-question-rendering.spec.ts`
  - Reproduces the AskUserQuestion duplicated-option text separately from header semantics.
- Potentially modify `src/components/TerminalCanvas.tsx`, `src/lib/gridSnapshot.ts`, `src/lib/gridRenderer.ts`, or `src-tauri/src/vt_grid.rs`
  - Only after the AskUserQuestion rendering test proves which layer corrupts the text.

## Guardrails Before Execution

- [ ] Run `git status --short --branch --untracked-files=all`.
  Expected: note all existing dirty files before editing. Do not revert or absorb unrelated WIP, especially `CanvasSidebar.tsx`, `src/lib/types.ts`, `src/stores/workspace.ts`, `src-tauri/src/vt_grid.rs`, `src-tauri/src/daemon.rs`, or `src/styles/global.css`, unless the rendering task proves they are directly involved.
- [ ] Record active task wording as `Fixing terminal header and question rendering reliability`.
  Expected: cockpit header for this worker must not say stale `/done`, old verifier wording, or "No task set".
- [ ] Do not run `npm run build` as the only gate while unrelated `CanvasSidebar.tsx` unused-variable WIP exists. Run it and report blockers, but rely on focused tests plus source verifiers until unrelated WIP is either fixed or isolated.

---

### Task 1: Pure Header View Model

**Files:**
- Create: `src/lib/terminalHeaderViewModel.ts`
- Test: `tests/terminal-header-view-model.spec.ts`

- [ ] **Step 1: Write failing tests for visible header fields**

Create `tests/terminal-header-view-model.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { buildShellTerminalHeaderViewModel } from "../src/lib/terminalHeaderViewModel";

const flowStatePath = "/workspace/productivity/flow-state";

test("uses project root folder instead of parent category workspace", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "productivity", projectRoot: flowStatePath },
    liveCwd: flowStatePath,
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Verify the working tree is clean and nothing's left uncommitted.",
      path: flowStatePath,
      now: "Verify the working tree is clean and nothing's left uncommitted.",
      status: "done",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.workspace.label).toBe("flow-state");
  expect(header.taskDescription.text).toBe("No task list");
  expect(header.title.text).toBe("Idle");
  expect(header.now.text).toBe("Idle");
  expect(header.title.text).not.toContain("Verify the working tree");
});

test("uses real task list as the title and task row", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-art", name: "arthouse", projectRoot: "/repo/arthouse" },
    liveCwd: "/repo/arthouse",
    terminalStatus: "running",
    taskLineup: [{
      id: "task-question",
      content: "Answering authentication question",
      status: "in_progress",
      source: "todo-write",
      updatedAt: 1000,
    }],
    statusSummary: {
      task: "Asking clarifying questions",
      path: "/repo/arthouse",
      now: "Using AskUserQuestion",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: false,
    },
  });

  expect(header.workspace.label).toBe("arthouse");
  expect(header.taskDescription.text).toBe("Answering authentication question");
  expect(header.title.text).toBe("Answering authentication question");
  expect(header.now.text).toBe("Using AskUserQuestion");
});

test("rejects foreign project slugs from final now text", () => {
  const header = buildShellTerminalHeaderViewModel({
    project: { id: "g-flow", name: "flow-state", projectRoot: flowStatePath },
    liveCwd: flowStatePath,
    terminalStatus: "running",
    taskLineup: [],
    statusSummary: {
      task: "Ready",
      path: "productivity/flow-state",
      now: "income-zen",
      status: "working",
      provider: "shell",
      confidence: "high",
      tasksFromTodoWrite: true,
    },
  });

  expect(header.now.text).toBe("Working");
  expect(header.now.text).not.toContain("income-zen");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
npx playwright test tests/terminal-header-view-model.spec.ts --reporter=line
```

Expected: FAIL because `src/lib/terminalHeaderViewModel.ts` does not exist.

- [ ] **Step 3: Implement the minimal view model**

Create `src/lib/terminalHeaderViewModel.ts` with this public API:

```ts
import type { Group, TaskLineupItem, TerminalRuntimeStatus, WorkstreamStatusSummary } from "./types";
import { workspaceLabelFor } from "./projectDisplay";
import {
  compactTerminalHeaderPath,
  neutralHeaderTitle,
  normalizePersistedShellSummary,
  preferRealTaskSummary,
  sanitizeShellDisplaySummary,
  sanitizeTerminalHeaderNow,
} from "./terminalHeaderDisplay";
import { visibleTaskLineup } from "./taskLineup";

export type HeaderFieldSource =
  | "workspace"
  | "task-list"
  | "status-summary"
  | "durable-activity"
  | "neutral"
  | "sanitized";

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

export function buildShellTerminalHeaderViewModel(input: {
  project?: Pick<Group, "id" | "name" | "projectRoot"> | null;
  liveCwd?: string | null;
  terminalStatus?: TerminalRuntimeStatus | null;
  taskLineup?: TaskLineupItem[];
  activeRunId?: string;
  statusSummary?: WorkstreamStatusSummary | null;
}): ShellTerminalHeaderViewModel {
  const livePath = input.liveCwd ?? input.project?.projectRoot ?? "workspace path unknown";
  const workspace = workspaceLabelFor({ project: input.project, cwd: input.liveCwd });
  const visibleTasks = visibleTaskLineup(input.taskLineup, input.activeRunId);
  const todoTasks = visibleTasks.filter((task) => task.source === "todo-write");
  const activeTask = todoTasks.find((task) => task.status === "in_progress") ?? todoTasks[0];
  const hasRealTask = Boolean(activeTask?.content || (input.statusSummary?.tasksFromTodoWrite && input.statusSummary.task));
  const taskText = activeTask?.content ?? (input.statusSummary?.tasksFromTodoWrite ? input.statusSummary.task : undefined);

  const base = normalizePersistedShellSummary(
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
  const neutral =
    base.status === "working"
      ? "Working"
      : base.status === "blocked"
        ? "Needs attention"
        : base.status === "done" || base.status === "idle"
          ? "Idle"
          : neutralHeaderTitle(input.terminalStatus);
  const summary = sanitizeShellDisplaySummary(
    preferRealTaskSummary(base, input.statusSummary, neutral),
    livePath,
    neutral,
  );
  const title = hasRealTask ? taskText ?? summary.task : summary.task;
  const now = sanitizeTerminalHeaderNow(summary.now, livePath, neutral);

  return {
    workspace: { text: workspace, source: "workspace" },
    taskDescription: {
      text: taskText ?? "No task list",
      source: taskText ? "task-list" : "neutral",
    },
    title: {
      text: title,
      source: hasRealTask ? "task-list" : title === neutral ? "neutral" : "status-summary",
    },
    path: {
      text: compactTerminalHeaderPath(summary.path, livePath),
      source: "status-summary",
    },
    now: {
      text: now,
      source: now === neutral ? "neutral" : "status-summary",
    },
    debug: {
      livePath,
      hasRealTask,
      tasksFromTodoWrite: input.statusSummary?.tasksFromTodoWrite,
    },
  };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npx playwright test tests/terminal-header-view-model.spec.ts --reporter=line
```

Expected: PASS.

---

### Task 2: Render Map And Split Headers From The View Model

**Files:**
- Modify: `src/components/MagicCanvas.tsx`
- Modify: `src/components/SplitPane.tsx`
- Test: `tests/terminal-summary-visual.spec.ts`

- [ ] **Step 1: Add visual tests before component refactor**

Extend `tests/terminal-summary-visual.spec.ts` with two cases:

```ts
test("map header exposes field sources for debugging", async ({ page }) => {
  // Seed the existing flow-state closeout fixture.
  // Assert the rendered text AND source metadata.
  const block = page.getByTestId("canvas-terminal-status-block").filter({ hasText: "flow-state" });
  await expect(block.getByTestId("canvas-terminal-node-workspace")).toHaveText("flow-state");
  await expect(block.getByTestId("canvas-terminal-node-header-title")).toHaveText("Idle");
  await expect(block).toHaveAttribute("data-header-title-source", "neutral");
  await expect(block).toHaveAttribute("data-header-workspace-source", "workspace");
});

test("split header and map header agree for the same shell terminal", async ({ page }) => {
  // Seed one shell terminal with a todo-write task and stale status summary.
  // Render split first, read task/path/now.
  // Switch workspaceMode to canvas, read map task/path/now.
  // Assert exact equality for visible task/path/now.
});
```

Run:

```bash
npx playwright test tests/terminal-summary-visual.spec.ts -g "field sources|split header and map header agree" --reporter=line
```

Expected: FAIL because source attributes and shared view model are not wired yet.

- [ ] **Step 2: Replace local map header assembly**

In `src/components/MagicCanvas.tsx`:

1. Import `buildShellTerminalHeaderViewModel`.
2. Replace local variables `workspaceLabel`, `terminalHeaderTaskDescription`, `terminalDisplaySummary`, `terminalHeaderTitle`, `terminalHeaderPath`, and `terminalHeaderNow` for shell terminal cards with the view model.
3. Add source attributes on `data-testid="canvas-terminal-status-block"`:

```tsx
data-header-workspace-source={header.workspace.source}
data-header-title-source={header.title.source}
data-header-now-source={header.now.source}
```

4. Keep existing test ids and visual layout.

- [ ] **Step 3: Replace local split header assembly**

In `src/components/SplitPane.tsx`:

1. Build the same header model for non-agent terminal panes.
2. Use `header.title.text`, `header.path.text`, and `header.now.text`.
3. Keep existing split test ids: `split-terminal-summary-task`, `split-terminal-summary-path`, `split-terminal-summary-now`.

- [ ] **Step 4: Run focused visual tests**

Run:

```bash
npx playwright test tests/terminal-summary-visual.spec.ts -g "field sources|split header and map header agree|stale closeout wording|stale task-summary now" --reporter=line
```

Expected: PASS.

- [ ] **Step 5: Run full header tests**

Run:

```bash
npx playwright test tests/terminal-header-view-model.spec.ts tests/header-project-label.spec.ts tests/agent-status-summary.spec.ts --reporter=line
npm run verify:terminal-summary-visual
```

Expected: PASS.

---

### Task 3: Reproduce AskUserQuestion Text Duplication As A Rendering Bug

**Files:**
- Create: `tests/terminal-question-rendering.spec.ts`
- Possibly modify: `src/components/Terminal.tsx`
- Possibly modify: `src/components/TerminalCanvas.tsx`
- Possibly modify: `src/lib/gridSnapshot.ts`
- Possibly modify: `src/lib/gridRenderer.ts`

- [ ] **Step 1: Write a rendering regression with the exact question fixture**

Create `tests/terminal-question-rendering.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("AskUserQuestion option text renders once per option on a map terminal", async ({ page }) => {
  // Use existing mockTauri pattern from terminal-summary-visual.spec.ts.
  // Seed a grid/snapshot with:
  // "How should the extension authenticate to your arthouse backend?"
  // option 1 once, option 2 once, option 3 once.
  // Render the map terminal at the same size as the screenshot.
  const terminal = page.locator("[data-testid='canvas-terminal-node'] .terminal-container");
  await expect(terminal).toBeVisible();
  const text = await terminal.textContent();
  expect(text?.match(/Static API token you paste in \(Recommended\)/g)?.length).toBe(1);
  expect(text?.match(/Reuse arthouse login session/g)?.length).toBe(1);
});
```

Run:

```bash
npx playwright test tests/terminal-question-rendering.spec.ts --reporter=line
```

Expected: FAIL with duplicated option count or FAIL because the current canvas has no accessible text. If there is no accessible text, use screenshot/pixel or expose a test-only grid snapshot text probe before fixing rendering.

- [ ] **Step 2: Identify the corrupting layer**

Run these inspections before editing:

```bash
rg -n "readableSnapshotExcerpt|snapshot.cells|grid_snapshot|drawImage|fillText|wrap|cols|rows|mapProjection" src/components src/lib src-tauri/src
```

Expected: Identify whether duplication is in:

- PTY/grid state: `src-tauri/src/vt_grid.rs`
- Snapshot parsing: `src/lib/gridSnapshot.ts`
- Rendering projection/reflow: `src/components/TerminalCanvas.tsx` or `src/lib/gridRenderer.ts`
- Header excerpt only: `src/components/Terminal.tsx`

- [ ] **Step 3: Add the narrowest layer test**

If corruption is in `readableSnapshotExcerpt`, add a unit test around that transformation by extracting it from `Terminal.tsx` into `src/lib/readableSnapshotExcerpt.ts`.

If corruption is in grid rendering, add a Playwright pixel/text test beside existing terminal rendering tests.

If corruption is in Rust grid wrapping, add a Rust unit test in `src-tauri/src/vt_grid.rs` or an integration test that feeds the exact lines and checks row contents.

- [ ] **Step 4: Fix only the proven layer**

Do not change header summary code in this task. Fix only the layer proven by Step 2.

- [ ] **Step 5: Verify question rendering**

Run:

```bash
npx playwright test tests/terminal-question-rendering.spec.ts --reporter=line
npm run verify:terminal-rendering
npm run verify:map-terminals
```

Expected: PASS.

---

### Task 4: Build And Dirty-Tree Closeout

**Files:**
- Modify: `MASTER_PLAN.md`
- Possibly modify unrelated WIP only if user explicitly approves or if the WIP is proven to block this lane.

- [ ] **Step 1: Run source and visual verification**

Run:

```bash
npx playwright test tests/terminal-header-view-model.spec.ts tests/header-project-label.spec.ts tests/agent-status-summary.spec.ts --reporter=line
npm run verify:terminal-summary-visual
npx playwright test tests/terminal-question-rendering.spec.ts --reporter=line
npm run verify:map-terminals
npm run verify:agent-status-summary
npm run verify:terminal-rendering
git diff --check
```

Expected: all PASS.

- [ ] **Step 2: Run build and handle unrelated blockers truthfully**

Run:

```bash
npm run build
```

Expected: PASS if unrelated `CanvasSidebar.tsx` WIP has been cleaned. If it fails on unrelated unused variables, record the exact errors and do not claim build passes.

- [ ] **Step 3: Update MASTER_PLAN evidence**

Add a concise TC-032/TC-033 note:

```md
- DONE (2026-06-25): Terminal header reliability now routes map and split shell
  headers through one `TerminalHeaderViewModel`, with field-source metadata and
  screenshot-shaped regressions for FlowState stale closeout, Arthouse
  AskUserQuestion, approval prompts, foreign project slugs, and long paths.
  AskUserQuestion rendering duplication is covered by
  `tests/terminal-question-rendering.spec.ts`. Evidence: ...
```

- [ ] **Step 4: Commit only this lane**

Stage only files touched by this lane:

```bash
git add docs/superpowers/plans/2026-06-25-terminal-header-rendering-reliability.md \
  MASTER_PLAN.md \
  src/lib/terminalHeaderViewModel.ts \
  src/lib/projectDisplay.ts \
  src/lib/terminalHeaderDisplay.ts \
  src/components/MagicCanvas.tsx \
  src/components/SplitPane.tsx \
  src/components/Terminal.tsx \
  tests/terminal-header-view-model.spec.ts \
  tests/header-project-label.spec.ts \
  tests/agent-status-summary.spec.ts \
  tests/terminal-summary-visual.spec.ts \
  tests/terminal-question-rendering.spec.ts
```

Commit with Lore trailers:

```bash
git commit -m "fix: centralize terminal header reliability" \
  -m "Constraint: Keep terminal header semantics in one view model; do not treat scroll snapshots as task intent." \
  -m "Rejected: More one-off summary/path guards in individual components." \
  -m "Tested: npx playwright test tests/terminal-header-view-model.spec.ts tests/header-project-label.spec.ts tests/agent-status-summary.spec.ts --reporter=line" \
  -m "Tested: npm run verify:terminal-summary-visual" \
  -m "Tested: npx playwright test tests/terminal-question-rendering.spec.ts --reporter=line" \
  -m "Tested: npm run verify:map-terminals" \
  -m "Tested: npm run verify:agent-status-summary" \
  -m "Tested: npm run verify:terminal-rendering" \
  -m "Tested: git diff --check"
```

Expected: commit succeeds. If build is blocked by unrelated WIP, do not include a build trailer.

---

## Self-Review

- Spec coverage:
  - Header false positives: covered by Tasks 1 and 2.
  - Workspace label reliability: covered by Task 1 and existing `header-project-label` tests.
  - Task description clarity: covered by Task 1 title/task row source priority and Task 2 visual assertions.
  - AskUserQuestion duplicated/broken text: covered separately by Task 3.
  - Autonomous execution: covered by exact commands and pass/fail expectations.
- Placeholder scan:
  - No `TBD` or open-ended “handle edge cases” steps remain.
- Type consistency:
  - `ShellTerminalHeaderViewModel` fields are consistently `{ text, source }`.
  - `buildShellTerminalHeaderViewModel` is the single public builder.
