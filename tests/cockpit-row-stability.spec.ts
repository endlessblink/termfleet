import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// Regression cover for the "map card jumps and the terminal text jiggles" report
// (2026-07-26). Root cause: the card header changed height whenever the live
// status text changed - the big activity line was mounted and unmounted, and the
// task line re-wrapped - and every header height change resized the terminal
// underneath, which reflowed the PTY grid. Height must not depend on what the
// status happens to say.
const magicCanvas = readFileSync(
  new URL("../src/components/MagicCanvas.tsx", import.meta.url),
  "utf8",
);
const sidebar = readFileSync(
  new URL("../src/components/WorkbenchSidebar.tsx", import.meta.url),
  "utf8",
);
const splitPane = readFileSync(
  new URL("../src/components/SplitPane.tsx", import.meta.url),
  "utf8",
);
const snapshotProbe = readFileSync(
  new URL("../src/components/CockpitSnapshotProbe.tsx", import.meta.url),
  "utf8",
);
const rustCommands = readFileSync(
  new URL("../src-tauri/src/commands.rs", import.meta.url),
  "utf8",
);
const cockpitCapture = readFileSync(
  new URL("../scripts/capture-cockpit.mjs", import.meta.url),
  "utf8",
);
const cockpitVisualGate = readFileSync(
  new URL("../scripts/verify-cockpit-visual.mjs", import.meta.url),
  "utf8",
);
const cockpitSnapshot = readFileSync(
  new URL("../src/lib/cockpitSnapshot.ts", import.meta.url),
  "utf8",
);
const liveVerifier = readFileSync(
  new URL("../scripts/verify-cockpit-live.mjs", import.meta.url),
  "utf8",
);
const liveHeaderVerifier = readFileSync(
  new URL("../scripts/verify-terminal-headers-live-all.sh", import.meta.url),
  "utf8",
);

test("map card headline row keeps a fixed height", () => {
  const style = magicCanvas.match(
    /terminalStatusTitle:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalStatusTitle style block").toBeTruthy();
  expect(style).toMatch(/height:\s*\d+,/);
  expect(style, "a minimum lets the row still grow").not.toMatch(
    /minHeight:\s*\d+,/,
  );
});

test("map card headline row always renders a label and a value", () => {
  // The empty state used to render null, collapsing the row by ~9px.
  const titleStart = magicCanvas.indexOf("terminalStatusTitle: {");
  const titleBlock = magicCanvas.slice(titleStart, titleStart + 2600);
  expect(titleStart).toBeGreaterThan(-1);
  expect(titleBlock.length).toBeGreaterThan(0);
  expect(titleBlock, "empty headline must not unmount the row").not.toMatch(
    /\)\s*:\s*null\}/,
  );
  // The headline now ALWAYS carries the goal, so it has no empty state of its own to
  // reserve — the reserved/hidden row moved below it, to the "Now:" line (pinned by
  // "the card shows the goal on top and the moment under it, always").
  const style = magicCanvas.match(
    /terminalStatusTitle:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style).toMatch(/height:\s*\d+,/);
});

