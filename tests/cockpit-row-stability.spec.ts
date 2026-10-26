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

const contextPanel = readFileSync(new URL('../src/components/PaneContextPanel.tsx',import.meta.url),'utf8');
const contextCss = readFileSync(new URL('../src/components/PaneContextPanel.css',import.meta.url),'utf8');
const topicSource = readFileSync(new URL('../src/lib/terminalTopic.ts',import.meta.url),'utf8');

test("map card context rows use one compact visual rhythm", () => {
  const style = magicCanvas.match(
    /terminalStatusTitle:\s*\{[\s\S]*?\n {2}\},/,
  )?.[0];
  expect(style, "terminalStatusTitle style block").toBeTruthy();
  expect(style).toMatch(/padding:\s*"7px 0"/);
  expect(style).toMatch(/background:\s*"transparent"/);
  expect(style).toMatch(/borderTop:\s*"1px solid var\(--border-subtle\)"/);
});

test("map card headline row always renders a label and a value", () => {
  expect(contextPanel).toContain('pane-context-label');
  expect(contextPanel).toContain('{value}');
  expect(contextPanel).toContain("'Goal not yet known'");
  expect(magicCanvas).toContain('<PaneContextPanel');
});

test("map card task line is a FIXED two-line box", () => {
  // Compact Goal/Task/Now band (owner-approved Oct 6 design): fixed two-line value boxes.
  expect(contextCss).toContain('-webkit-line-clamp:2');
  expect(contextCss).toContain('min-height:44px');
  expect(contextCss).toContain('line-height:22px');
});

test("fleet list tasks reserve two readable lines without changing height", () => {
  expect(sidebar).toContain('const sidebarTaskLabel = topic.text');
  expect(sidebar).toContain('title={terminalTopicDetails(topic)}');
  expect(topicSource).toContain('words.slice(0,5)');
  expect(topicSource).not.toContain('terminalVisibleText');
});

test("the card shows the goal on top and the moment under it, always", () => {
  expect(contextPanel.indexOf('`${prefix}-goal`')).toBeLessThan(contextPanel.indexOf('`${prefix}-task-row`'));
  expect(contextPanel.indexOf('`${prefix}-task-row`')).toBeLessThan(contextPanel.indexOf('`${prefix}-now-row`'));
  expect(contextPanel).toContain("hebrew?'עכשיו':'Now'");
});

