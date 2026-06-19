import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Optional read: returns "" when the file is absent so the verifier can run in
// a standalone checkout (e.g. the parent-monorepo DESIGN.md may not be present).
const readOptional = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const root = process.cwd();
const magicCanvas = readFileSync(join(root, "src/components/MagicCanvas.tsx"), "utf8");
const canvasSidebar = readFileSync(join(root, "src/components/CanvasSidebar.tsx"), "utf8");
const workbenchHeader = readFileSync(join(root, "src/components/WorkbenchHeader.tsx"), "utf8");
const workbenchSidebar = readFileSync(join(root, "src/components/WorkbenchSidebar.tsx"), "utf8");
const statusBar = readFileSync(join(root, "src/components/StatusBar.tsx"), "utf8");
const workspaceStore = readFileSync(join(root, "src/stores/workspace.ts"), "utf8");
const usePty = readFileSync(join(root, "src/hooks/usePty.ts"), "utf8");
const daemonInputQueue = readFileSync(join(root, "src/lib/daemonInputQueue.ts"), "utf8");
const useNativeTerminalPane = readFileSync(join(root, "src/hooks/useNativeTerminalPane.ts"), "utf8");
const terminalComponent = readFileSync(join(root, "src/components/Terminal.tsx"), "utf8");
const terminalCanvas = readFileSync(join(root, "src/components/TerminalCanvas.tsx"), "utf8");
const workspaceSurface = readFileSync(join(root, "src/components/WorkspaceSurface.tsx"), "utf8");
const splitPane = readFileSync(join(root, "src/components/SplitPane.tsx"), "utf8");
const types = readFileSync(join(root, "src/lib/types.ts"), "utf8");
const masterPlanTasks = readFileSync(join(root, "src/lib/masterPlanTasks.ts"), "utf8");
const gridBuffer = readFileSync(join(root, "src/lib/gridBuffer.ts"), "utf8");
const gridRenderer = readFileSync(join(root, "src/lib/gridRenderer.ts"), "utf8");
const gridDiff = readFileSync(join(root, "src/lib/gridDiff.ts"), "utf8");
const snapshotPreviewRows = readFileSync(join(root, "src/lib/snapshotPreviewRows.ts"), "utf8");
const gridDiffSpec = readFileSync(join(root, "tests/grid-diff.spec.ts"), "utf8");
const boxGlyphSpec = readFileSync(join(root, "tests/box-glyph.spec.ts"), "utf8");
const mapTerminalRenderingSpec = readFileSync(join(root, "tests/map-terminal-rendering.spec.ts"), "utf8");
const terminalMouse = readFileSync(join(root, "src/lib/terminalMouse.ts"), "utf8");
const mapNodeFilters = readFileSync(join(root, "src/lib/mapNodeFilters.ts"), "utf8");
const localServices = readFileSync(join(root, "src/lib/localServices.ts"), "utf8");
const terminalMouseSpec = readFileSync(join(root, "tests/terminal-mouse.spec.ts"), "utf8");
const legacyPromptRepair = readFileSync(join(root, "src/lib/legacyPromptRepair.ts"), "utf8");
const legacyPromptRepairSpec = readFileSync(join(root, "tests/legacy-prompt-repair.spec.ts"), "utf8");
const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const cargoBuild = readFileSync(join(root, "src-tauri/build.rs"), "utf8");
const ptyBackend = readFileSync(join(root, "src-tauri/src/pty.rs"), "utf8");
const ptyCommands = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
const platformPaths = readFileSync(join(root, "src-tauri/src/platform_paths.rs"), "utf8");
const nativeTerminalBackend = readFileSync(join(root, "src-tauri/src/native_terminal.rs"), "utf8");
const daemonBackend = readFileSync(join(root, "src-tauri/src/daemon.rs"), "utf8");
const daemonIpc = readFileSync(join(root, "src-tauri/src/daemon_ipc.rs"), "utf8");
const vtGrid = readFileSync(join(root, "src-tauri/src/vt_grid.rs"), "utf8");
const daemonBin = readFileSync(join(root, "src-tauri/src/bin/terminal-workspace-daemon.rs"), "utf8");
const tauriLib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const tauriMain = readFileSync(join(root, "src-tauri/src/main.rs"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const readme = readFileSync(join(root, "README.md"), "utf8");
const runDev = readFileSync(join(root, "run-dev.sh"), "utf8");
const runNativeDev = readFileSync(join(root, "run-native-vte-dev.sh"), "utf8");
const canvasTerminalSmoke = readFileSync(join(root, "scripts/verify-canvas-terminal.sh"), "utf8");
const terminalReliabilityGate = readFileSync(join(root, "scripts/verify-terminal-reliability.sh"), "utf8");
const releaseGate = readFileSync(join(root, "scripts/verify-release.sh"), "utf8");
const standaloneDaemonSmoke = readFileSync(join(root, "scripts/verify-standalone-daemon-smoke.sh"), "utf8");
const evidenceBundle = readFileSync(join(root, "scripts/export-evidence-bundle.mjs"), "utf8");
const evidenceBundleSpec = readFileSync(join(root, "scripts/verify-evidence-bundle.mjs"), "utf8");
const canvasLiveSmoke = readFileSync(join(root, "scripts/verify-canvas-live.sh"), "utf8");
const bracketedPasteSmoke = readFileSync(join(root, "scripts/verify-bracketed-paste.sh"), "utf8");
const legacyPromptLiveSmoke = readFileSync(join(root, "scripts/verify-legacy-prompt-repair.sh"), "utf8");
const mapShellAnchorSmoke = readFileSync(join(root, "scripts/verify-map-shell-anchor.sh"), "utf8");
const resizeStormSmoke = readFileSync(join(root, "scripts/verify-resize-storm.sh"), "utf8");
const scrollbackReattachSmoke = readFileSync(join(root, "scripts/verify-scrollback-reattach.sh"), "utf8");
const tauriPerformanceSmoke = readFileSync(join(root, "scripts/verify-tauri-performance.sh"), "utf8");
const zellijMapSmoke = readFileSync(join(root, "scripts/verify-zellij-map.sh"), "utf8");
const zellijShortcutSmoke = readFileSync(join(root, "scripts/verify-zellij-shortcuts.sh"), "utf8");
const visualEvidenceSmoke = readFileSync(join(root, "scripts/verify-visual-evidence.sh"), "utf8");
const visualQaReview = readFileSync(join(root, "docs/visual-qa-review.md"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const design = readOptional(join(root, "../DESIGN.md"));
const switchProjectBody = workspaceStore.match(
  /switchProject: \(groupId: string \| null\) => \{([\s\S]*?)\n  \},\n\n  setProjectRoot:/
)?.[1] ?? "";
const liveHarnesses = [
  canvasLiveSmoke,
  canvasTerminalSmoke,
  bracketedPasteSmoke,
  legacyPromptLiveSmoke,
  mapShellAnchorSmoke,
  resizeStormSmoke,
  standaloneDaemonSmoke,
  scrollbackReattachSmoke,
  tauriPerformanceSmoke,
  zellijMapSmoke,
  zellijShortcutSmoke,
];
const devLaunchers = [runDev, runNativeDev];

const checks = [
  {
    ok: /immersiveTerminal: \{\s*enabled: false,\s*tabId: null,\s*paneId: null,\s*\}/.test(workspaceStore) &&
      /enterImmersiveTerminal: \(tabId: string, paneId: string\) => void;/.test(workspaceStore) &&
      /exitImmersiveTerminal: \(\) => void;/.test(workspaceStore) &&
      /toggleImmersiveTerminal: \(tabId: string, paneId: string\) => void;/.test(workspaceStore) &&
      /data-immersive-terminal=\{immersiveTerminal\.enabled \? "true" : "false"\}/.test(app) &&
      /\{!immersiveTerminal\.enabled && <WorkbenchHeader \/>}/.test(app) &&
      /\{!immersiveTerminal\.enabled && <WorkbenchSidebar \/>}/.test(app) &&
      /\{!immersiveTerminal\.enabled && <StatusBar \/>}/.test(app) &&
      /const effectiveWorkspaceMode = immersiveTerminal\.enabled \? "split" : workspaceMode;/.test(workspaceSurface) &&
      /\{!immersiveTerminal\.enabled && <CanvasSidebar \/>}/.test(workspaceSurface) &&
      /const immersivePaneId =[\s\S]*immersiveTerminal\.enabled && immersiveTerminal\.tabId === tab\.id/.test(splitPane) &&
      /window\.addEventListener\("keydown", onKeyDown, true\);/.test(splitPane) &&
      /event\.key !== "Escape"/.test(splitPane) &&
      /exitImmersiveTerminal\(\);/.test(splitPane) &&
      /const bounds = immersivePaneId\s*\?\s*containerRect\s*:\s*paneBounds\.get\(paneId\);/.test(splitPane) &&
      /\{!isImmersivePane && \(/.test(splitPane) &&
      /\{!immersivePaneId && handles\.map/.test(splitPane),
    message: "Immersive terminal mode must hide app/sidebar/status/pane chrome, render only the targeted pane, and reserve Escape as the exit path.",
  },
  {
    ok: /"verify:terminal-reliability": "scripts\/verify-terminal-reliability\.sh"/.test(packageJson) &&
      /"verify:terminal-reliability:live": "TERMFLEET_TERMINAL_RELIABILITY_LIVE=1 scripts\/verify-terminal-reliability\.sh"/.test(packageJson) &&
      /"verify:daemon-survival":/.test(packageJson) &&
      /TERMFLEET_TERMINAL_RELIABILITY_LIVE/.test(terminalReliabilityGate) &&
      /verify:map-terminals/.test(terminalReliabilityGate) &&
      /verify:canvas-all/.test(terminalReliabilityGate) &&
      /vt_grid::tests/.test(terminalReliabilityGate) &&
      /pty::tests/.test(terminalReliabilityGate) &&
      /verify:daemon-survival/.test(terminalReliabilityGate) &&
      /verify:legacy-prompt-live/.test(terminalReliabilityGate) &&
      /verify:scrollback-reattach/.test(terminalReliabilityGate) &&
      /verify:map-shell-anchor/.test(terminalReliabilityGate) &&
      /verify:zellij-map/.test(terminalReliabilityGate) &&
      /verify:bracketed-paste/.test(terminalReliabilityGate) &&
      /verify:resize-storm/.test(terminalReliabilityGate) &&
      /verify:zellij-shortcuts/.test(terminalReliabilityGate) &&
      /verify:canvas-live/.test(terminalReliabilityGate) &&
      /verify:standalone-daemon/.test(terminalReliabilityGate) &&
      /verify:restart-restore/.test(terminalReliabilityGate) &&
      /TERMFLEET_TERMINAL_RELIABILITY_OK/.test(terminalReliabilityGate),
    message: "A single terminal reliability gate must cover fast invariants and the full live shell/zellij/map/restart matrix.",
  },
  {
    ok: /"verify:release": "scripts\/verify-release\.sh"/.test(packageJson) &&
      /verify:terminal-reliability/.test(releaseGate) &&
      /verify:restart-restore/.test(releaseGate) &&
      /verify:daemon-latency/.test(releaseGate) &&
      /verify:standalone-daemon/.test(releaseGate) &&
      /TERMFLEET_RELEASE_CHECK_OK/.test(releaseGate),
    message: "Release verification must block on terminal process-survival, restart/restore, latency, and standalone daemon smoke gates.",
  },
  {
    ok: /import \{ TerminalComponent \} from "\.\/Terminal";/.test(magicCanvas),
    message: "MagicCanvas must import the real terminal renderer.",
  },
  {
    ok: /const linkedPaneTerminalId = linkedTab\?\.terminals\.find\(\(terminal\) => terminal\.paneId === terminalPaneId\)\?\.id;/.test(magicCanvas) &&
      /const linkedTerminalId = linkedPaneTerminalId \?\? node\.terminalPtyId \?\? linkedTab\?\.terminals\[0\]\?\.id;/.test(magicCanvas),
    message: "Map terminals must attach to the active pane runtime PTY when one exists.",
  },
  {
    ok: /const terminalTabId = linkedTab\?\.id \?\? `canvas-\$\{node\.id\}`;/.test(magicCanvas),
    message: "Standalone map terminals must use a stable browser/runtime session id.",
  },
  {
    ok: /const terminalPaneId =\s*linkedTab\?\.activePaneId \?\? linkedTab\?\.terminals\[0\]\?\.paneId \?\? node\.id;/.test(magicCanvas),
    message: "Linked map terminals must share the active terminal pane identity (node.id only as last resort, never over an existing pane).",
  },
  {
    ok: /<TerminalComponent[\s\S]*tabId=\{terminalTabId\}[\s\S]*paneId=\{terminalPaneId\}[\s\S]*attachToPtyId=\{linkedTerminalId \?\? null\}[\s\S]*standalone/.test(magicCanvas),
    message: "Terminal map nodes must render a live TerminalComponent.",
  },
  {
    ok: /export type MapFilter = "all" \| "active" \| "failed" \| "waiting" \| "testing" \| "preview";/.test(mapNodeFilters) &&
      /export function nodeMatchesMapFilter/.test(mapNodeFilters) &&
      /terminal\?\.status === "failed"/.test(mapNodeFilters) &&
      /workstream\?\.phase === "needs-input"/.test(mapNodeFilters) &&
      /terminal\?\.activityKind/.test(mapNodeFilters) &&
      /terminal\.previewUrl/.test(mapNodeFilters) &&
      /data-testid=\{`map-filter-\$\{filter\.id\}`\}/.test(canvasSidebar) &&
      /nodeMatchesMapFilter\(node, nodeTab\(node\), mapFilter\)/.test(canvasSidebar) &&
      /data-testid=\{`map-filter-\$\{filter\.id\}`\}/.test(workbenchSidebar) &&
      /nodeMatchesMapFilter\(node, nodeTab\(node\), mapFilter\)/.test(workbenchSidebar) &&
      /data-testid="map-node-list"/.test(workbenchSidebar),
    message: "Map sidebar must provide active/failed/waiting/testing/preview filters derived from terminal and workstream state.",
  },
  {
    ok: /function summarizeMapNodes/.test(workbenchSidebar) &&
      /workspaceLabelFor/.test(workbenchSidebar) &&
      /gitBranch/.test(workbenchSidebar) &&
      /previewUrl/.test(workbenchSidebar) &&
      /data-testid="map-workspace-summary"/.test(workbenchSidebar) &&
      /data-testid="map-workspace-group"/.test(workbenchSidebar) &&
      /data-testid="map-workspace-summary-facets"/.test(workbenchSidebar),
    message: "Map panel must explain visible nodes through workspace, branch, role, and service group summaries.",
  },
  {
    ok: /export function summarizeLocalServices/.test(localServices) &&
      /LocalServiceSummary/.test(localServices) &&
      /normalizeLocalUrl/.test(localServices) &&
      /trimServiceLogs/.test(localServices) &&
      /formatLocalServiceBrief/.test(localServices) &&
      /serviceStatus/.test(localServices) &&
      /summarizeLocalServices\(visibleTabs, groupVisibleNodes\)/.test(workbenchSidebar) &&
      /data-testid="map-local-services"/.test(workbenchSidebar) &&
      /data-testid="map-local-service-row"/.test(workbenchSidebar) &&
      /data-testid="map-local-services-toggle"/.test(workbenchSidebar) &&
      /data-testid="map-workspace-summary-toggle"/.test(workbenchSidebar) &&
      /data-testid="map-local-service-action-status"/.test(workbenchSidebar) &&
      /Copy logs for/.test(workbenchSidebar) &&
      /formatLocalServiceBrief\(service\)/.test(workbenchSidebar) &&
      /copyServiceText\(service\.url, "URL"\)/.test(workbenchSidebar) &&
      /openServiceOnMap\(service\)/.test(workbenchSidebar) &&
      /addCanvasNode\(previewNode\)/.test(workbenchSidebar) &&
      /type: "preview"/.test(workbenchSidebar) &&
      /setServiceActionStatus\("Map window opened"\)/.test(workbenchSidebar) &&
      /navigator\.clipboard\.writeText\(text\)/.test(workbenchSidebar) &&
      /terminalOutput: "VITE ready at http:\/\/localhost:5177\\nGET \/ 200"/.test(mapTerminalRenderingSpec) &&
      /__termfleetCopied/.test(mapTerminalRenderingSpec) &&
      /Open http:\/\/localhost:5177 on map/.test(mapTerminalRenderingSpec) &&
      /Map window opened/.test(mapTerminalRenderingSpec) &&
      /service-preview-tab-preview-5177/.test(mapTerminalRenderingSpec) &&
      /localStorage\.getItem\("terminal-workspace\.v1"\)/.test(mapTerminalRenderingSpec) &&
      /page\.reload\(\{ waitUntil: "domcontentloaded" \}\)/.test(mapTerminalRenderingSpec) &&
      /not\.toContainText\("localhost:5177:5177"\)/.test(mapTerminalRenderingSpec) &&
      /map-local-service-row/.test(mapTerminalRenderingSpec) &&
      /map-local-services-toggle/.test(mapTerminalRenderingSpec),
    message: "Map sidebar must summarize local preview services with owner/status plus focus, copy, collapse, persisted restore, and map-window actions.",
  },
  {
    ok: /getDisplaySummary/.test(magicCanvas) &&
      /getDisplaySummary/.test(splitPane) &&
      /terminalDisplaySummary/.test(magicCanvas) &&
      /shellStatusSummary/.test(splitPane),
    message: "Map and split terminal headers must render from the shared display-summary helper.",
  },
  {
    ok: /onMouseDown=\{node\.type === "terminal"[\s\S]*event\.stopPropagation\(\);[\s\S]*activateTerminalNode\(\);/.test(magicCanvas) &&
      /onClick=\{node\.type === "terminal" \? \(event\) => event\.stopPropagation\(\) : undefined\}/.test(magicCanvas),
    message: "Terminal map node bodies must stop canvas/node mouse events so terminal focus and input are not stolen.",
  },
  {
    ok: /"verify:terminal-mouse": "playwright test terminal-mouse"/.test(packageJson) &&
      /encodeMouseReport/.test(terminalCanvas) &&
      /pointerButtonToTerminalButton/.test(terminalCanvas) &&
      /terminalWheelAction\(event, modes/.test(terminalCanvas) &&
      /invoke\("grid_scroll"/.test(terminalCanvas) &&
      /sendPointerMouseReport\(event/.test(terminalCanvas) &&
      /modesRef\.current\.mouseReport/.test(terminalCanvas) &&
      /release \? "m" : "M"/.test(terminalMouse) &&
      /export function shouldSendWheelToTerminalApp/.test(terminalMouse) &&
      /export function terminalWheelAction/.test(terminalMouse) &&
      /pointerButtonToTerminalButton\(0\)/.test(terminalMouseSpec) &&
      /leftReleaseSgr/.test(terminalMouseSpec) &&
      /wheelDownLegacyHex/.test(terminalMouseSpec) &&
      /plainWheelUsesTerminalHistory/.test(terminalMouseSpec) &&
      /plainAltScreenWheelUsesTerminalApp/.test(terminalMouseSpec) &&
      /mouseReportWheelAction/.test(terminalMouseSpec),
    message: "Canvas terminals must route primary-buffer wheel to history, alt-screen wheel to app arrows, and mouse-reporting wheel to VT mouse events.",
  },
  {
    ok: /function TerminalMapPreview/.test(magicCanvas) &&
      /data-terminal-map-preview="state-shape"/.test(magicCanvas) &&
      /const READABLE_TERMINAL_ZOOM = 1;/.test(magicCanvas) &&
      /const showTerminalPreview = node\.type === "terminal" && zoom < READABLE_TERMINAL_ZOOM;/.test(magicCanvas) &&
      // Viewport culling: a terminal node mounts a live renderer only when it is
      // readable-zoom AND in the live set (in viewport / selected, capped). The
      // rest fall back to the truthful preview even at readable zoom. The live
      // set must be computed and threaded to each node.
      /const shouldMountTerminal = node\.type === "terminal" && live && !showTerminalPreview;/.test(magicCanvas) &&
      /const MAX_LIVE_TERMINALS = \d+;/.test(magicCanvas) &&
      /const liveNodeIds = useMemo\(/.test(magicCanvas) &&
      /fn spawn_shared_emitter/.test(vtGrid) &&
      /fn run_shared_emitter/.test(vtGrid) &&
      !/name\(format!\("vt-emit-\{id\}"\)\)/.test(vtGrid) &&
      /live=\{liveNodeIds\.has\(node\.id\)\}/.test(magicCanvas) &&
      /<TerminalMapPreview[\s\S]*preview=\{terminalPreview\}/.test(magicCanvas) &&
      /onSnapshot=\{\(snapshot\) => onTerminalSnapshot\(node\.id, snapshot\)\}/.test(magicCanvas) &&
      /onSnapshot\?: \(snapshot: GridSnapshot\) => void;/.test(terminalCanvas) &&
      /onSnapshotRef\.current\?\.\(snapshot\)/.test(terminalCanvas) &&
      /const char = cell\?\.c && cell\.c !== "\\u0000" \? cell\.c : " ";/.test(snapshotPreviewRows) &&
      /segments: \[\{ text: " "\.repeat\(maxCols\)/.test(snapshotPreviewRows) &&
      /\{segment\.text\}/.test(magicCanvas) &&
      !/background: cell\.color/.test(magicCanvas) &&
      !/live session/.test(magicCanvas) &&
      /<TerminalComponent[\s\S]*mapProjection=\{false\}/.test(magicCanvas) &&
      !/mapSurface/.test(magicCanvas),
    message: "Map terminal nodes must use a truthful character-based preview below 100% zoom and keep readable terminals live.",
  },
  {
    ok: !/sparsePrimaryMapAnchorRows|applySparseMapAnchor|mapSurface|MAP_SHELL_ANCHOR_TOO_HIGH|MAP_SHELL_ANCHOR_OK/.test(terminalCanvas) &&
      !/mapSurface/.test(terminalComponent) &&
      /"verify:map-shell-anchor": "scripts\/verify-map-shell-anchor\.sh"/.test(packageJson) &&
      /MAP_SHELL_PROMPT_TOP_OK/.test(mapShellAnchorSmoke) &&
      /MAP_SHELL_PROMPT_TOO_LOW/.test(mapShellAnchorSmoke) &&
      /VITE_WORKSPACE_MODE=canvas/.test(mapShellAnchorSmoke) &&
      /VITE_WORKSPACE_RESET_STATE=1/.test(mapShellAnchorSmoke),
    message: "Selected map terminals must keep sparse/fresh shell prompts at the real top row, matching normal terminal semantics.",
  },
  {
    ok: /ctx\.fillStyle = theme\.background/.test(terminalCanvas) &&
      /forceSnapshotRefresh/.test(terminalCanvas) &&
      /invoke<string>\("grid_snapshot"/.test(terminalCanvas) &&
      /visibleContentSeen/.test(terminalCanvas) &&
      /failIfStillBlank/.test(terminalCanvas) &&
      /No visible terminal content was received/.test(terminalCanvas) &&
      /terminal-canvas-error/.test(terminalCanvas),
    message: "Canvas terminals must not fail as silent blank panes; they need an initial paint, snapshot retry, blank guard, and visible attach failure state.",
  },
  {
    ok: /const DEFAULT_TERMINAL_MODES = \{/.test(terminalCanvas) &&
      /sessionEpochRef/.test(terminalCanvas) &&
      /sessionEpochRef\.current \+= 1;/.test(terminalCanvas) &&
      /firstFrameRef\.current = false;/.test(terminalCanvas) &&
      /firstFrameWaitersRef\.current = \[\];/.test(terminalCanvas) &&
      /modesRef\.current = \{ \.\.\.DEFAULT_TERMINAL_MODES \};/.test(terminalCanvas) &&
      /selectionRef\.current = null;/.test(terminalCanvas) &&
      /if \(epoch !== sessionEpochRef\.current\) return;/.test(terminalCanvas) &&
      /const syncFocusedTerminal = useCallback/.test(terminalCanvas) &&
      /set_focused_terminal/.test(terminalCanvas) &&
      /useEffect\(\(\) => \{\s*syncFocusedTerminal\(\);\s*\}, \[sessionId, syncFocusedTerminal\]\);/.test(terminalCanvas),
    message: "Canvas terminal remounts/session switches must reset mode, first-frame, selection, paste, and focused-terminal ownership state.",
  },
  {
    ok: /pub fn scroll_to_bottom\(&self, id: &str\) -> Result<\(\), String>/.test(vtGrid) &&
      /pub fn grid_scroll_to_bottom/.test(ptyCommands) &&
      /commands::grid_scroll_to_bottom/.test(tauriLib) &&
      /await invoke\("grid_scroll_to_bottom", \{ id: sessionId \}\);/.test(terminalCanvas) &&
      /invoke\("grid_scroll_to_bottom", \{ id: sessionId \}\)/.test(terminalCanvas) &&
      /const scheduleScrollToBottom = \(\) => \{[\s\S]*scrollToBottomPendingRef\.current[\s\S]*requestAnimationFrame/.test(terminalCanvas) &&
      /const send = \(data: string, seqId = nextTerminalInputSequence\(\), source = "canvas-send"\) => \{\s*scheduleScrollToBottom\(\);/.test(terminalCanvas) &&
      /send\(bytes, seqId, "canvas-capture-keydown"\)/.test(terminalCanvas) &&
      /createDaemonInputQueue/.test(terminalCanvas) &&
      /send\(bytes, seqId, "canvas-keydown"\)/.test(terminalCanvas) &&
      /send\(bytes, seqId, "canvas-capture-keydown"\)/.test(terminalCanvas) &&
      /trace_pty\("grid\.scroll"/.test(ptyCommands) &&
      /trace_pty\("grid\.scroll_to_bottom"/.test(ptyCommands) &&
      /cursor_visible: offset == 0 && mode\.contains\(TermMode::SHOW_CURSOR\)/.test(vtGrid) &&
      /scrolled_history_hides_cursor_until_bottom_reset/.test(vtGrid),
    message: "Canvas input must return scrolled-back grid viewports to live bottom, and scrolled history must not render the live cursor.",
  },
  {
    ok: /export function needsLegacyPromptRepair/.test(legacyPromptRepair) &&
      /"verify:legacy-prompt-repair": "playwright test legacy-prompt-repair"/.test(packageJson) &&
      /"verify:legacy-prompt-live": "scripts\/verify-legacy-prompt-repair\.sh"/.test(packageJson) &&
      /"verify:canvas-all": "playwright test canvas-renderer grid-diff legacy-prompt-repair keymap terminal-mouse grid-resize selection box-glyph map-terminal-rendering"/.test(packageJson) &&
      /snapshot\.altScreen/.test(legacyPromptRepair) &&
      legacyPromptRepair.includes("/@[^:]+:.+[$#]$/") &&
      /currentPrompt\.row !== snapshot\.cursor\.line/.test(legacyPromptRepair) &&
      /betweenIsBlank/.test(legacyPromptRepair) &&
      /needsLegacyPromptRepair\(snapshot\)/.test(terminalCanvas) &&
      /reusedSession &&/.test(terminalCanvas) &&
      /firstFrame &&/.test(terminalCanvas) &&
      terminalCanvas.includes('invoke("daemon_write_session", { id: sessionId, data: "\\x0c" })') &&
      /legacy duplicate prompt detector repairs only stale plain-shell prompt stacks/.test(legacyPromptRepairSpec) &&
      /altScreenNeverRepairs/.test(legacyPromptRepairSpec),
    message: "Reused legacy plain-shell sessions with duplicate prompt stacks must self-repair once, while alternate-screen sessions stay untouched.",
  },
  {
    ok: /LEGACY_PROMPT_REPAIR_OUT/.test(legacyPromptLiveSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(legacyPromptLiveSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(legacyPromptLiveSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(legacyPromptLiveSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(legacyPromptLiveSmoke) &&
      /LEGACY-PROMPT-SEED/.test(legacyPromptLiveSmoke) &&
      /LEGACY-PROMPT-SWITCH-GRAPH/.test(legacyPromptLiveSmoke) &&
      /LEGACY-PROMPT-REATTACH/.test(legacyPromptLiveSmoke) &&
      /legacy@host:\/tmp/.test(legacyPromptLiveSmoke) &&
      /TF_LEGACY_PROMPT_LIVE_OK/.test(legacyPromptLiveSmoke) &&
      /LEGACY_PROMPT_REPAIR_REUSED_PTY/.test(legacyPromptLiveSmoke) &&
      /LEGACY_PROMPT_REPAIR_CTRL_L_SENT/.test(legacyPromptLiveSmoke) &&
      /LEGACY_PROMPT_REPAIR_VISUAL_REPAINT/.test(legacyPromptLiveSmoke) &&
      /LEGACY_PROMPT_REPAIR_OK/.test(legacyPromptLiveSmoke) &&
      /magick compare -metric AE/.test(legacyPromptLiveSmoke),
    message: "Verification scripts must reproduce old reused plain-shell prompt stacks and prove Ctrl-L repair, daemon input, and visual repaint.",
  },
  {
    ok: /"verify:scrollback-reattach": "scripts\/verify-scrollback-reattach\.sh"/.test(packageJson) &&
      /SCROLLBACK_REATTACH_OUT/.test(scrollbackReattachSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(scrollbackReattachSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(scrollbackReattachSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(scrollbackReattachSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(scrollbackReattachSmoke) &&
      /SCROLL-REATTACH-SCROLL-UP/.test(scrollbackReattachSmoke) &&
      /SCROLL-REATTACH-SWITCH-MAP/.test(scrollbackReattachSmoke) &&
      /SCROLL-REATTACH-SWITCH-SPLIT/.test(scrollbackReattachSmoke) &&
      /SCROLL-REATTACH-LIVE-INPUT/.test(scrollbackReattachSmoke) &&
      /SCROLLBACK_RESET_TO_BOTTOM_BEFORE_INPUT/.test(scrollbackReattachSmoke) &&
      /SCROLLBACK_REATTACH_SESSION_CHANGED/.test(scrollbackReattachSmoke) &&
      /SCROLLBACK_REATTACH_VISUAL_REPAINT/.test(scrollbackReattachSmoke) &&
      /magick compare -metric AE/.test(scrollbackReattachSmoke),
    message: "Verification scripts must reproduce regular-shell scrollback reattach and prove bottom reset, daemon input, and visual repaint.",
  },
  {
    ok: /const FOCUS_TERMINAL_ZOOM = 1;/.test(magicCanvas) &&
      /const MAP_TERMINAL_RENDER_SCALE = 2;/.test(magicCanvas) &&
      /renderScale=\{MAP_TERMINAL_RENDER_SCALE\}/.test(magicCanvas) &&
      !/terminalRenderScaleForZoom/.test(magicCanvas) &&
      !/activeTerminalContent/.test(magicCanvas) &&
      /imageRendering: "auto"/.test(terminalCanvas) &&
      /willChange: "transform"/.test(magicCanvas) &&
      /function snapTerminalPixel/.test(magicCanvas) &&
      /snapTerminalPixel\(nextX, node\.type, nextZoom\)/.test(magicCanvas) &&
      /snapTerminalPixel\(nextY, node\.type, nextZoom\)/.test(magicCanvas) &&
      /const zoom = node\.type === "terminal" \? 1 : canvasState\.viewport\.zoom;/.test(canvasSidebar) &&
      /Math\.round\(nextX\)/.test(canvasSidebar) &&
      /const zoom = 1;/.test(workbenchHeader) &&
      /Math\.round\(nextX\)/.test(workbenchHeader) &&
      /const zoom = 1;/.test(workbenchSidebar) &&
      /const zoom = node\.type === "terminal" \? 1 : canvasState\.viewport\.zoom;/.test(workbenchSidebar) &&
      /Math\.round\(nextX\)/.test(workbenchSidebar),
    message: "Focused map terminals must preserve map geometry and use fixed backing-store supersampling, not zoom-derived renderer props or inverse CSS scaling that crop/churn live TUIs.",
  },
  {
    ok: existsSync(join(root, "src/lib/powerlineGlyph.ts")) &&
      /import \{ drawPowerlineGlyph, isPowerlineGlyph \} from "\.\/powerlineGlyph";/.test(gridRenderer) &&
      /isPowerlineGlyph\(cp\) && drawPowerlineGlyph\(ctx, cp, x, y, cellW, cellH, fg\)/.test(gridRenderer) &&
      /isPowerlineGlyph\(0xe0b0\)/.test(boxGlyphSpec) &&
      /powerRight/.test(boxGlyphSpec) &&
      /powerLeft/.test(boxGlyphSpec),
    message: "Powerline separator glyphs used by zellij/tmux themes must render geometrically instead of falling back to missing-character boxes.",
  },
  {
    ok: /const NODE_MIN_SIZE = \{[\s\S]*terminal: \{ width: 820, height: 460 \}/.test(magicCanvas),
    message: "Map terminal nodes must have enough room for a usable terminal.",
  },
  {
    ok: /const TERMINAL_MAP_NODE_SIZE = \{ width: 820, height: 460 \};/.test(workspaceStore),
    message: "Store terminal map node size must support live terminals.",
  },
  {
    ok: /function terminalNodeForTab/.test(workspaceStore) && /missingTerminalNodes/.test(workspaceStore),
    message: "Workspace restore must reconcile one terminal map node per terminal tab.",
  },
  {
    ok: !/node\.id\.startsWith\("terminal-map-"\)/.test(workspaceStore),
    message: "Persisted terminal-map nodes must not be filtered out.",
  },
  {
    ok: /canvasState: normalizeCanvasState\(state\.canvasState, state\.tabs\)/.test(workspaceStore),
    message: "Switching to the map must reconcile terminal nodes before rendering.",
  },
  {
    ok: /projectRoot: nextRoot/.test(switchProjectBody) &&
      !/canvasState|viewport|updateCanvasViewport|selectCanvasNode|selectedNodeId|306 -/.test(switchProjectBody),
    message: "Selecting a project must not recenter or zoom the canvas viewport; explicit map-focus actions own that behavior.",
  },
  {
    ok: /"verify:bracketed-paste": "scripts\/verify-bracketed-paste\.sh"/.test(packageJson) &&
      /BRACKETED_PASTE_OUT/.test(bracketedPasteSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(bracketedPasteSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(bracketedPasteSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(bracketedPasteSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(bracketedPasteSmoke) &&
      /xclip -selection clipboard/.test(bracketedPasteSmoke) &&
      /BRACKETED-PASTE-VIM/.test(bracketedPasteSmoke) &&
      /BRACKETED-PASTE-DISABLED/.test(bracketedPasteSmoke) &&
      /BRACKETED_PASTE_MARKERS_IN_VIM/.test(bracketedPasteSmoke) &&
      /BRACKETED_PASTE_NO_STALE_MARKERS_AFTER_DISABLE/.test(bracketedPasteSmoke) &&
      /BRACKETED_PASTE_OK/.test(bracketedPasteSmoke),
    message: "Verification scripts must prove real clipboard paste follows current bracketed-paste mode and does not leak stale TUI mode.",
  },
  {
    ok: /"verify:resize-storm": "scripts\/verify-resize-storm\.sh"/.test(packageJson) &&
      /RESIZE_STORM_OUT/.test(resizeStormSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(resizeStormSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(resizeStormSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(resizeStormSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(resizeStormSmoke) &&
      /zellij -s tf-resize-storm/.test(resizeStormSmoke) &&
      /RESIZE-STORM-BEGIN/.test(resizeStormSmoke) &&
      /RESIZE-STORM-END/.test(resizeStormSmoke) &&
      /RESIZE-STORM-INPUT/.test(resizeStormSmoke) &&
      /RESIZE_STORM_MULTIPLE_SIZES/.test(resizeStormSmoke) &&
      /RESIZE_STORM_GRID_PTY_MATCH/.test(resizeStormSmoke) &&
      /RESIZE_STORM_INPUT_REACHED_DAEMON/.test(resizeStormSmoke) &&
      /RESIZE_STORM_VISUAL_CONTENT/.test(resizeStormSmoke) &&
      /RESIZE_STORM_VISUAL_REPAINT/.test(resizeStormSmoke) &&
      /RESIZE_STORM_OK/.test(resizeStormSmoke) &&
      /magick compare -metric AE/.test(resizeStormSmoke),
    message: "Verification scripts must stress repeated TUI resizes and prove grid/PTY sync, visual content, repaint, and input after the storm.",
  },
  {
    ok: /pub fn pty_trace_path/.test(platformPaths) &&
      /TERMINAL_WORKSPACE_TRACE_PTY_FILE/.test(platformPaths) &&
      /pty_trace_path_uses_env_override_or_temp_default/.test(platformPaths) &&
      /platform_paths::pty_trace_path\(\)/.test(daemonBackend) &&
      /platform_paths::pty_trace_path\(\)/.test(ptyBackend) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(zellijMapSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(zellijShortcutSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(zellijMapSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(zellijMapSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(zellijShortcutSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(zellijShortcutSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(canvasLiveSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(canvasLiveSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(bracketedPasteSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(bracketedPasteSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(resizeStormSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(resizeStormSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(canvasLiveSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(bracketedPasteSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(resizeStormSmoke) &&
      /TRACE_FILE="\$OUT_DIR\/pty-trace\.log"/.test(scrollbackReattachSmoke) &&
      /CANVAS-LIVE-SHELL-INPUT/.test(canvasLiveSmoke) &&
      /TF_CANVAS_LIVE_INPUT_OK/.test(canvasLiveSmoke) &&
      /CANVAS_LIVE_INPUT_REACHED_DAEMON/.test(canvasLiveSmoke) &&
      /CANVAS_LIVE_OUTPUT_IN_SNAPSHOT/.test(canvasLiveSmoke) &&
      /06a-htop-wheel-down\.png/.test(canvasLiveSmoke) &&
      /CANVAS_LIVE_VISUAL_REPAINT/.test(canvasLiveSmoke) &&
      /htop-wheel-down/.test(canvasLiveSmoke) &&
      /TMUX_SOCKET="\$OUT_DIR\/tmux\.sock"/.test(canvasLiveSmoke) &&
      /tmux -S \$TMUX_SOCKET new -s canvas/.test(canvasLiveSmoke) &&
      /tmux -S \$TMUX_SOCKET kill-server/.test(canvasLiveSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(canvasTerminalSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(canvasTerminalSmoke) &&
      /xvfb-run -a/.test(canvasTerminalSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(standaloneDaemonSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(standaloneDaemonSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(scrollbackReattachSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(scrollbackReattachSmoke) &&
      /xvfb-run -a/.test(standaloneDaemonSmoke) &&
      /XDG_RUNTIME_DIR="\$RUN_DIR"/.test(tauriPerformanceSmoke) &&
      /XDG_DATA_HOME="\$DATA_DIR"/.test(tauriPerformanceSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(canvasLiveSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(bracketedPasteSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(resizeStormSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(zellijMapSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(zellijShortcutSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(scrollbackReattachSmoke) &&
      /CARGO_TARGET_DIR="\$OUT_DIR\/target"/.test(standaloneDaemonSmoke) &&
      /APP_BIN="\$CARGO_TARGET_DIR\/release\/terminal-workspace"/.test(standaloneDaemonSmoke),
    message: "Live verifiers must use isolated runtime/data dirs and private PTY trace files, never the user's daemon or global trace.",
  },
  {
    ok: liveHarnesses.every((source) =>
      !/pkill(?:\s+-\S+)*\s+-f\s+["']?terminal-workspace/.test(source) &&
      !/fuser\s+-k\s+1420\/tcp/.test(source) &&
      !/rm\s+-f\s+\/tmp\/terminal-workspace-(?:pty|latency)-trace/.test(source)
    ) &&
      /private_daemon_pid/.test(zellijMapSmoke) &&
      /private_daemon_pid/.test(zellijShortcutSmoke) &&
      /private_daemon_pid/.test(canvasLiveSmoke) &&
      /private_daemon_pid/.test(bracketedPasteSmoke) &&
      /private_daemon_pid/.test(resizeStormSmoke) &&
      /private_daemon_pid/.test(scrollbackReattachSmoke) &&
      /kill "\$daemon_pid"/.test(zellijMapSmoke) &&
      /kill "\$daemon_pid"/.test(zellijShortcutSmoke) &&
      /kill "\$daemon_pid"/.test(canvasLiveSmoke) &&
      /kill "\$daemon_pid"/.test(bracketedPasteSmoke) &&
      /kill "\$daemon_pid"/.test(resizeStormSmoke) &&
      /kill "\$daemon_pid"/.test(scrollbackReattachSmoke) &&
      /setsid timeout/.test(zellijMapSmoke) &&
      /setsid timeout/.test(zellijShortcutSmoke) &&
      /setsid timeout/.test(canvasLiveSmoke) &&
      /setsid timeout/.test(bracketedPasteSmoke) &&
      /setsid timeout/.test(resizeStormSmoke) &&
      /setsid timeout/.test(scrollbackReattachSmoke) &&
      /MAP-PROBE-MAP-INPUT/.test(zellijMapSmoke) &&
      /MAP_INPUT_REACHED_DAEMON/.test(zellijMapSmoke) &&
      /MAP_INPUT_MISSING/.test(zellijMapSmoke) &&
      /MAP-PROBE-ZOOM-CHURN/.test(zellijMapSmoke) &&
      /MAP_ZOOM_VISUAL_ONLY/.test(zellijMapSmoke) &&
      /MAP_ZOOM_CAUSED_TERMINAL_RESIZE/.test(zellijMapSmoke) &&
      /MAP_MOUSE_REPORT_REACHED_DAEMON/.test(zellijMapSmoke) &&
      /MAP_MOUSE_REPORT_MISSING/.test(zellijMapSmoke) &&
      /VERIFY_STATUS=\$\?/.test(zellijMapSmoke) &&
      /assert_terminal_image_signal/.test(zellijMapSmoke) &&
      /760x430\+520\+80/.test(zellijMapSmoke) &&
      /ZELLIJ_MAP_VISUAL_CONTENT/.test(zellijMapSmoke) &&
      /ZELLIJ_MAP_VISUAL_BLANK_OR_FLAT/.test(zellijMapSmoke) &&
      /assert_visual_change/.test(zellijMapSmoke) &&
      /ZELLIJ_MAP_VISUAL_REPAINT/.test(zellijMapSmoke) &&
      /ZELLIJ_MAP_VISUAL_CHANGE_TOO_SMALL/.test(zellijMapSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(zellijMapSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(zellijShortcutSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(canvasLiveSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(bracketedPasteSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(resizeStormSmoke) &&
      /kill -- "-\$APP_RUN_PID"/.test(scrollbackReattachSmoke) &&
      /TERMINAL_WORKSPACE_ALLOW_SHARED_DEV_CLEANUP/.test(tauriPerformanceSmoke) &&
      devLaunchers.every((source) =>
        !/fuser\s+-k\s+1420\/tcp/.test(source) &&
        /port_in_use\(\)/.test(source) &&
        /refusing to kill an unknown owner/.test(source) &&
        /grep -v -- "--terminal-workspace-daemon"/.test(source)
      ),
    message: "Live verifier cleanup must kill only verifier-owned process groups/private daemon PIDs, and unsafe dev cleanup must be opt-in.",
  },
  {
    ok: /id: `terminal-map-\$\{tab\.id\}`/.test(workbenchSidebar),
    message: "Sessions panel must focus the canonical live terminal map node.",
  },
  {
    ok: /width: 820,[\s\S]*height: 460/.test(workbenchSidebar),
    message: "Show-on-map must create live-terminal-sized nodes.",
  },
  {
    ok: /export interface CanvasTaskBinding/.test(types) &&
      /taskBinding\?: CanvasTaskBinding;/.test(types) &&
      /parseMasterPlanTasks/.test(masterPlanTasks) &&
      /masterPlanPath/.test(masterPlanTasks),
    message: "Canvas terminal nodes must support durable MASTER_PLAN task bindings parsed from the project plan.",
  },
  {
    ok: /Bind MASTER_PLAN task/.test(magicCanvas) &&
      /taskStatusColor/.test(magicCanvas) &&
      /node\.taskBinding\.taskId/.test(magicCanvas),
    message: "Map terminal node chrome must expose and render task bindings outside the terminal buffer.",
  },
  {
    ok: /"evidence:bundle": "node scripts\/export-evidence-bundle\.mjs"/.test(packageJson) &&
      /"verify:evidence-bundle": "node scripts\/verify-evidence-bundle\.mjs"/.test(packageJson) &&
      /function redactString/.test(evidenceBundle) &&
      /collectPreviewUrls/.test(evidenceBundle) &&
      /collectTaskBindings/.test(evidenceBundle) &&
      /TermFleet Evidence Bundle/.test(evidenceBundle) &&
      /createEvidenceBundle/.test(evidenceBundle) &&
      /<redacted-token>/.test(evidenceBundleSpec) &&
      /http:\/\/localhost:3000/.test(evidenceBundleSpec),
    message: "Evidence bundle export must capture commands, previews, task bindings, sessions, agents, and redact local paths/tokens.",
  },
  {
    ok: /useMasterPlanTasks/.test(workbenchSidebar) &&
      /taskInlineBadge/.test(workbenchSidebar) &&
      /node\.taskBinding\.taskId/.test(workbenchSidebar),
    message: "Map sidebar rows must mirror bound MASTER_PLAN task badges.",
  },
  {
    ok: /reconcileCanvasState\(\)/.test(app),
    message: "App must reconcile persisted terminal map nodes at startup.",
  },
  {
    ok: design === "" ||
      (/The map is a live workspace/.test(design) && /Map terminal nodes render live TerminalComponent panes/.test(design)),
    message: "DESIGN.md must document live terminal map behavior.",
  },
  {
    ok: !/else if \(ptyIdRef\.current && ownsPtyRef\.current\)[\s\S]*pty_kill/.test(usePty),
    message: "Terminal component unmounts must not kill session PTYs; only explicit close actions should.",
  },
  {
    ok: /const runtimeSessionId = `terminal-\$\{tabId\}-\$\{paneId\}`;/.test(terminalComponent) &&
      /runtimeSessionId,/.test(terminalComponent) &&
      /let id = attachToPtyId \?\? runtimeSessionId \?\? crypto\.randomUUID\(\);/.test(usePty),
    message: "Terminal panes must use stable tab/pane runtime session ids instead of random mount ids.",
  },
  {
    ok: ptyBackend.includes("if self.ptys.lock().unwrap().contains_key(&id)") &&
      ptyBackend.includes("return Ok((id, true));") &&
      ptyBackend.includes("if ptys.contains_key(&id)") &&
      /loser\.shutdown\([\s\S]*duplicate stable session lost creation race/.test(ptyBackend) &&
      ptyBackend.includes("let _ = self.child.kill();"),
    message: "Backend PTY spawn must reuse existing stable session ids, including concurrent attach races.",
  },
  {
    ok: !/if \(cancelled\) \{[\s\S]*pty_kill/.test(usePty),
    message: "Cancelled terminal mounts must detach without killing stable backend sessions.",
  },
  {
    ok: /export function destroyBrowserPtys\(ids: string\[\]\)/.test(usePty) &&
      /destroyBrowserPtys\(ptyIds\);/.test(workspaceStore),
    message: "Explicit close must destroy browser PTY sessions as well as Tauri PTYs.",
  },
  {
    ok: ptyBackend.includes("MAX_SCROLLBACK_BYTES") &&
      ptyBackend.includes("trait PtyEventSink") &&
      ptyBackend.includes("TauriPtyEventSink") &&
      ptyBackend.includes("fn ensure_with_sink") &&
      ptyBackend.includes("struct PtyOutputBuffer") &&
      ptyBackend.includes("append_pty_output(&output_reader, &data)") &&
      ptyBackend.includes("pub fn snapshot(&self, id: &str)") &&
      ptyBackend.includes("pub fn read_since(&self, id: &str, offset: u64)") &&
      ptyBackend.includes("pub subscriber_count: usize") &&
      ptyBackend.includes("pub struct PtyOutputChunk"),
    message: "Tauri PTY ownership must keep bounded backend scrollback and subscriber counts behind a daemon-ready event sink.",
  },
  {
    ok: /pub struct PtyEnsureResult/.test(ptyCommands) &&
      /pub fn pty_ensure/.test(ptyCommands) &&
      /pub fn pty_snapshot/.test(ptyCommands) &&
      /commands::pty_ensure/.test(tauriLib) &&
      /commands::pty_snapshot/.test(tauriLib),
    message: "Tauri commands must expose stable-session ensure and scrollback snapshot APIs.",
  },
  {
    ok: /pub struct DaemonStatus/.test(daemonBackend) &&
      /pub enum DaemonMode/.test(daemonBackend) &&
      /daemon_ipc::connect/.test(daemonBackend) &&
      /pub type LocalStream = std::os::unix::net::UnixStream;/.test(daemonIpc) &&
      /STATUS_COMMAND/.test(daemonBackend) &&
      /protocol_version/.test(daemonBackend) &&
      /daemon_socket_path/.test(daemonBackend) &&
      /pub fn daemon_ensure_running\(\) -> DaemonStatus/.test(daemonBackend) &&
      /fn should_reuse_running_daemon_with_fresh_request/.test(daemonBackend) &&
      /status\.protocol_version == PROTOCOL_VERSION/.test(daemonBackend) &&
      !/status\.build_id == current_build_id\(\)/.test(daemonBackend) &&
      /let status = daemon_ensure_running\(\);[\s\S]*if !status\.reachable/.test(daemonBackend) &&
      /terminal daemon became reachable but request connect still failed/.test(daemonBackend) &&
      /use crate::daemon::\{daemon_ensure_running, daemon_socket_path, DaemonRequest, DaemonResponse\};/.test(vtGrid) &&
      /use crate::daemon_ipc;/.test(vtGrid) &&
      /terminal daemon became reachable but grid stream connect still failed/.test(vtGrid) &&
      /const daemonStatus = await invoke<\{ reachable: boolean; message: string \}>\("daemon_ensure_running"\);/.test(terminalCanvas) &&
      /if \(!daemonStatus\.reachable\) \{[\s\S]*throw new Error\(daemonStatus\.message\);/.test(terminalCanvas) &&
      /spawn_current_binary_as_daemon/.test(daemonBackend) &&
      /DAEMON_ARG/.test(daemonBackend) &&
      /terminal_workspace_lib::daemon::DAEMON_ARG/.test(tauriMain) &&
      /terminal_workspace_lib::daemon::run_daemon_forever/.test(tauriMain) &&
      /pub fn send_daemon_request\(request: DaemonRequest\)/.test(daemonBackend) &&
      /pub fn daemon_status\(\) -> DaemonStatus/.test(ptyCommands) &&
      /pub fn daemon_ensure_running\(\) -> DaemonStatus/.test(ptyCommands) &&
      /commands::daemon_status/.test(tauriLib),
    message: "Tauri startup surface must expose protocol-backed user-local daemon detection and auto-launch before daemon ownership migration.",
  },
  {
    ok: /\[\[bin\]\][\s\S]*name = "terminal-workspace-daemon"/.test(cargoToml) &&
      /default-run = "terminal-workspace"/.test(cargoToml) &&
      /pub fn run_daemon_forever\(\) -> Result<\(\), String>/.test(daemonBackend) &&
      /daemon_ipc::bind/.test(daemonBackend) &&
      /pub type LocalListener = std::os::unix::net::UnixListener;/.test(daemonIpc) &&
      /handle_daemon_client/.test(daemonBackend) &&
      /terminal_workspace_lib::daemon::run_daemon_forever/.test(daemonBin),
    message: "Rust package must include a terminal-workspace-daemon binary that serves the Unix socket status protocol.",
  },
  {
    ok: /pub enum DaemonRequest/.test(daemonBackend) &&
      /EnsureSession/.test(daemonBackend) &&
      /ListSessions/.test(daemonBackend) &&
      /WriteSession/.test(daemonBackend) &&
      /ResizeSession/.test(daemonBackend) &&
      /SnapshotSession/.test(daemonBackend) &&
      /ReadSession/.test(daemonBackend) &&
      /GetSessionCwd/.test(daemonBackend) &&
      /KillSession/.test(daemonBackend) &&
      /pty_manager\.ensure_detached/.test(daemonBackend) &&
      /pty_manager\.write/.test(daemonBackend) &&
      /pty_manager\.resize/.test(daemonBackend) &&
      /pty_manager\.snapshot/.test(daemonBackend) &&
      /pty_manager\.read_since/.test(daemonBackend) &&
      /pty_manager\.get_cwd/.test(daemonBackend) &&
      /pty_manager\.kill/.test(daemonBackend) &&
      /pty_manager\.list_sessions\(\)/.test(daemonBackend) &&
      /pub fn ensure_detached/.test(ptyBackend) &&
      /pub fn list_sessions/.test(ptyBackend) &&
      /next_offset/.test(ptyBackend),
    message: "Daemon protocol must own the session control plane, not only status.",
  },
  {
    ok: /fn detached_spawn_records_requested_winsize/.test(ptyBackend) &&
      /fn resize_storm_tracks_final_winsize_and_reuse_does_not_shrink/.test(ptyBackend) &&
      /manager\.session_size\(&id\),\s*Some\(\(132,\s*42\)\)/.test(ptyBackend) &&
      /Some\(\(157,\s*52\)\)/.test(ptyBackend) &&
      /reattach must report the live PTY size/.test(ptyBackend),
    message: "PTY manager tests must lock requested spawn size, resize-storm final winsize, and no-shrink reuse semantics.",
  },
  {
    ok: /function normalizeRow/.test(gridBuffer) &&
      /private reset\(cols: number, rows: number\): void/.test(gridBuffer) &&
      /if \(frame\.full \|\| frame\.cols !== this\.cols \|\| frame\.rows !== this\.rows\)/.test(gridBuffer) &&
      /this\.reset\(frame\.cols, frame\.rows\)/.test(gridBuffer) &&
      /normalizeRow\(row\.cells, this\.cols\)/.test(gridBuffer) &&
      /full sync is authoritative and clears stale same-size buffer state/.test(gridDiffSpec) &&
      /expect\(result\.rowText\[1\]\)\.toBe\("     "\)/.test(gridDiffSpec),
    message: "Frontend grid buffer must treat full sync as authoritative and clear stale same-size rows before rendering.",
  },
  {
    ok: /function requireAvailable/.test(gridDiff) &&
      /unknown message type/.test(gridDiff) &&
      /invalid dimensions/.test(gridDiff) &&
      /cursor \$\{cursorCol\},\$\{cursorLine\} outside/.test(gridDiff) &&
      /dirty row \$\{index\} outside/.test(gridDiff) &&
      /has \$\{cellCount\} cells for/.test(gridDiff) &&
      /invalid codepoint/.test(gridDiff) &&
      /trailing bytes after frame payload/.test(gridDiff) &&
      /Terminal grid diff failed/.test(terminalCanvas) &&
      /onStatusRef\.current\?\.\("failed", \{ error: message \}\)/.test(terminalCanvas) &&
      /malformed binary frames fail explicitly before mutating the grid buffer/.test(gridDiffSpec) &&
      /expect\(result\.text\)\.toEqual\(\["safe", "    "\]\)/.test(gridDiffSpec),
    message: "Malformed binary grid frames must fail explicitly, preserve the current buffer, and surface a visible terminal failure state.",
  },
  {
    ok: /pub fn daemon_ensure_session/.test(ptyCommands) &&
      /pub fn daemon_write_session/.test(ptyCommands) &&
      /pub fn daemon_resize_session/.test(ptyCommands) &&
      /pub fn daemon_read_session/.test(ptyCommands) &&
      /pub fn daemon_get_session_cwd/.test(ptyCommands) &&
      /pub fn daemon_kill_session/.test(ptyCommands) &&
      /commands::daemon_ensure_session/.test(tauriLib) &&
      /commands::daemon_ensure_running/.test(tauriLib) &&
      /commands::daemon_write_session/.test(tauriLib) &&
      /commands::daemon_resize_session/.test(tauriLib) &&
      /commands::daemon_read_session/.test(tauriLib) &&
      /commands::daemon_get_session_cwd/.test(tauriLib) &&
      /commands::daemon_kill_session/.test(tauriLib) &&
      /commands::daemon_list_sessions/.test(tauriLib) &&
      /commands::daemon_list_session_events/.test(tauriLib),
    message: "Tauri commands must bridge frontend terminal transport to the external daemon control plane.",
  },
  {
    ok: /invoke<PtyEnsureResult>\("pty_ensure"/.test(usePty) &&
      /ensured\.reused/.test(usePty) &&
      /invoke<string>\("pty_snapshot"/.test(usePty),
    message: "Frontend Tauri terminals must replay backend scrollback when a stable session is reused.",
  },
  {
    ok: /const daemonStatus = await invoke<DaemonStatus>\("daemon_ensure_running"\)/.test(usePty) &&
      /transportRef\.current = "daemon";/.test(usePty) &&
      /invoke<PtyEnsureResult>\("daemon_ensure_session"/.test(usePty) &&
      /new Channel<PtyStreamEvent>/.test(usePty) &&
      /invoke\("daemon_subscribe_session"/.test(usePty) &&
      /invoke\("daemon_unsubscribe_session"/.test(usePty) &&
      /daemonOutputChannelRef\.current = outputChannel/.test(usePty) &&
      /daemonSubscriberIdRef/.test(usePty) &&
      /DAEMON_INPUT_EVENT = "terminal-workspace-daemon-input";/.test(daemonInputQueue) &&
      /emit\(DAEMON_INPUT_EVENT, \{ id, data, seqIds \}\)/.test(daemonInputQueue) &&
      /createDaemonInputQueue/.test(usePty) &&
      /source: "xterm-onData"/.test(usePty) &&
      /activeInputListeners/.test(usePty) &&
      /nextTerminalInputSequence/.test(usePty) &&
      /daemon_resize_session/.test(usePty),
    message: "Frontend terminal hook must use daemon-backed ensure/subscribe/unsubscribe/event-input/resize when the daemon is reachable.",
  },
  {
    ok: /pub const DAEMON_INPUT_EVENT: &str = "terminal-workspace-daemon-input";/.test(ptyCommands) &&
      /pub fn start_daemon_input_worker/.test(ptyCommands) &&
      /mpsc::channel::<DaemonInputEvent>/.test(ptyCommands) &&
      /seq_ids: Option<Vec<u64>>/.test(ptyCommands) &&
      /HashMap::<String, LocalStream>::new/.test(ptyCommands) &&
      /fn open_daemon_input_stream/.test(ptyCommands) &&
      /daemon_ipc::connect/.test(ptyCommands) &&
      /DaemonRequest::InputStream/.test(ptyCommands) &&
      /InputStream/.test(daemonBackend) &&
      /handle_daemon_input_stream/.test(daemonBackend) &&
      /pub fn handle_daemon_input_event/.test(ptyCommands) &&
      /commands::start_daemon_input_worker\(\);/.test(tauriLib) &&
      /app\.listen_any\(commands::DAEMON_INPUT_EVENT/.test(tauriLib),
    message: "Tauri runtime must receive daemon terminal input through a one-way event and persistent daemon input stream, not per-key command responses.",
  },
  {
    ok: /TERMINAL_LATENCY_TRACE_EVENT/.test(ptyCommands) &&
      /terminal_latency_trace_enabled/.test(ptyCommands) &&
      /handle_terminal_latency_trace_event/.test(ptyCommands) &&
      /platform_paths::latency_trace_path/.test(ptyCommands) &&
      /std::thread::current\(\)\.id\(\)/.test(ptyCommands) &&
      /platform_paths::latency_trace_path/.test(ptyBackend) &&
      /std::thread::current\(\)\.id\(\)/.test(ptyBackend) &&
      /pub fn latency_trace_path/.test(platformPaths) &&
      /terminal-workspace-latency-trace-\{pid\}-\{thread_id\}\.jsonl/.test(platformPaths) &&
      /latency_trace_path_keeps_linux_temp_file_shape/.test(platformPaths) &&
      /traceTerminalLatency/.test(usePty) &&
      /frontend\.xterm\.write\.callback/.test(usePty) &&
      /frontend\.xterm\.render/.test(terminalComponent) &&
      /summarize-terminal-latency-trace/.test(packageJson),
    message: "Latency tracing must capture frontend, Tauri, daemon, PTY, and xterm render checkpoints with a summary script.",
  },
  {
    ok: /pub struct NativeTerminalCapabilities/.test(nativeTerminalBackend) &&
      /pub fn native_terminal_capabilities/.test(nativeTerminalBackend) &&
      /pub fn native_terminal_create/.test(nativeTerminalBackend) &&
      /pub fn native_terminal_update/.test(nativeTerminalBackend) &&
      /pub fn native_terminal_destroy/.test(nativeTerminalBackend) &&
      /native_terminal::native_terminal_capabilities/.test(tauriLib) &&
      /native_terminal::native_terminal_create/.test(tauriLib) &&
      /native_terminal::native_terminal_update/.test(tauriLib) &&
      /native_terminal::native_terminal_destroy/.test(tauriLib) &&
      /useNativeTerminalPane/.test(terminalComponent) &&
      /native_terminal_capabilities/.test(useNativeTerminalPane) &&
      /terminalRendererMode/.test(types) &&
      /terminalRendererMode/.test(workspaceStore) &&
      /runtime_detected/.test(nativeTerminalBackend) &&
      /development_headers_detected/.test(nativeTerminalBackend) &&
      /runtime_symbols_available/.test(nativeTerminalBackend) &&
      /backend_compiled/.test(nativeTerminalBackend) &&
      /libvte-2\.91-0/.test(nativeTerminalBackend) &&
      // Native VTE/GTK is retired (TC-017): the capability surface stays as an
      // honest "unavailable" probe, but no `native-vte` cargo feature, GTK/WebKit
      // deps, or native-vte verifier scripts may exist anymore.
      /tauri:dev/.test(packageJson) &&
      !/native-vte/.test(packageJson) &&
      !/native-vte/.test(cargoToml) &&
      !/dep:gtk|dep:webkit2gtk/.test(cargoToml) &&
      /crate-type = \["rlib"\]/.test(cargoToml),
    message: "Native terminal capability surface must remain, but the retired native-vte feature/deps/scripts must be fully removed.",
  },
  {
    ok: /"verify:standalone-daemon": "scripts\/verify-standalone-daemon-smoke\.sh"/.test(packageJson) &&
      /npm run tauri -- build --no-bundle/.test(standaloneDaemonSmoke) &&
      /"beforeBuildCommand":"npm run build"/.test(standaloneDaemonSmoke) &&
      /APP_BIN="\$CARGO_TARGET_DIR\/release\/terminal-workspace"/.test(standaloneDaemonSmoke) &&
      /App did not auto-launch the daemon/.test(standaloneDaemonSmoke) &&
      /Daemon did not survive app restart/.test(standaloneDaemonSmoke) &&
      /Standalone daemon restart reattach passed/.test(standaloneDaemonSmoke) &&
      /xdotool type --clearmodifiers --delay 0 "\$command"/.test(standaloneDaemonSmoke) &&
      /snapshotSession/.test(standaloneDaemonSmoke) &&
      /01-before-app-restart\.png/.test(standaloneDaemonSmoke) &&
      /02-after-app-restart\.png/.test(standaloneDaemonSmoke) &&
      /03-after-daemon-restart-before-input\.png/.test(standaloneDaemonSmoke) &&
      /04-after-daemon-restart-input\.png/.test(standaloneDaemonSmoke) &&
      /STANDALONE_COLD_RESTORE_OK_682/.test(standaloneDaemonSmoke) &&
      /wait_for_daemon_down/.test(standaloneDaemonSmoke) &&
      /Standalone daemon cold restore passed/.test(standaloneDaemonSmoke) &&
      /cold restore did not replay prior marker/.test(standaloneDaemonSmoke) &&
      /assert_terminal_image_signal/.test(standaloneDaemonSmoke) &&
      /1050x680\+300\+80/.test(standaloneDaemonSmoke) &&
      /STANDALONE_RESTART_VISUAL_CONTENT/.test(standaloneDaemonSmoke) &&
      /STANDALONE_RESTART_VISUAL_BLANK_OR_FLAT/.test(standaloneDaemonSmoke) &&
      /assert_visual_change/.test(standaloneDaemonSmoke) &&
      /STANDALONE_RESTART_VISUAL_REPAINT/.test(standaloneDaemonSmoke) &&
      /STANDALONE_RESTART_VISUAL_CHANGE_TOO_SMALL/.test(standaloneDaemonSmoke) &&
      /Standalone daemon smoke passed/.test(standaloneDaemonSmoke),
    message: "Verification scripts must include repeatable daemon-backed terminal smoke with direct typed input, visual app restart, and visual cold restore evidence.",
  },
  {
    ok: /"verify:visual": "scripts\/verify-visual-evidence\.sh"/.test(packageJson) &&
      /tc-014-standalone-daemon-terminal-section\.png/.test(visualEvidenceSmoke) &&
      /tc-015-standalone-map-terminal\.png/.test(visualEvidenceSmoke) &&
      /Visual QA Review/.test(visualQaReview) &&
      /Remaining Visual Debt/.test(visualQaReview),
    message: "Verification scripts must include durable browser and standalone visual QA evidence.",
  },
  {
    ok: /"verify:readme-recovery": "node scripts\/verify-readme-recovery\.mjs"/.test(packageJson) &&
      /## Restore Workspace Proof/.test(readme) &&
      /npm run verify:restart-restore/.test(readme) &&
      /npm run verify:standalone-daemon/.test(readme) &&
      /restartable stale sessions/.test(readme),
    message: "README must expose a reproducible restore-workspace proof path.",
  },
  {
    ok: /export type TerminalRuntimeStatus = "starting" \| "running" \| "reconnected" \| "stale" \| "failed" \| "exited";/.test(types) &&
      /status\?: TerminalRuntimeStatus;/.test(types) &&
      /lastError\?: string;/.test(types),
    message: "Terminal state must record explicit runtime status metadata for recovery UI.",
  },
  {
    ok: /onStatus\?: \(status: TerminalRuntimeStatus/.test(usePty) &&
      /onStatus\?\.\("starting"/.test(usePty) &&
      /onStatus\?\.\("failed"/.test(usePty),
    message: "PTY hook must publish starting/running/reconnected/stale/failed/exited runtime states.",
  },
  {
    ok: /function usePty/.test(usePty) &&
      /const stopBrokenTransport = \(error: unknown, operation: "read" \| "write"\)/.test(usePty) &&
      /transportFailedRef\.current/.test(usePty) &&
      /isTransientPtyAttachError/.test(usePty) &&
      !/\[pty write failed\]|\[pty read failed\]|\[pty spawn failed\]/.test(usePty),
    message: "PTY transport and spawn failures must become runtime status updates, never terminal-buffer error lines.",
  },
  {
    ok: /function isTransientAttachError/.test(terminalCanvas) &&
      /TRANSIENT_ATTACH_RETRY_DELAYS_MS/.test(terminalCanvas) &&
      /attachWithRetry/.test(terminalCanvas) &&
      /Terminal attach failed:/.test(terminalCanvas) === false,
    message: "Canvas terminal attach must retry transient resource failures and render failures as runtime chrome, not terminal text.",
  },
  {
    ok: /updateTerminalRuntime/.test(terminalComponent) &&
      /status: details\.reused \? "reconnected" : "running"/.test(terminalComponent) &&
      /lastStatusAt: Date\.now\(\)/.test(terminalComponent),
    message: "Terminal component must persist runtime status updates into workspace state.",
  },
  {
    ok: /STATUS_LABELS/.test(splitPane) &&
      /Terminal \$\{terminalStatusLabel\}/.test(splitPane) &&
      /\{terminalStatusLabel\}/.test(splitPane),
    message: "Split pane chrome must expose terminal runtime status without replacing the live terminal.",
  },
  {
    ok: /const recoveryCounts = tabs\.reduce/.test(statusBar) &&
      /statusbar-recovery-summary/.test(statusBar) &&
      /reconnected/.test(statusBar) &&
      /stale/.test(statusBar) &&
      /failed/.test(statusBar) &&
      /exited/.test(statusBar),
    message: "Status bar must summarize durable recovery states across all terminal records.",
  },
  {
    ok: /function persistedTerminalSnapshot\(terminal: TerminalState\): TerminalState/.test(workspaceStore) &&
      /status: "stale"/.test(workspaceStore) &&
      /function withRestartableTerminals\(tab: Tab\): Tab/.test(workspaceStore) &&
      /persisted\.tabs\.map\(withRestartableTerminals\)/.test(workspaceStore),
    message: "Workspace persistence must restore terminal metadata as restartable stale sessions, not erase it.",
  },
  {
    ok: /tabs: state\.tabs\.map\(\(tab\) => \(\{[\s\S]*terminals: tab\.terminals\.map\(persistedTerminalSnapshot\)/.test(workspaceStore),
    message: "Workspace persistence must store bounded terminal metadata instead of dropping all terminal records.",
  },
  {
    ok: /let shouldAttachBrowser = Boolean\(attachToPtyId\);/.test(usePty) &&
      /onStatus\?\.\("stale", \{ id: attachToPtyId \}\);[\s\S]*id = runtimeSessionId;[\s\S]*shouldAttachBrowser = false/.test(usePty),
    message: "Browser preview must restart stale persisted terminal links through the stable runtime session id.",
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.message}`);
  }
  process.exit(1);
}

console.log("Live map terminal source checks passed.");
