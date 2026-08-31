# TermFleet Canonical Agent Board — Codex Implementation Brief

## Canonical-list identity — read this first

For this feature, **"the canonical list", "the canonical task list", "the agent task list", "the Kanban", and "the shared backlog" all mean exactly this file**:

`<agentOpsRoot>/MASTER_PLAN.md`

Its management boundary is:

`<agentOpsRoot>/agent_ops.py`

Do not answer that FlowState is the canonical list for this feature. FlowState is Noam's separate personal planning/task system. A Life-Boat release matrix or a repository-local `MASTER_PLAN.md` is a project implementation backlog. Neither is the cross-agent queue rendered by this board.

If any instruction, memory, project note, or existing UI label is ambiguous, this identity rule wins for `FEATURE-12`. The board must load and mutate `agent-ops/MASTER_PLAN.md`, and installed-runtime verification must prove the displayed canonical path/source identity rather than merely showing task-shaped data.

## Mission

Build a first-class interactive Kanban board inside TermFleet for managing and launching cross-agent work.

Do not stop at a plan or mockup. Inspect the existing architecture, implement a working vertical slice, run real tests, build and promote the desktop release, and verify the dock-launched TermFleet application.

## Starting points

- TermFleet repository: this checkout
- Canonical cross-agent queue: `<agentOpsRoot>`
- Sole canonical task-state store: `<agentOpsRoot>/MASTER_PLAN.md`
- Canonical management CLI: `<agentOpsRoot>/agent_ops.py`
- Canonical task: `FEATURE-12 — Add an interactive canonical Kanban and agent launcher to TermFleet`

## Required preparation

Before changing production code:

1. Read in full:
   - `AGENTS.md`
   - the relevant instructions and current state in `MASTER_PLAN.md`
   - `package.json`
   - `src/hooks/useMasterPlanTasks.ts`
   - `src/lib/masterPlanTasks.ts`
   - `src/stores/workspace.ts`
   - `src/lib/types.ts`
   - the existing sidebar, header, terminal, workspace, project, and agent-workstream components
   - `scripts/termfleetctl.mjs`
   - tests covering task identity, agent workstreams, project/sidebar behavior, and workspace hydration
2. Read:
   - `<agentOpsRoot>/README.md`
   - `<agentOpsRoot>/AGENTS.md`
   - `FEATURE-12` in the canonical `agent-ops/MASTER_PLAN.md`
3. Inspect Git state and preserve unrelated existing work.
4. Follow all regression-planning, visual-design, and regression-verification skills required by TermFleet's `AGENTS.md`.
5. Atomically claim `FEATURE-12` as `codex` through `agent_ops.py`. If another agent already owns the claim, do not bypass the lock; report the blocker.
6. Record the implementation plan as human-readable cockpit tasks, with exactly one task in progress at a time.

## Product objective

Add a first-class TermFleet surface, named appropriately such as **Tasks** or **Agent Board**, where the operator can:

- View every canonical cross-agent task as an interactive Kanban board.
- Search, sort, filter, inspect, create, and edit tasks.
- Manage tasks assigned to agents operating outside TermFleet, including Hermes/Life-Boat.
- Launch supported agents directly from task cards.
- Open a terminal pane linked to the correct task and project workspace.
- Create and register a project through a guided project-creation flow when no suitable workspace exists.
- Preserve a visible and durable relationship among the canonical task, project, workspace, agent, run, terminal pane, process/session, progress, and completion evidence.

## Non-negotiable authority boundary

`agent-ops/MASTER_PLAN.md` remains the only canonical state store for shared tasks.

TermFleet is a:

- visualization surface;
- interaction surface;
- dispatch surface;
- runtime and terminal-observation surface.

TermFleet must not create a parallel task database, competing source of truth, or local task state that can diverge from `agent-ops`.

Do not write canonical Markdown directly from React components. Build a typed adapter over `agent_ops.py`. If the CLI lacks stable structured output, extend it compatibly with versioned JSON and tests. Every mutation must use canonical operations, validation, and exact-task read-back.

TermFleet-local data is allowed only for runtime/execution metadata that does not redefine canonical task state.

## Integration topology — separate product, thin TermFleet client

`agent-ops` must remain an independent project and tool-neutral service boundary. Do not move, vendor, fork, or reimplement it inside the TermFleet repository. It must continue to work when TermFleet is closed and remain directly usable by Hermes, Codex, Claude Code, OpenCode, Cursor, scripts, and humans.

TermFleet owns only:

- the Kanban and task-management UI;
- a thin typed `AgentOpsClient`/adapter;
- project selection and project-creation UX;
- agent dispatch, run tracking, terminal/session links, and local runtime metadata.