test("cards do not rename missing values or manufacture a task-shaped Now row", () => {
  expect(magicCanvas).toContain("const terminalHeaderTaskCandidate =");
  // The Task row goes through one shared resolver that keeps it distinct from the Goal
  // (TF-065; behaviour pinned in tests/map-card-task-row.spec.ts).
  expect(magicCanvas).toMatch(
    /resolveMapCardTaskRow\(\{\s*goal: terminalHeader\.goalLabel,\s*lineupTask: terminalHeaderTaskCandidate,/,
  );
  expect(magicCanvas).toContain("const terminalHeaderContextDescription =");
  expect(magicCanvas).toContain("const terminalHeaderContextCandidate =");
  expect(magicCanvas).not.toContain('"No task assigned to this terminal"');
  expect(magicCanvas).not.toContain("`Working on: ${terminalHeaderTaskDescription}`");
});

test("a missing goal keeps honest Task, Goal, and Now rows mounted", () => {
  expect(contextPanel).toContain("'Goal not yet known'");
  for(const row of ['goal','task-row','now-row'])expect(contextPanel).toContain('`${prefix}-'+row+'`');
  expect(magicCanvas).not.toContain('This session is focused on');
});

test("map cards keep the broad Goal separate from the specific Task and Now rows", () => {
  expect(magicCanvas).toMatch(/goal=\{terminalPanelGoal\}[\s\S]{0,120}task=\{stabilizedTerminalHeaderTask\}[\s\S]{0,120}now=\{terminalPanelNow\}/);
  expect(contextPanel).toContain('`${prefix}-goal`');
  expect(contextPanel).toContain('`${prefix}-task-row`');
  expect(contextPanel).toContain('`${prefix}-now-row`');
});

test("map cards explain missing context without collapsing the three rows", () => {
  expect(magicCanvas).toContain("terminalHeader.contextLabel");
  expect(magicCanvas).not.toContain("This session is focused on");
  expect(magicCanvas).toContain('"Now not captured"');
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
  expect(magicCanvas).toContain('const terminalHeaderTaskDescription =');
  expect(magicCanvas).toContain('task={stabilizedTerminalHeaderTask}');
  expect(contextPanel).toContain('`${prefix}-task-row`');
});

test("snapshot writes discard stale panes without dropping current dock evidence", () => {
  const writerStart = rustCommands.indexOf("fn write_cockpit_snapshot(");
  expect(writerStart).toBeGreaterThan(-1);
  const writer = rustCommands.slice(writerStart, rustCommands.indexOf("/// Path of the durable workspace-layout mirror", writerStart));
  expect(writer).toContain("terminals.retain");
  expect(writer).toContain("Working toward:");
  expect(writer).not.toContain("return Ok(());");
});

test("snapshot probe coalesces all rendered-state churn behind its heartbeat", () => {
  expect(snapshotProbe).toContain("const latestEntryRef = useRef(entry);");
  expect(snapshotProbe).toContain("latestEntryRef.current = entry;");
  expect(snapshotProbe).toContain("const currentEntry = latestEntryRef.current;");

  const dependencyStart = snapshotProbe.indexOf("// Key only on rendered identity");
  const dependencyBlock = snapshotProbe.slice(
    dependencyStart,
    snapshotProbe.indexOf("]);", dependencyStart) + 3,
  );
  expect(dependencyStart).toBeGreaterThan(-1);
  expect(dependencyBlock.match(/entry\.\w+/g)).toEqual(["entry.paneId"]);
});

test("split terminal headers show a compact stable Goal line when context exists", () => {
  expect(splitPane).toContain('presentPaneGoal(');
  expect(splitPane).toContain('<PaneContextPanel goal={panelGoal}');
  expect(splitPane).toContain('prefix="split-pane" compact');
  expect(contextPanel).toContain('`${prefix}-goal`');
});

test("split headers never promote a missing-goal placeholder into the Task row", () => {
  expect(splitPane).toContain("shellHeader?.contextLabel");
  expect(splitPane).toContain("Task:");
  expect(splitPane).not.toContain("fallbackProjectGoal(");
  expect(splitPane).toContain('const visibleAgentTaskLabel = agentTaskLabel ?? "Task not captured"');
  expect(splitPane).not.toContain("shellHeader?.currentActivity ?? headerNow");
  expect(splitPane).not.toContain("Project context:");
});

test("every split header Goal row uses the render-time fallback", () => {
  expect(splitPane).toContain('const panelGoal = presentPaneGoal(');
  expect(splitPane).toContain('goal={panelGoal}');
  expect(contextPanel).toContain("goal.text || (hebrew?'המטרה עדיין לא ידועה':'Goal not yet known')");
});

test("agent split headers keep the live work, broad goal, and current moment legible together", () => {
  expect(splitPane).toContain('goal={panelGoal} task={isAgentPane?visibleAgentTaskLabel:shellTaskLabel');
  expect(splitPane).toContain('now={panelNow}');
  expect(splitPane).toContain('fontSize:15');
  expect(contextCss).toContain('font-size:16px');
});

test("agent split Task never falls back to the broad Goal when live work is missing", () => {
  expect(splitPane).toContain("const agentTaskCandidate =");
  expect(splitPane).toContain("agentStatusSummary?.userTask?.trim()");
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
    magicCanvas.indexOf(') : node.type === "terminal" && (!isAgentTerminal'),
  );
  expect(agentBlock).toContain('<PaneContextPanel goal={terminalPanelGoal} task={agentCardTask} now={terminalPanelNow} prefix="canvas-agent-node"');
  expect(contextPanel).toContain('`${prefix}-goal`');
  expect(contextPanel).toContain('`${prefix}-now-row`');
  expect(agentBlock, "the card must not bypass current state with stale summary text").not.toContain("{agentStatusSummary.now}");
  expect(magicCanvas).toContain('attention: terminalHeaderAttentionState');
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
  expect(splitPane).toContain("const safeStabilizedNow =");
  expect(splitPane).toContain("const headerNow =");
  expect(splitPane).toContain('"Now not captured"');
});

test("split header values wrap instead of hiding Task, Goal, and Now", () => {
  expect(contextCss).toContain('overflow-wrap:anywhere');
  expect(contextCss).toContain('flex-wrap:wrap');
  expect(contextPanel).toContain('<details');
  expect(contextPanel).toContain('Show full text');
});

test("map header Task, Goal, and Now values do not use single-line ellipsis", () => {
  expect(magicCanvas).toContain('terminalContextValue: {');
  expect(magicCanvas).toContain('textOverflow: "clip"');
  expect(magicCanvas).toContain('WebkitLineClamp: 2');
});

test("map Goal is as legible as the other glanceable rows", () => {
  expect(magicCanvas).toContain('color: "var(--text-primary)"');
  expect(magicCanvas).toContain("terminalContextValue");
  expect(magicCanvas).toContain('fontSize: 13');
  const thickAccentBorder = ["border", "Left", ": `3px solid"].join("");
  expect(magicCanvas).not.toContain(thickAccentBorder);
  expect(magicCanvas).toContain("labelStatusBlockStyle");
});

test("map opens on the active card at readable zoom so it stays live", () => {
  expect(magicCanvas).toContain("const autoFittedCanvasTargetRef = useRef<string | null>(null);");
  expect(magicCanvas).toContain("autoFittedCanvasTargetRef.current !== null");
  // Below readable zoom the primary terminal is only a static preview.
  expect(magicCanvas).toContain("const zoom = READABLE_TERMINAL_ZOOM;");
  expect(magicCanvas).toContain("Math.max(16, centeredX)");
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
  expect(splitPane).toContain('now={panelNow}');
  expect(splitPane).toContain('agentStatusSummary?.path ?? shellHeaderPath ?? paneCwd');
  expect(contextPanel).toContain('`${prefix}-now-row`');
});

test("shell split headers keep honest Task, Goal, and Now rows when values are sparse", () => {
  expect(splitPane).toContain('{!isPreviewPane ? (');
  expect(splitPane).toContain('shellTaskLabel ?? "Task not yet known"');
  expect(contextPanel).toContain("'Goal not yet known'");
  expect(contextPanel).toContain('`${prefix}-now-row`');
});

test("map headers never render a missing-goal placeholder", () => {
  expect(magicCanvas).not.toContain("terminalHeaderContextDescription || terminalHeaderFallbackGoal");
  expect(magicCanvas).toContain("const terminalStatusSummaryCandidates = [");
  expect(magicCanvas).toContain("terminalStatusGoalSummary?.mainTask");
  expect(magicCanvas).toContain("qualityCheckGoalLabel(");
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
  expect(magicCanvas).toContain('const canvasGoalFallback = ""');
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
  expect(magicCanvas).toContain('const canvasTaskFallback = "Task not captured"');
  expect(magicCanvas).not.toContain("const canvasTaskFallback = fallbackProjectGoal(");
  expect(magicCanvas).not.toContain(
    "terminalHeader.contextLabel || terminalHeader.goalLabel || canvasTaskFallback",
  );
});

test("agent context rows share one readable and bounded label/value rhythm", () => {
  expect(magicCanvas).toContain('prefix="canvas-agent-node"');
  // Design B: Goal → Task → Now side by side, small caps labels above values.
  expect(contextCss).toContain('.pane-context-panel { display:flex; flex-wrap:wrap');
  expect(contextCss).toContain('text-transform:uppercase; letter-spacing:var(--label-caps-tracking)');
  expect(contextCss).toContain('font-size:15px; line-height:22px');
  expect(contextCss).toContain('-webkit-line-clamp:2');
  expect(contextCss).not.toContain('min-height:90px');
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
