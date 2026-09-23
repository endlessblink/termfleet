// Canonical cockpit pane task-source vocabulary — the single copy.
//
// A pane's snapshot `taskSource` says WHICH pane-owned source produced its Task row.
// Two verifiers ask "is that source bounded and pane-owned, or is it an invented
// model/scrape fallback?": the snapshot producer (`cockpit-snapshot.mjs`) and the
// doctor (`termfleet-doctor.mjs`). They each carried their OWN literal and drifted
// apart, so the doctor failed a fresh, correct snapshot with
// `unsupported task source(s): plan-explanation` while the app was behaving.
// Keep this the only copy; `tests/cockpit-task-sources.spec.ts` fails when the set
// stops covering what the app can actually emit.
//
// Authority for the members: `TerminalHeaderGoalSource` in
// `src/lib/terminalHeaderState.ts` (the union a pane header can report), plus
// `agent-status` for agent lanes, which `SplitPane.tsx` stamps instead of a
// terminal goal source.

export const COCKPIT_TASK_SOURCES = [
  // TerminalHeaderGoalSource (src/lib/terminalHeaderState.ts)
  "task-tool",
  "user-prompt",
  "plan-binding",
  "plan-explanation",
  "goal-task",
  "agent-goal",
  "sidecar-todo",
  "manual",
  "workstream",
  "shell-role",
  "task-line",
  "missing",
  "none",
  // Agent lanes (SplitPane.tsx) stamp the agent-status source instead.
  "agent-status",
];

export const cockpitTaskSources = new Set(COCKPIT_TASK_SOURCES);

export function isCockpitTaskSource(source) {
  return cockpitTaskSources.has(String(source ?? "").trim());
}