`agent-ops` owns:

- canonical task schema and validation;
- locking and concurrency;
- task CRUD and status transitions;
- claim, progress, blocking, review, and completion semantics;
- structured receipts and exact-task read-back;
- a stable, versioned machine interface.

For the first release, a versioned JSON CLI invoked through typed Tauri commands is an acceptable transport. Hide transport details behind the client interface so `agent-ops` can later expose a local Unix-socket or HTTP daemon without rewriting the board. Do not create a TermFleet-only API contract, import Python internals into TermFleet, depend on the current working directory, or scatter the absolute repository path through the application.

The adapter must discover the `agent-ops` executable/root through one explicit configuration and capability probe, report its version and active canonical source, and fail closed on incompatibility. A mock/in-memory adapter is allowed only for tests and previews; the installed application must use the external `agent-ops` boundary.

## Phase 1 — Canonical agent-ops adapter

Create a typed adapter that supports at least:

- list all tasks;
- read one task;
- validate the queue;
- add a task;
- edit supported fields;
- claim;
- record progress;
- transition status;
- mark blocked;
- complete with evidence;
- exact-task read-back.

Requirements:

- Versioned JSON schema.
- Typed errors rather than parsing human-readable messages.
- Bounded timeouts.
- File-lock and concurrent-claim handling.
- An invalid plan fails closed and is not rendered as an empty board.
- Every mutation performs validation and exact-task read-back before UI success.
- No optimistic success before canonical confirmation.
- A failed mutation restores the previous card state and presents an actionable error.
- No credential, token, auth, secret, or `.env` file access.
- Prefer typed Tauri commands with separate arguments over frontend shell execution.
- Never construct shell command strings from UI input.

## Phase 2 — Interactive Kanban

Add a real view to TermFleet's existing navigation architecture.

### Columns

- `TRIAGE`
- `PLANNED`
- `IN PROGRESS`
- `BLOCKED`
- `REVIEW`
- `DONE`

### Board capabilities

- Free-text search.
- Filter by:
  - status;
  - task type: `TASK`, `BUG`, `FEATURE`, `INQUIRY`, or `ISSUE`;
  - priority;
  - category/tag;
  - project/workspace;
  - owner/agent;
  - dependency readiness;
  - external versus TermFleet-launched execution.
- Sort by:
  - priority;
  - update time;
  - canonical ID;
  - project;
  - owner.
- Show or hide completed work.
- Refresh manually and reconcile safe external changes.
- Provide accessible keyboard navigation.
- Support drag-and-drop state changes plus an accessible non-drag alternative.
- Provide clear create and edit forms.

### Card detail

Show:

- canonical ID;
- title;
- description;
- status;
- priority;
- owner;
- source;
- workspace;
- dependencies;
- acceptance criteria;
- progress history;
- completion evidence;
- linked agent run, session, and terminal when present.

Do not invent UI-only categories. If custom categories beyond task type and workspace/project are required, add a validated canonical category/tags field to `agent-ops`, with backward-compatible migration and tests.

## Phase 3 — External agent management

The first release must genuinely support agents that operate outside TermFleet.

Examples include:

- Hermes/Life-Boat;
- Codex launched outside TermFleet;
- external Claude Code or OpenCode sessions;
- another agent or human updating `agent-ops` independently.

Maintain a clear separation among:

1. **Task** — canonical desired work and task state.
2. **Execution/Run** — one attempt to perform the task.
3. **Agent** — the performer.
4. **Terminal** — an optional TermFleet terminal pane.
5. **External reference** — a non-secret session/thread/reference when no local process exists.

Required behavior:

- Assign or claim a task for an external agent.
- Register a run as external.
- Store a safe agent label and non-secret reference.
- Show states such as:
  - assigned externally;
  - awaiting external update;
  - external work reported;
  - needs review.
- Write progress and completion through `agent-ops`.
- Reflect changes made outside TermFleet after refresh without duplicating tasks.
- Never claim to manage a process without a real process handle.
- Never store tokens, credentials, or personal conversation content in external references.

Runtime metadata may be TermFleet-local, but it must never override `CanonicalTask.status`.

## Phase 4 — Launch an agent from a card

Add a **Launch agent** action.

Flow:

1. Re-read the exact task from the canonical source.
2. Verify that dependencies allow work to begin.
3. Verify that the workspace exists and is allowed.
4. Present available agent/provider adapters.
5. Atomically claim the task.
6. Create a new terminal pane with:
   - `cwd` equal to the task workspace;
   - canonical task ID;
   - project identity;
   - agent/provider identity;
   - a distinct runtime session identity;
   - a durable purpose derived from the task.
