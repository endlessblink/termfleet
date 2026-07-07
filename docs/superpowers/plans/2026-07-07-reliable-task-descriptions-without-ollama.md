# Reliable Task Descriptions Without Ollama Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make TermFleet task descriptions 100% provenance-safe: never show an unsupported inferred task, even when that means showing `Task not captured`.

**Architecture:** Replace model/terminal-title inference with a deterministic task identity resolver that ranks bounded sources and exposes provenance. Local model summaries become optional annotations only; they never own the `Task:` row or task sidebar. Verification asserts both positive cases and failure cases where TermFleet must refuse to guess.

**Tech Stack:** Tauri 2, React, TypeScript, existing sidecar files, existing `WorkstreamStatusSummary`, existing `TaskLineupItem`, Vitest/Playwright-style project tests via `npm test`/`npm run build`.

---

## Research Findings

- GitHub Copilot cloud agent anchors work to delegated prompts, issues, PR comments, branches, and logs. Its docs describe task delegation through agents panel/issues/PR comments, evaluation based on the assigned prompt, branch-based work, logs, and tracked steps instead of local hidden chat state.
- Claude Code exposes structured task lifecycle metadata. `TaskCompleted` includes `task_id`, `task_subject`, and `task_description`; `Stop.background_tasks` includes per-task `id`, `type`, `status`, `description`, and command metadata.
- Devin uses scoped sessions, Ask-to-Agent planning, repository selection, visible progress updates, command history linked to progress updates, Session Insights, and explicit improved prompts. It treats shell output as evidence/progress, not as the source of task identity.
- Aider keeps intent in explicit chat modes and user requests, then uses a repo map for code context. It does not infer the task from arbitrary terminal output.
- Academic agent-PR studies reinforce the same shape: failed agent work often comes from misalignment, ambiguous requirements, missing validation, or lost sessions. Better upfront task definition and constraints reduce waste.

## Reliability Definition

`100% reliable` means:

- TermFleet never invents the visible task description from weak evidence.
- Every displayed task has a source class and evidence pointer.
- If no bounded source exists, the UI shows `Task not captured`.
- Terminal text may set activity/status such as `Running tests` or `Waiting`, but cannot set the durable `Task:` row.
- Ollama/model output may enrich a details field only when explicitly enabled and cannot outrank deterministic sources.

This does not mean TermFleet always knows the human's true intent. It means TermFleet is always honest about what it knows.

## Source Ranking Contract

Use this exact precedence for the visible task description:

1. `manual`: user-edited task title or task binding in TermFleet.
2. `task-tool`: provider-native structured task fields, including Claude `TaskCompleted.task_subject`, `task_description`, `Stop.background_tasks[].description`, Codex/OMX task metadata when available.
3. `user-prompt`: durable submitted prompt captured at session/run start.
4. `plan-binding`: bound `MASTER_PLAN.md` task id/title or issue/PR/Jira/Linear title.
5. `sidecar-todo`: current TodoWrite/TaskCreate/TaskUpdate item from sidecar files.
6. `workstream`: explicit `workstream.mission`, `workstream.prompt`, or `workstream.userTask`.
7. `missing`: `Task not captured`.

Forbidden as task identity sources:

- Ollama summaries.
- Arbitrary terminal scrollback.
- Shell commands such as `npm run build`, `git status`, `cargo test`.
- Slash command echoes such as `/review`, `/sure`, `$done`.
- Status fragments such as `waiting`, `stale`, `3 ptys`, `reconnected`.

## File Structure