test("map card task line is a FIXED two-line box", () => {
  // Changed deliberately 2026-07-28: the operator asked for two lines so a real goal is
  // readable ("exercise-demo-gif-pipeline" told them nothing a week later). The jiggle
  // came from a row whose height VARIED with the text, not from two lines as such — so
  // wrapping is allowed only while the height stays fixed and the text stays clamped.
  const style = magicCanvas.match(
    /terminalTaskValue:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalTaskValue style block").toBeTruthy();
  expect(style).toMatch(/WebkitLineClamp:\s*2/);
  expect(style, "the box must not grow with the text").toMatch(
    /height:\s*"[\d.]+em"/,
  );
  expect(style, "a minimum lets the row grow again").not.toMatch(
    /minHeight:/,
  );

  const bigRow = magicCanvas.match(
    /terminalNowActiveValue:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(bigRow, "terminalNowActiveValue style block").toBeTruthy();
  expect(bigRow).toMatch(/WebkitLineClamp:\s*3/);
});

test("fleet list tasks reserve two readable lines without changing height", () => {
  // The compact one-line version cut ordinary task names after three or four words.
  // Two fixed lines keep the list stable while making each card useful at a glance.
  expect(sidebar).not.toContain("sidebar-map-node-now-row");
  const style = sidebar.match(/sidebarHeaderTask:\s*\{[\s\S]*?\n {2}\},/)?.[0];
  expect(style, "sidebarHeaderTask style block").toBeTruthy();
  expect(style).toMatch(/WebkitLineClamp:\s*2/);
  expect(style).toMatch(/height:\s*"2\.8em"/);
  expect(style).not.toMatch(/whiteSpace:\s*"nowrap"/);
  expect(sidebar).toContain("header.hasCapturedGoal");
  expect(sidebar).toContain("truncateAtWordBoundary");
});

test("the card shows the goal on top and the moment under it, always", () => {
  // The operator's chosen layout (2026-07-28): "Goal on top, current step under it".
  // Before this the two swapped places depending on whether an activity existed, so the
  // big line was sometimes the goal and sometimes the moment.
  const bigRow = magicCanvas.slice(
    magicCanvas.indexOf('data-testid="canvas-terminal-node-task-row"'),
  );
  expect(bigRow.slice(0, 1200)).toContain("terminalNowActiveLabel");
  expect(
    bigRow.slice(0, 1200),
    "the big row must not switch between Task and Now",
  ).not.toContain("Now Active:");

  const nowRow = magicCanvas.slice(
    magicCanvas.indexOf('data-testid="canvas-terminal-node-now-row"'),
  );
  expect(nowRow.slice(0, 1600)).toContain(">\n                Now:\n              <");
  expect(nowRow.slice(0, 1600)).toContain("terminalHeaderNowDisplay");
});

test("cards do not rename missing values or manufacture a task-shaped Now row", () => {
  expect(magicCanvas).toContain("const terminalHeaderTaskCandidate =");
  expect(magicCanvas).toContain(
    "resolveDistinctHeaderNow(\n      terminalHeader.goalLabel,\n      terminalHeaderTaskCandidate,\n    )",
  );
  expect(magicCanvas).toContain("const terminalHeaderContextDescription =");
  expect(magicCanvas).toContain("const terminalHeaderContextCandidate =");
  expect(magicCanvas).not.toContain('"No task assigned to this terminal"');
  expect(magicCanvas).not.toContain("`Working on: ${terminalHeaderTaskDescription}`");
});

test("a missing goal keeps honest Task, Goal, and Now rows mounted", () => {
  expect(magicCanvas).toContain("terminalHeader.contextLabel");
  expect(magicCanvas).toContain('visibility: "visible"');
  expect(magicCanvas).not.toContain("This session is focused on");
  expect(magicCanvas).toContain('"Idle — no work is running"');
  expect(magicCanvas).toContain("taskSource:");
  expect(magicCanvas).toContain("contextSource:");
  expect(magicCanvas).not.toContain("No task assigned to this terminal");
  expect(magicCanvas).not.toContain("Project context: ${terminalHeader.workspace} · no goal set");
});

test("map cards keep the broad Goal separate from the specific Task and Now rows", () => {
  expect(magicCanvas).toContain("terminalHeaderContextDescription");
  expect(magicCanvas).toContain("workstream?.statusSummary ?? linkedTerminal?.statusSummary");
  expect(magicCanvas).toContain('data-testid="canvas-terminal-node-goal"');
  expect(magicCanvas).toContain("Goal:");
  expect(magicCanvas).toContain("terminalHeader.contextLabel");
});

test("map cards explain missing context without collapsing the three rows", () => {
  expect(magicCanvas).toContain("terminalHeader.contextLabel");
  expect(magicCanvas).not.toContain("This session is focused on");
  expect(magicCanvas).toContain('"Idle — no work is running"');
  expect(magicCanvas).not.toContain("Project context: ${terminalHeader.workspace} · no goal set");
  expect(magicCanvas).not.toContain("`Working on: ${terminalHeaderTaskDescription}`");
});

test("restored map cards recover their live tab from the saved working folder", () => {
  expect(magicCanvas).toContain("const restoredNodeCwd =");
  expect(magicCanvas).toContain("(node as CanvasNode & { cwd?: string }).cwd");
  expect(magicCanvas).toContain("const restoredNodePaneId =");
  expect(magicCanvas).toContain('node.id.startsWith("recovered-pane-")');
  expect(magicCanvas).toContain("const restoredNodePaneIds = new Set([");
  expect(magicCanvas).toContain("node.linkedTerminalPaneId");
  expect(magicCanvas.indexOf("terminal.paneId === node.linkedTerminalPaneId")).toBeGreaterThan(-1);
  expect(magicCanvas.indexOf("terminal.paneId === node.linkedTerminalPaneId")).toBeLessThan(
    magicCanvas.indexOf("terminal.paneId === node.id"),
  );
  expect(magicCanvas).toContain("restoredNodePaneIds.has(terminal.paneId)");
  expect(magicCanvas).toContain("restoredNodeCwd &&");
  expect(magicCanvas).toContain("tab.initialCwd === restoredNodeCwd");
  expect(magicCanvas).toContain("tab.workstream?.cwd === restoredNodeCwd");
});

test("map cards reject tool and prompt chrome from the Now row", () => {
  expect(magicCanvas).toContain("restoredNowIsSettled");
  expect(magicCanvas).toContain("const settledNow = restoredNowIsSettled ? restoredNow : \"\";");
  expect(magicCanvas).toContain("resolveDistinctHeaderNow");
  expect(magicCanvas).toContain("const distinctLiveStep = resolveDistinctHeaderNow");
  expect(magicCanvas).toContain("const distinctCandidate = resolveDistinctHeaderNow");
});

test("canvas terminal Task keeps a concrete render-time fallback when stabilization is empty", () => {
  expect(magicCanvas).toContain(
    ").title || terminalHeaderTaskDescription || canvasTaskFallback;",
  );
  expect(magicCanvas).toContain('data-testid="canvas-terminal-node-task-row"');
  expect(magicCanvas).toContain('data-testid="canvas-terminal-node-goal-task"');
  expect(magicCanvas).toContain('data-testid="canvas-terminal-node-task-kicker"');
  expect(magicCanvas).toContain("Task:");
  expect(magicCanvas).toContain('zIndex: 2');
});

test("snapshot writes discard stale panes without dropping current dock evidence", () => {
  const writer = rustCommands.slice(rustCommands.indexOf("pub fn cockpit_snapshot_write"));
  expect(writer).toContain("terminals.retain");
  expect(writer).toContain("Working toward:");
  expect(writer).not.toContain("return Ok(());");
});

test("split terminal headers show a compact stable Goal line when context exists", () => {
  expect(splitPane).toContain("contextLabel");
  expect(splitPane).toContain('data-testid="split-terminal-summary-goal"');
  expect(splitPane).toContain('data-testid="split-agent-pane-goal"');
  expect(splitPane).toContain(">\n                            Goal\n");
  expect(splitPane).toContain('displayedHeaderContext !== "Context not captured"');
  expect(splitPane).toContain("contextSource");
  expect(splitPane).not.toContain("fallbackPaneGoal(");
  expect(splitPane).not.toContain("statusSummaryGoalFallback");
});

test("split headers never promote a missing-goal placeholder into the Task row", () => {
  expect(splitPane).toContain("shellHeader?.contextLabel");
  expect(splitPane).toContain("Task:");
  expect(splitPane).toContain("rendererTaskFallback");
  expect(splitPane).not.toContain("shellHeader?.currentActivity ?? headerNow");
  expect(splitPane).not.toContain("Project context:");
});

test("every split header Goal row uses the render-time fallback", () => {
  const goalRows = splitPane.match(/data-testid=\"split-(?:agent-pane|terminal-summary)-goal\"[\s\S]{0,900}?displayedHeaderContext/g) ?? [];
  expect(goalRows.length).toBeGreaterThanOrEqual(3);
  expect(splitPane).not.toContain("title={headerContext}");
  expect(splitPane).not.toContain("{headerContext}\n");
});

test("agent split headers keep the live work, broad goal, and current moment legible together", () => {
  const agentHeader = splitPane.slice(
    splitPane.indexOf("{isAgentPane && agentStatusSummary ?"),
    splitPane.indexOf(") : shellStatusSummary ?", splitPane.indexOf("{isAgentPane && agentStatusSummary ?")),
  );

  expect(agentHeader, "the agent header branch must exist").toContain("Task:");
  expect(agentHeader, "the agent Task and Goal must occupy separate visible columns").toContain(
    'gridColumn: "3 / 4"',
  );
  expect(agentHeader, "the agent Task column must remain visible").toContain("minWidth: 150");
  expect(agentHeader).toContain('gridColumn: "4 / -1"');
  expect(agentHeader, "the broad goal must have its own labeled row").toContain(
    'data-testid="split-agent-pane-goal"',
  );
  expect(agentHeader, "the agent Goal block must carry a visible Task line").toContain(
    'data-testid="split-agent-pane-goal-task"',
  );
  expect(agentHeader, "the current moment must have its own labeled row").toContain(
    'data-testid="split-agent-pane-now"',
  );
  expect(agentHeader, "the agent branch must not hide the moment in an inline strip").toContain(
    "Now",
  );
  expect(splitPane).toContain("const agentTaskLabel = isAgentPane");
  expect(splitPane).toContain("const visibleAgentTaskLabel = agentTaskLabel ?? rendererTaskFallback");
  expect(agentHeader).toContain("{visibleAgentTaskLabel}");
  expect(splitPane).toContain("? agentTaskLabel");
  expect(splitPane).toContain("(isAgentPane ? agentTaskLabel : shellTaskLabel)");
  expect(splitPane).toContain("? agentHeader?.contextLabel");
});

test("agent split Task never falls back to the broad Goal when live work is missing", () => {
  expect(splitPane).toContain("const agentTaskCandidate =");
  expect(splitPane).toContain(
    "agentWorkstream?.taskLineup?.find(",
  );
  expect(splitPane).toContain("agentWorkstream?.mission?.trim()");
  expect(splitPane).toContain("!/^(?:Working|Thinking|Ready|Idle|Status unavailable|Activity not captured)");
  expect(splitPane).not.toContain("agentHeader?.currentActivity ||\n            agentHeader?.goalLabel");
});

test("map agent cards render the shared Task, Goal, and Now rows", () => {
  const agentBlock = magicCanvas.slice(
    magicCanvas.indexOf('data-testid="canvas-agent-status-block"'),
    magicCanvas.indexOf(') : node.type === "terminal" && workstream?.kind !== "agent"'),
  );

  expect(agentBlock, "the agent card must use the shared Task label").toContain(
    "agentCardTask",
  );
  expect(agentBlock, "the agent card must render a separate Goal row").toContain(
    'data-testid="canvas-agent-node-goal"',
  );
  expect(agentBlock, "the agent card must render a separate Now row").toContain(
    'data-testid="canvas-agent-status-now"',
  );
  expect(agentBlock, "the card must not bypass the shared state with stale summary text").not.toContain(
    "{agentStatusSummary.now}",
  );
  expect(magicCanvas, "the agent card must not copy the project Goal into Now").toContain(
    "headerTextsEquivalent(restoredAgentNow, canvasGoalFallback)",
  );
});

test("status-summary Now cannot repeat the Task before the final row guard", () => {
  expect(magicCanvas).toContain("const restoredNowIsDistinct = Boolean(");
  expect(magicCanvas).toContain(
    "!headerTextsEquivalent(restoredNow, terminalHeaderTaskDescription)",
  );
  expect(magicCanvas).toContain(
    "!headerTextsEquivalent(terminalHeaderTitle, terminalHeaderTaskDescription)",
  );
  expect(magicCanvas).toContain("restoredNowIsDistinct &&");
});

test("split header Now is distinct before telemetry is written", () => {
  expect(splitPane).toContain("const distinctHeaderNow = resolveDistinctHeaderNow(");
  expect(splitPane).toContain("const headerNowRepeatsTitle =");
  expect(splitPane).toContain('"Idle — no work is running"');
});

test("split header values wrap instead of hiding Task, Goal, and Now", () => {
  expect(splitPane).toContain('overflowWrap: "anywhere"');
  expect(splitPane).toContain('whiteSpace: "normal"');
  expect(splitPane).toContain('textOverflow: "clip"');
});

test("map header Task, Goal, and Now values do not use single-line ellipsis", () => {
  expect(magicCanvas).toContain('terminalContextValue: {');
  expect(magicCanvas).toContain('textOverflow: "clip"');
  expect(magicCanvas).toContain('WebkitLineClamp: 2');
});

test("map Goal is as legible as the other glanceable rows", () => {
  expect(magicCanvas).toContain('color: "var(--text-primary)"');
  expect(magicCanvas).toContain('fontSize: 16');
  expect(magicCanvas).toContain('borderLeft: "3px solid var(--accent-live)"');
});

test("map opens with the active card fitted inside the visible canvas", () => {
  expect(magicCanvas).toContain("const autoFittedCanvasTargetRef = useRef<string | null>(null);");
  expect(magicCanvas).toContain("autoFittedCanvasTargetRef.current !== null");
  expect(magicCanvas).toContain("containerSize.width - 32");
  expect(magicCanvas).toContain("updateCanvasViewport({");
});

test("map repairs a saved camera that leaves restored terminals off-screen", () => {
  expect(magicCanvas).toContain("const targetIsVisible =");
  expect(magicCanvas).toContain("target.x >= viewLeft");
  expect(magicCanvas).toContain("target.x + target.width <= viewRight");
  expect(magicCanvas).toContain("target.y >= viewTop");
  expect(magicCanvas).toContain("target.y + target.height <= viewBottom");
  expect(magicCanvas).toContain("targetIsVisible");
});

test("shell split Task uses the active task step instead of the broad Goal", () => {
  expect(splitPane).toContain("const shellTaskCandidate = !isAgentPane");
  expect(splitPane).toContain(
    "resolveDistinctHeaderNow(shellHeader?.goalLabel, shellTaskCandidate)",
  );
  expect(splitPane).toContain(": shellTaskLabel,");
  expect(splitPane).not.toContain(": shellHeader?.goalLabel,");
});

test("regular split headers keep the current moment visible beside the path", () => {
  const shellStart = splitPane.indexOf(") : shellStatusSummary ?");
  const shellHeader = splitPane.slice(shellStart);

  expect(shellHeader).toContain('data-testid="split-terminal-summary-now"');
  expect(shellHeader).not.toContain('display: "none"');
  expect(shellHeader).toContain('gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)"');
});

test("shell split headers keep honest Task, Goal, and Now rows when values are sparse", () => {
  expect(splitPane).not.toContain("headerGoalFallback");
  expect(splitPane).toContain("const displayedHeaderContext");
  expect(splitPane).not.toContain("This session is focused on");
  expect(splitPane).toContain('data-testid="split-terminal-summary-now-inline"');
  expect(splitPane).toContain('? 72');
  expect(splitPane).toContain('data-testid="split-terminal-summary-task-row"');
  expect(splitPane).toContain('gridColumn: "3 / 4"');
  expect(splitPane).toContain(
    '"auto auto minmax(150px, 1fr) minmax(0, 1fr) auto"',
  );
  expect(splitPane).toContain("title={`Task: ${shellTaskLabel}`}");
  expect(splitPane).toContain("{shellTaskLabel}");
});

test("map headers never render a missing-goal placeholder", () => {
  expect(magicCanvas).not.toContain("terminalHeaderContextDescription || terminalHeaderFallbackGoal");
  expect(magicCanvas).toContain("const terminalStatusSummaryCandidates = [");
  expect(magicCanvas).toContain('summary.mainTaskSource === "plan-explanation"');
  expect(magicCanvas).toContain("qualityCheckGoalLabel(terminalStatusSummary.mainTask");
  expect(magicCanvas).toContain("terminalStatusGoalFallback");
});

test("renderers prefer the pane workstream summary when the terminal copy is stale", () => {
  expect(splitPane).toContain("[paneTerminal?.statusSummary, tab.workstream?.statusSummary].find(");
  expect(splitPane).toContain("qualityCheckGoalLabel(summary.mainTask");
  expect(magicCanvas).toContain("linkedTerminal ? linkedTerminal.statusSummary : workstream?.statusSummary");
});

test("renderers do not freeze every missing Task on the old TermFleet wording", () => {
  expect(splitPane).not.toContain("Orienting the TermFleet terminal workspace");
  expect(magicCanvas).not.toContain("Orienting the TermFleet terminal workspace");
});

test("settled restored Now text cannot bypass the shared quality gate", () => {
  expect(magicCanvas).toContain("qualityCheckNowLabel(restoredNow).ok &&");
  expect(magicCanvas).not.toContain("|| restoredNowIsSettled");
});

test("map resolver and live-step Now sources share the quality gate", () => {
  expect(magicCanvas).toContain("const acceptableNow = (value?: string | null)");
  expect(magicCanvas).toContain("acceptableNow(linkedTerminal?.nowLine?.text)");
  expect(magicCanvas).toContain("const liveStep = acceptableNow((");
  expect(magicCanvas).toContain("return acceptableNow(terminalHeaderTitle)");
  expect(magicCanvas).toContain("const candidate = acceptableNow(terminalHeaderNow)");
});

test("map Goal rows recheck stored context before rendering it", () => {
  expect(magicCanvas).toContain("qualityCheckGoalLabel(terminalHeader.contextLabel, {");
  expect(magicCanvas).toContain('const canvasGoalFallback = "Goal not captured"');
  expect(magicCanvas).not.toContain("fallbackProjectGoal(");
});

test("snapshot evidence rejects unusable supplied Goals before storing them", () => {
  expect(snapshotProbe).toContain("qualityCheckGoalLabel(qualityInput, {");
  expect(snapshotProbe).toContain(
    "!/^(?:not|no|stop|failed|error|waiting|blocked|idle|still|again)",
  );
  expect(snapshotProbe).toContain('"status-summary"');
  expect(snapshotProbe).not.toContain('"derived-purpose"');
  expect(snapshotProbe).toContain("allowAboutWhatVoice: true");
  expect(snapshotProbe).toContain("allowTrustedAboutWhat: trustedAboutWhat");
  expect(snapshotProbe).toContain("const derivedContext = snapshotGoal(entry)");
  expect(snapshotProbe).not.toContain("fallbackPaneGoal(entry.task)");
  expect(snapshotProbe).not.toContain(
    "entry.context?.trim() || fallbackProjectGoal(entry.workspace ?? \"\", entry.task)",
  );
  expect(snapshotProbe).toContain('contextSource: derivedContext');
  expect(snapshotProbe).toContain(': "missing"');
});

test("the installed snapshot writer never invents a project Goal", () => {
  expect(rustCommands).toContain('"contextSource".to_string()');
  expect(rustCommands).toContain('"missing".to_string()');
  expect(rustCommands).not.toContain("if let Some(goal) = cockpit_goal_fallback");
  expect(rustCommands).not.toContain("Keep this pane focused on {bounded_task}");
  expect(rustCommands).not.toContain('"derived-purpose".to_string()');
  expect(rustCommands).toContain('context.starts_with("Keep this pane focused on ")');
});

test("map Task fallback never consumes the broad Goal", () => {
  expect(magicCanvas).toContain("const terminalHeaderTaskDescription");
  expect(magicCanvas).not.toContain(
    "terminalHeader.contextLabel || terminalHeader.goalLabel || canvasTaskFallback",
  );
});

test("same-group agent cards render pane-owned Task and Now values", () => {
  expect(magicCanvas).toContain("linkedTerminal?.taskLineup ?? workstream?.taskLineup");
  expect(magicCanvas).toContain("title={agentCardTask ?? canvasTaskFallback}");
  expect(magicCanvas).toContain("{agentCardTask ?? canvasTaskFallback}");
  expect(magicCanvas).toContain("title={agentCardNow}");
  expect(magicCanvas).toContain("{agentCardNow}");
  expect(magicCanvas).not.toContain(
    "title={workstream.mission ?? workstream.prompt ?? \"Supervised agent run\"}",
  );
});

test("map Now rows hold a pane value before accepting live poll churn", () => {
  expect(magicCanvas).toContain("const stabilizedTerminalHeaderNowRow = stableHeader(");
  expect(magicCanvas).toContain("const terminalHeaderNowRowStableText");
  expect(magicCanvas).toContain("if (terminalHeaderNowRowStableText) return terminalHeaderNowRowStableText;");
});

test("split Now rows cannot bypass the stability floor with sidecar updates", () => {
  expect(splitPane).toContain("holdPlaceholders: true");
  expect(splitPane).toContain("resolveDistinctHeaderNow(headerTitle, safeStabilizedNow)");
  expect(splitPane).not.toContain("safeSidecarNow ||");
});

test("live cockpit evidence includes groups and fails closed across every pane", () => {
  expect(cockpitSnapshot).toContain("groupId?: string | null");
  expect(cockpitSnapshot).toContain("Array.from(entries.values())");
  expect(liveVerifier).toContain("missing-group-id");
  expect(liveVerifier).toContain("duplicate-goal");
  expect(liveVerifier).toContain("changed-too-soon");
  expect(liveVerifier).toContain("COCKPIT_LIVE_OK");
  expect(liveVerifier).toContain("const failures = []");
  expect(liveVerifier).toContain("allFailures = allFailures.concat(sample.failures)");
  expect(liveVerifier).toContain("[...new Set(allFailures)]");
  expect(liveVerifier).toContain("goal-too-short-for-about-what");
  expect(liveVerifier).toContain("goal-misses-purpose-connection");
  expect(liveVerifier).toContain("goal-incomplete");
  expect(liveVerifier).toContain("goal-lacks-pane-owned-source");
  expect(liveVerifier).toContain("paneOwnedGoalSources");
  expect(liveVerifier).toContain("now-is-review-process");
  expect(liveVerifier).toContain("COCKPIT_LIVE_MATRIX");
  expect(magicCanvas).toContain("const stabilizedTerminalHeaderTask = stableHeader(");
  expect(splitPane).toContain("task: headerTitle,");
});

test("visual evidence is bound to the installed dock process and fails closed", () => {
  expect(cockpitCapture).toContain('run("wmctrl", ["-lp"])');
  expect(cockpitCapture).toContain("/termfleet\\/releases\\/");
  expect(cockpitCapture).toContain("windowPid");
  expect(cockpitCapture).toContain("manifestPath");
  expect(cockpitVisualGate).toContain("COCKPIT_VISUAL_FAIL");
  expect(cockpitVisualGate).toContain("geometry-mismatch");
  expect(cockpitVisualGate).toContain("forbidden-visible-text");
  expect(cockpitVisualGate).toContain("missing-required-visible-text");
  expect(cockpitVisualGate).toContain("stability-window-too-short");
  expect(cockpitVisualGate).toContain("header-text-changed-during-stability-window");
  expect(cockpitVisualGate).toContain("COCKPIT_VISUAL_STABLE_OK");
});

test("live four-pane verifier crops each complete pane and rejects duplicate cards", () => {
  expect(liveHeaderVerifier).toContain("-crop 779x465+41+45");
  expect(liveHeaderVerifier).toContain("-crop 779x465+821+45");
  expect(liveHeaderVerifier).toContain("-crop 779x465+41+511");
  expect(liveHeaderVerifier).toContain("-crop 779x465+821+511");
  expect(liveHeaderVerifier).toContain("PER_PANE_CAPTURES_OK");
  expect(liveHeaderVerifier).toContain("duplicate per-pane captures");
});