7. Start the agent in that terminal.
8. Supply a task brief containing:
   - canonical task ID;
   - title;
   - description;
   - acceptance criteria;
   - source;
   - dependencies;
   - workspace;
   - instructions to record progress and completion through `agent_ops.py`.
9. Link the card, execution record, and terminal pane.
10. Enter `IN PROGRESS` only after a successful claim and valid execution creation.
11. A launch failure must not leave an unexplained claimed or in-progress task.

Initially support at least:

- Codex;
- Claude Code;
- OpenCode;
- a safely configured generic-command adapter;
- external/manual-agent registration for Hermes and providers without a supported local launcher.

Do not guess provider commands. Discover and extend TermFleet's existing provider and agent-launch mechanisms. Do not inspect credential files. Do not put secrets in arguments, logs, prompts, or execution metadata.

Use typed argument arrays and validated invocation. A generic adapter must use explicit configuration and an allowlisted shape; it must not execute an arbitrary raw shell string supplied by the UI.

## Phase 5 — Correct project and workspace association

Every launched task must use a valid project and workspace.

When the workspace exists:

- Reuse TermFleet's existing project-reconciliation model.
- Open the terminal inside that workspace.
- Show the project identity on both the task card and terminal.
- Never merge distinct conversations merely because they share a working directory.
- Preserve per-pane and per-run identity.

When the task has no workspace, the path is missing, or the operator chooses a new project, open the project-creation flow.

## Phase 6 — Create Project flow

Build a concise guided wizard with:

- project display name;
- folder/slug name;
- category or parent root;
- full path preview;
- template selection if TermFleet already has a template mechanism;
- optional Git initialization, only when explicitly selected;
- explicit confirmation before filesystem changes.

The project scan root is operator-supplied: `projectRoots` in the TermFleet
config file, or `TERMFLEET_PROJECT_ROOTS`.

Do not scatter this path as a hardcoded UI constant. Reuse an existing project registry/configuration source or introduce one typed, centralized configuration value.

The wizard must:

- normalize slugs predictably;
- preserve display name separately from folder name;
- prevent path traversal;
- reject absolute child paths;
- enforce configured allowed roots;
- detect collisions;
- never overwrite an existing directory or repository;
- create the approved directory with the approved name;
- register the project through TermFleet's existing project model;
- update the task's canonical workspace through `agent-ops`;
- validate and read the task back exactly;
- return to the launch flow with the new project selected;
- clean up partial creation when safe, or expose an explicit recovery path when rollback is unsafe.

Do not automatically create a README, package manifest, Git repository, Obsidian note, or Watchpost registration without first discovering existing mechanisms and requiring an explicit choice or documented project policy. Prefer an extensible staged flow over guessed scaffolding.

## Suggested data boundaries

Adapt these to the existing architecture rather than copying them blindly.

```ts
type CanonicalTask = {
  id: string;
  type: "TASK" | "BUG" | "FEATURE" | "INQUIRY" | "ISSUE";
  title: string;
  status: "TRIAGE" | "PLANNED" | "IN PROGRESS" | "BLOCKED" | "REVIEW" | "DONE";
  priority: "P1" | "P2" | "P3";
  owner?: string;
  source: string;
  workspace: string;
  dependencies: string[];
  description: string;
  acceptance: AcceptanceItem[];
  progress: ProgressEntry[];
  categories?: string[];
  updatedAt?: string;
};

type TaskExecution = {
  id: string;
  taskId: string;
  mode: "termfleet" | "external";
  agentId: string;
  provider?: string;
  projectId?: string;
  workspace?: string;
  runtimeSessionId?: string;
  providerSessionId?: string;
  terminalPaneId?: string;
  externalReference?: string;
  state:
    | "registered"
    | "starting"
    | "running"
    | "waiting"
    | "failed"
    | "stopped"
    | "finished";
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  failureReason?: string;
};
```

`TaskExecution` may be TermFleet-local because it describes runtime state. It must not become authoritative for canonical task state.

## Required failure handling

Cover explicitly:

- `agent-ops` is missing.
- Python or the CLI is unavailable.
- `MASTER_PLAN.md` is invalid.
- A task disappears between render and mutation.
- Another agent claims the task.
- The UI is stale.
- The workspace is missing.
- A project-folder collision occurs.
- Project creation fails partway through.
- The selected agent command is unavailable.
- A terminal is created but launch fails.
- Launch succeeds but canonical state update fails.
- TermFleet restarts during a run.
- An external agent changes a task while its card is open.
- The same task receives two launch requests.
- The same provider conversation is opened in two live panes.
- The adapter times out.
- An older `agent-ops` version encounters category metadata.

## Required tests

Write focused failing regressions before production changes.

### Agent-ops adapter