- Create `src/lib/taskIdentity.ts`: pure deterministic resolver for task identity, source ranking, provenance, and rejection reasons.
- Modify `src/lib/types.ts`: add `TaskIdentity`, `TaskIdentitySource`, `TaskIdentityEvidence`, and optional fields on status/workstream types only where needed.
- Modify `src/lib/terminalHeaderState.ts`: call the resolver and map its result into `goalLabel`, `userGoal`, and `sources.goal`.
- Modify `src/lib/terminalHeaderViewModel.ts`: remove model/summary ownership of `taskDescription`; accept resolved identity from state or invoke resolver directly if keeping this as the central header builder.
- Modify `src/lib/taskLineup.ts`: make task sidebar use only authoritative lineup sources unless explicitly configured to show heuristic fallback under a separate label.
- Modify `scripts/agent-status-summary-server.mjs`: default all context title/Ollama paths off; emit model text only as `modelAnnotation` when enabled.
- Modify `scripts/agent-status-summary-sidecar.mjs`: emit structured sidecar task fields without model-style `summary` provenance for task identity.
- Modify `scripts/termfleet-doctor.mjs`: add checks for unsupported task sources and warn if Ollama/status server is trying to own task identity.
- Test `tests/task-identity.spec.ts`: resolver precedence, missing-source behavior, and forbidden-source rejection.
- Test `tests/terminal-header-state.spec.ts`: header `Task:` row source and fallback behavior.
- Test `tests/visible-task-lineup.spec.ts`: sidebar refuses summary/terminal-only task lists by default.
- Test `tests/agent-status-summary.spec.ts`: status server cannot produce authoritative task descriptions from Ollama or transcript-only payloads.
- Test `tests/terminal-header-quality.spec.ts`: regressions for slash-command echoes, shell commands, stale output, and model narration in task row.

---

### Task 1: Lock The Task Identity Contract

**Files:**
- Create: `src/lib/taskIdentity.ts`
- Modify: `src/lib/types.ts`
- Test: `tests/task-identity.spec.ts`

- [ ] **Step 1: Add failing resolver tests**

Create `tests/task-identity.spec.ts` with cases for every source rank:

```ts
import { expect, test } from "@playwright/test";
import { resolveTaskIdentity } from "../src/lib/taskIdentity";

  test("manual task wins over every automatic source", () => {
    const result = resolveTaskIdentity({
      manualTask: { title: "Fix map terminal reconnects", evidence: "node:abc" },
      taskTool: { title: "Wrong lower-priority task", evidence: "hook:task-1" },
      userPrompt: { text: "Wrong prompt", evidence: "run:old" },
    });
    expect(result).toMatchObject({
      title: "Fix map terminal reconnects",
      source: "manual",
      confidence: "authoritative",
    });
  });

  test("task-tool structured subject wins over prompt and sidecar todo", () => {
    const result = resolveTaskIdentity({
      taskTool: {
        title: "Implement user authentication",
        description: "Add login and signup endpoints",
        evidence: "claude:TaskCompleted:task-001",
      },
      userPrompt: { text: "do the auth thing", evidence: "run:prompt" },
      sidecarTodos: [{ content: "Read auth files", status: "in_progress", source: "todo-write", updatedAt: 1, id: "todo:1" }],
    });
    expect(result.title).toBe("Implement user authentication");
    expect(result.description).toBe("Add login and signup endpoints");
    expect(result.source).toBe("task-tool");
  });

  test("durable prompt wins when no structured task exists", () => {
    const result = resolveTaskIdentity({
      userPrompt: { text: "Make map mode terminals reconnect after relaunch", evidence: "run:submitted-input" },
      terminalText: "npm run build",
    });
    expect(result.title).toBe("Make map mode terminals reconnect after relaunch");
    expect(result.source).toBe("user-prompt");
  });

  test("plan binding wins over sidecar todo when no prompt exists", () => {
    const result = resolveTaskIdentity({
      planBinding: { id: "TC-041", title: "Restart-survivable terminal restore", evidence: "MASTER_PLAN.md#TC-041" },
      sidecarTodos: [{ content: "Inspect daemon status", status: "in_progress", source: "todo-write", updatedAt: 1, id: "todo:1" }],
    });
    expect(result.title).toBe("TC-041: Restart-survivable terminal restore");
    expect(result.source).toBe("plan-binding");
  });

  test("sidecar todo can provide task identity only when no stronger bounded source exists", () => {
    const result = resolveTaskIdentity({
      sidecarTodos: [{ content: "Diagnose map terminal reconnect failure", status: "in_progress", source: "todo-write", updatedAt: 1, id: "todo:1" }],
    });
    expect(result.title).toBe("Diagnose map terminal reconnect failure");
    expect(result.source).toBe("sidecar-todo");
  });

  test("terminal output and model summary are rejected as task identity", () => {
    const result = resolveTaskIdentity({
      terminalText: "npm run build\n3 ptys reconnected\n/review",
      modelSummary: "Fixing terminal headers",
    });
    expect(result.title).toBe("Task not captured");
    expect(result.source).toBe("missing");
    expect(result.rejections).toEqual(expect.arrayContaining(["terminal-output", "model-summary"]));
  });
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
playwright test tests/task-identity.spec.ts --reporter=line
```

Expected: fails because `src/lib/taskIdentity.ts` does not exist.

- [ ] **Step 3: Add the resolver types**

In `src/lib/types.ts`, add:

```ts
export type TaskIdentitySource =
  | "manual"
  | "task-tool"
  | "user-prompt"
  | "plan-binding"
  | "sidecar-todo"
  | "workstream"
  | "missing";

export interface TaskIdentityEvidence {
  source: TaskIdentitySource;
  ref: string;
}

export interface TaskIdentity {
  title: string;
  description?: string;
  source: TaskIdentitySource;
  confidence: "authoritative" | "bounded" | "missing";
  evidence?: TaskIdentityEvidence;
  rejections: string[];
}
```

- [ ] **Step 4: Add the minimal resolver**

Create `src/lib/taskIdentity.ts`:

```ts
import type { TaskIdentity, TaskLineupItem } from "./types";

interface EvidenceText {
  title?: string | null;
  description?: string | null;
  evidence?: string | null;
}

interface PromptText {
  text?: string | null;
  evidence?: string | null;
}

interface PlanBinding {
  id?: string | null;
  title?: string | null;
  evidence?: string | null;
}

export interface TaskIdentityInput {
  manualTask?: EvidenceText | null;
  taskTool?: EvidenceText | null;
  userPrompt?: PromptText | null;
  planBinding?: PlanBinding | null;
  sidecarTodos?: TaskLineupItem[] | null;
  workstream?: EvidenceText | null;
  terminalText?: string | null;
  modelSummary?: string | null;
}

function cleanTitle(value?: string | null) {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (/^(?:npm|pnpm|yarn|cargo|git|node|python|curl|docker)\s+/i.test(text)) return undefined;
  if (/^(?:\/[a-z-]+|\$[a-z-]+)$/i.test(text)) return undefined;
  if (/^(?:waiting|stale|reconnected|\d+\s+ptys?)\b/i.test(text)) return undefined;
  return text.slice(0, 140);
}

function result(
  source: TaskIdentity["source"],
  title: string,
  evidence: string | undefined,
  rejections: string[],
  description?: string,
): TaskIdentity {
  return {
    title,
    ...(description ? { description } : {}),
    source,
    confidence: source === "missing" ? "missing" : source === "manual" || source === "task-tool" ? "authoritative" : "bounded",
    ...(evidence ? { evidence: { source, ref: evidence } } : {}),
    rejections,
  };
}

export function resolveTaskIdentity(input: TaskIdentityInput): TaskIdentity {
  const rejections: string[] = [];
  if (input.terminalText) rejections.push("terminal-output");
  if (input.modelSummary) rejections.push("model-summary");

  const manual = cleanTitle(input.manualTask?.title);
  if (manual) return result("manual", manual, input.manualTask?.evidence ?? undefined, rejections, cleanTitle(input.manualTask?.description));

  const taskTool = cleanTitle(input.taskTool?.title);
  if (taskTool) return result("task-tool", taskTool, input.taskTool?.evidence ?? undefined, rejections, cleanTitle(input.taskTool?.description));

  const prompt = cleanTitle(input.userPrompt?.text);
  if (prompt) return result("user-prompt", prompt, input.userPrompt?.evidence ?? undefined, rejections);

  const planTitle = cleanTitle(input.planBinding?.title);
  if (planTitle) {
    const id = cleanTitle(input.planBinding?.id);
    return result("plan-binding", id ? `${id}: ${planTitle}` : planTitle, input.planBinding?.evidence ?? undefined, rejections);
  }

  const sidecar = (input.sidecarTodos ?? []).find((item) => item.status === "in_progress")
    ?? (input.sidecarTodos ?? []).find((item) => item.status === "pending");
  const sidecarTitle = cleanTitle(sidecar?.content);
  if (sidecarTitle) return result("sidecar-todo", sidecarTitle, sidecar?.id, rejections);

  const workstream = cleanTitle(input.workstream?.title);
  if (workstream) return result("workstream", workstream, input.workstream?.evidence ?? undefined, rejections, cleanTitle(input.workstream?.description));

  return result("missing", "Task not captured", undefined, rejections);
}
```