- JSON parsing and schema validation.
- List and exact read.
- Mutation, validation, and exact read-back.
- Invalid plan.
- Concurrent claim.
- Stale mutation.
- Timeout.
- Backward compatibility.

### Kanban

- Grouping by status.
- Combined filtering and sorting.
- Show/hide completed work.
- Task detail.
- Successful drag/drop.
- Rollback after canonical mutation failure.
- Refresh after external updates.
- No duplicate task authority.
- Canonical category persistence.

### Launch

- Correct workspace and project identity.
- Canonical ID injection.
- Claim before launch.
- No unexplained `IN PROGRESS` state after launch failure.
- Linked run and terminal.
- Distinct run identities for multiple panes sharing a workspace.
- External-agent registration without a fake local process.
- Restart and rehydration behavior.

### Project creation

- Valid slug and path.
- Path-traversal rejection.
- Collision rejection.
- Allowed-root enforcement.
- Directory creation.
- Canonical workspace update.
- Rollback or recovery after partial failure.
- Launch continuation after project creation.

### End-to-end

Create a Playwright flow that:

1. Loads an isolated canonical board.
2. Filters and sorts cards.
3. Opens a task.
4. Safely transitions a fixture task.
5. Registers an external agent.
6. Creates a temporary project.
7. Launches a fake/test agent in a linked terminal.
8. Records progress.
9. Completes with evidence.

Also run an installed Tauri end-to-end verification against the promoted release, not only browser preview.

Do not destructively mutate the production queue during automated tests. Use an isolated temporary `agent-ops` fixture/repository. A read-only smoke test against the real queue is acceptable.

## UI quality

- Integrate with TermFleet's existing design and navigation.
- Use clear, everyday labels suitable for non-developers.
- Do not expose command lines or implementation jargon as primary titles.
- Avoid dense cards-inside-cards dashboards.
- Do not require horizontal scrolling for primary actions.
- Make status, owner, project, and launch state understandable at a glance.
- Require confirmation for destructive actions.
- Provide keyboard focus behavior and accessible labels.
- Follow the local design skill and visual acceptance rules in `AGENTS.md`.

## Constraints

- Do not replace `agent-ops`.
- Do not create a parallel SQLite or JSON task database.
- Do not use TermFleet's project-local `MASTER_PLAN.md` as the shared queue.
- TermFleet's `MASTER_PLAN.md` may record local implementation evidence linked to `FEATURE-12`, but task authority remains in `agent-ops`.
- Do not overwrite unrelated work.
- Do not expose credentials.
- Do not mark the feature complete based only on a frontend build.
- Do not stop at a browser mock.
- Do not push or merge without explicit instruction.

## Execution order

1. Inspect the architecture and write a concise implementation plan.
2. Record human-readable cockpit task steps, keeping exactly one in progress.
3. Claim `FEATURE-12` canonically.
4. Add failing regression tests.
5. Add or extend the structured agent-ops adapter.
6. Implement the read-only Kanban vertical slice.
7. Implement validated canonical mutations.
8. Implement external-agent registration.
9. Implement TermFleet-launched agent runs.
10. Implement project selection and the Create Project flow.
11. Connect task, project, run, and terminal identities.
12. Run focused tests.
13. Run broader relevant Playwright suites.
14. Run:
    - `npm run build`
    - `git diff --check`
    - relevant Rust tests/checks
    - the required TermFleet regression-verifier skill
15. Build and promote the actual release:
    - `npm run release:install`
    - `npm run verify:installed-release`
16. Verify the dock-launched app and capture visual/runtime evidence.
17. Update TermFleet implementation evidence.
18. Update `FEATURE-12` progress or completion through `agent_ops.py`, validate, and read the exact task back.
19. Review the full diff.
20. Commit only scoped changes with a descriptive commit message. Do not push.

## Definition of done

The work is not complete until the installed TermFleet application can demonstrably:

1. Display the canonical cross-agent queue as a Kanban board.
2. Search, filter, and sort tasks.
3. Inspect and mutate a task canonically.
4. Manage a task performed by an external agent such as Hermes.
5. Launch a supported agent in a terminal associated with the correct workspace.
6. Create a project and correctly named directory through the UI when no workspace exists.
7. Write the new workspace back to the canonical task.
8. Preserve durable links among task, project, run, and terminal.
9. Recover correct state after restart.
10. Prove through tests and installed-runtime evidence that no competing task authority was introduced.

## Required final report

Return:

- architecture summary;
- files changed;
- schema or migration changes;
- exact tests run and their real results;
- installed-release verification result;
- screenshot or evidence-bundle paths;
- final `FEATURE-12` state after validation and exact read-back;
- commit hash;
- limitations or gaps not verified in reality.