- [ ] **Step 5: Run resolver test**

Run:

```bash
playwright test tests/task-identity.spec.ts --reporter=line
```

Expected: pass.

### Task 2: Wire Header Task Row To The Resolver

**Files:**
- Modify: `src/lib/terminalHeaderState.ts`
- Modify: `src/lib/terminalHeaderViewModel.ts`
- Test: `tests/terminal-header-state.spec.ts`
- Test: `tests/terminal-header-view-model.spec.ts`

- [ ] **Step 1: Add failing header tests**

Add cases proving:

```ts
expect(state.goalLabel).toBe("Task not captured");
expect(state.sources.goal).toBe("missing");
expect(state.debug.taskIdentityRejectedModelSummary).toBe(true);
```

for a transcript/model-only summary, and:

```ts
expect(state.goalLabel).toBe("Make map mode terminals reconnect after relaunch");
expect(state.sources.goal).toBe("user-prompt");
```

for a durable submitted prompt.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
playwright test tests/terminal-header-state.spec.ts tests/terminal-header-view-model.spec.ts --reporter=line
```

Expected: at least one failure showing status/model summary can still own task text.

- [ ] **Step 3: Map resolver output into `TerminalHeaderState`**

In `buildTerminalHeaderState`, call `resolveTaskIdentity` before returning state. Use existing inputs:

```ts
const taskIdentity = resolveTaskIdentity({
  manualTask: undefined,
  taskTool: input.statusSummary?.tasksFromTodoWrite
    ? { title: input.statusSummary.task, description: input.statusSummary.userTask, evidence: "statusSummary:todo-write" }
    : undefined,
  userPrompt: input.mainUserAsk?.text
    ? { text: input.mainUserAsk.text, evidence: input.mainUserAsk.source }
    : undefined,
  sidecarTodos: input.taskLineup,
  workstream: input.statusSummary?.workstreamMission
    ? { title: input.statusSummary.workstreamMission, evidence: "workstream:mission" }
    : undefined,
  terminalText: input.summary?.transcript,
  modelSummary: input.summary?.provider === "ollama" ? input.summary.task : undefined,
});
```

If current types do not have `workstreamMission` or `transcript`, omit those fields in this task and add only the fields already present. Do not add broad transcript plumbing.

- [ ] **Step 4: Return resolver values**

Set:

```ts
goalLabel: taskIdentity.title,
userGoal: taskIdentity.source === "missing" ? null : taskIdentity.title,
sources.goal: taskIdentity.source === "task-tool" ? "task-tool" : taskIdentity.source,
debug: {
  ...view.debug,
  taskIdentitySource: taskIdentity.source,
  taskIdentityEvidence: taskIdentity.evidence?.ref,
  taskIdentityRejectedModelSummary: taskIdentity.rejections.includes("model-summary"),
  taskIdentityRejectedTerminalOutput: taskIdentity.rejections.includes("terminal-output"),
}
```

- [ ] **Step 5: Run header tests**

Run:

```bash
playwright test tests/terminal-header-state.spec.ts tests/terminal-header-view-model.spec.ts --reporter=line
```

Expected: pass.

### Task 3: Remove Ollama From Authoritative Task Flow

**Files:**
- Modify: `scripts/tauri-dev-with-status.sh`
- Modify: `scripts/agent-status-summary-server.mjs`
- Modify: `scripts/verify-agent-status-summary-server.mjs`
- Test: `tests/agent-status-summary.spec.ts`

- [ ] **Step 1: Add failing tests**

Add assertions that a response derived only from model output includes:

```js
assert.equal(summary.task, "Task not captured");
assert.equal(summary.taskSource, "missing");
assert.equal(summary.modelAnnotation?.source, "ollama");
```

and that default launcher text contains:

```js
assert.match(tauriDevWrapper, /TERMFLEET_CONTEXT_TITLE_DISABLE:-1/);
```

- [ ] **Step 2: Run status tests and verify failure**

Run:

```bash
node scripts/verify-agent-status-summary-server.mjs
playwright test tests/agent-status-summary.spec.ts --reporter=line
```

Expected: failure if Ollama/model text still owns `task`.

- [ ] **Step 3: Make model paths opt-in annotation only**

In `scripts/tauri-dev-with-status.sh`, default:

```bash
CONTEXT_TITLE_DISABLE="${TERMFLEET_CONTEXT_TITLE_DISABLE:-1}"
```

In `scripts/agent-status-summary-server.mjs`, when model context is enabled, write model output to `modelAnnotation`, never `task`, `userTask`, or `tasks`.

- [ ] **Step 4: Keep deterministic sidecar path intact**

Ensure `scripts/agent-status-summary-sidecar.mjs` remains the default worker and still emits TodoWrite/task-tool content. Do not remove sidecar support.

- [ ] **Step 5: Run status verification**

Run:

```bash
node scripts/verify-agent-status-summary-server.mjs
playwright test tests/agent-status-summary.spec.ts --reporter=line
```

Expected: pass.

### Task 4: Make The Task Sidebar Honest

**Files:**
- Modify: `src/lib/taskLineup.ts`
- Test: `tests/visible-task-lineup.spec.ts`

- [ ] **Step 1: Add failing sidebar tests**

Add a test where only summary/terminal-derived items exist:

```ts
const items = [
  { id: "summary:1", content: "npm run build", status: "in_progress", source: "summary", updatedAt: 1 },
];
expect(visibleTaskLineup(items, "run-1")).toEqual([]);
```

Add a test where sidecar todo exists:

```ts
const items = [
  { id: "todo:1", content: "Fix map terminal reconnects", status: "in_progress", source: "todo-write", updatedAt: 1, runId: "run-1" },
];
expect(visibleTaskLineup(items, "run-1")[0].content).toBe("Fix map terminal reconnects");
```

- [ ] **Step 2: Run sidebar tests and verify failure**

Run:

```bash
playwright test tests/visible-task-lineup.spec.ts --reporter=line
```

Expected: failure if summary fallback still appears as a real task.

- [ ] **Step 3: Restrict default visible lineup**

Change `visibleTaskLineup` so default visible tasks come from:

```ts
const authoritative = all.filter((item) =>
  item.source === "todo-write" ||
  item.source === "manual" ||
  item.source === "structured-signal" ||
  item.source === "lane-checklist"
);
```

Do not use `summary` unless a future explicit setting enables an `untrusted suggestions` section.

- [ ] **Step 4: Run sidebar tests**

Run:

```bash
playwright test tests/visible-task-lineup.spec.ts --reporter=line
```

Expected: pass.

### Task 5: Add Doctor And Snapshot Guards

**Files:**
- Modify: `scripts/termfleet-doctor.mjs`
- Modify: `scripts/cockpit-snapshot.mjs`
- Test: `tests/terminal-header-quality.spec.ts`

- [ ] **Step 1: Add quality cases**

Add cases rejecting these visible task values:

```ts
["npm run build", "git status", "/review", "$done", "3 ptys reconnected", "Waiting", "Fixing headers from Ollama"]
```

when their source is not one of:

```ts
["manual", "task-tool", "user-prompt", "plan-binding", "sidecar-todo", "workstream"]
```

- [ ] **Step 2: Run quality tests and verify failure**

Run:

```bash
playwright test tests/terminal-header-quality.spec.ts --reporter=line
```

- [ ] **Step 3: Update snapshot flags**

In `scripts/cockpit-snapshot.mjs`, flag:

```js
unsupported-task-source
task-row-model-owned
task-row-terminal-owned
task-row-should-be-missing
```

for any pane whose task source is unsupported or whose text matches command/status/slash-output patterns.

- [ ] **Step 4: Update doctor**

In `scripts/termfleet-doctor.mjs`, report:

```text
fail: unsupported authoritative task source
warn: optional Ollama annotation server running
ok: task identity resolver installed
```

- [ ] **Step 5: Run doctor and snapshot**

Run:

```bash
npm run doctor
npm run cockpit:snapshot
```

Expected: no `fail` for current deterministic sidecar path; warning allowed if optional status server is running.

### Task 6: End-To-End Regression Gate

**Files:**
- Modify: `package.json`
- Modify: `scripts/termfleet-gate.mjs`
- Test: existing verification scripts

- [ ] **Step 1: Add a focused command**

Add package script:

```json
"verify:task-identity": "playwright test tests/task-identity.spec.ts tests/terminal-header-state.spec.ts tests/terminal-header-quality.spec.ts tests/visible-task-lineup.spec.ts tests/agent-status-summary.spec.ts --reporter=line"
```

- [ ] **Step 2: Add gate integration**

Add `verify:task-identity` to `scripts/termfleet-gate.mjs` before visual/browser checks.

- [ ] **Step 3: Run full focused verification**

Run:

```bash
npm run verify:task-identity
npm run verify:agent-status-summary
npm run build
npm run verify:map-terminals
```

Expected: all pass.

### Task 7: Product UI Copy And Provenance Display

**Files:**
- Modify: `src/components/MagicCanvas.tsx`
- Modify: `src/components/SplitPane.tsx`
- Test: `tests/terminal-header-view-model.spec.ts`
- Optional headed proof: `npm run cockpit:capture`

- [ ] **Step 1: Display source labels**

Render task provenance as compact labels:

```ts
const TASK_SOURCE_LABELS = {
  manual: "manual",
  "task-tool": "task",
  "user-prompt": "prompt",
  "plan-binding": "plan",
  "sidecar-todo": "todo",
  workstream: "run",
  missing: "missing",
};
```

- [ ] **Step 2: Avoid fake confidence language**

Do not render `AI summary`, `high confidence`, or model names beside the task row unless it is inside a separate optional details section.

- [ ] **Step 3: Run visual/header tests**

Run:

```bash
playwright test tests/terminal-header-view-model.spec.ts --reporter=line
npm run cockpit:capture
```

Expected: task row shows text plus source, or `Task not captured` plus `missing`.

## Final Acceptance Gate

The implementation is complete only when all commands pass:

```bash
npm run verify:task-identity
npm run verify:agent-status-summary
npm run build
npm run verify:map-terminals
npm run doctor
```

And these manual checks hold in the live app:

- A live agent with TodoWrite/TaskCreate data shows the real task.
- A plain shell running `npm run build` shows `Task not captured`, not `npm run build`.
- An Ollama/status summary can never change the `Task:` row.
- The task row displays its provenance.
- Map terminals stay connected after relaunch.

## Sources

- GitHub Copilot cloud agent: https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent
- Claude Code hooks: https://code.claude.com/docs/en/hooks
- Claude Code memory: https://code.claude.com/docs/en/memory
- Devin first session: https://docs.devin.ai/get-started/first-run
- Devin session tools: https://docs.devin.ai/work-with-devin/devin-session-tools
- Devin session insights: https://docs.devin.ai/product-guides/session-insights
- Aider repo map: https://aider.chat/docs/repomap.html
- Aider chat modes: https://aider.chat/docs/usage/modes.html
- Agent PR failure analysis: https://arxiv.org/abs/2606.13468
- Task-stratified agent comparison: https://arxiv.org/abs/2602.08915
