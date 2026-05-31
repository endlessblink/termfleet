import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Optional read: returns "" when the file is absent so the verifier can run in
// a standalone checkout (e.g. the parent-monorepo DESIGN.md may not be present).
const readOptional = (path) => (existsSync(path) ? readFileSync(path, "utf8") : "");

const root = process.cwd();
const magicCanvas = readFileSync(join(root, "src/components/MagicCanvas.tsx"), "utf8");
const workbenchSidebar = readFileSync(join(root, "src/components/WorkbenchSidebar.tsx"), "utf8");
const workspaceStore = readFileSync(join(root, "src/stores/workspace.ts"), "utf8");
const usePty = readFileSync(join(root, "src/hooks/usePty.ts"), "utf8");
const useNativeTerminalPane = readFileSync(join(root, "src/hooks/useNativeTerminalPane.ts"), "utf8");
const terminalComponent = readFileSync(join(root, "src/components/Terminal.tsx"), "utf8");
const splitPane = readFileSync(join(root, "src/components/SplitPane.tsx"), "utf8");
const types = readFileSync(join(root, "src/lib/types.ts"), "utf8");
const cargoToml = readFileSync(join(root, "src-tauri/Cargo.toml"), "utf8");
const cargoBuild = readFileSync(join(root, "src-tauri/build.rs"), "utf8");
const ptyBackend = readFileSync(join(root, "src-tauri/src/pty.rs"), "utf8");
const ptyCommands = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
const nativeTerminalBackend = readFileSync(join(root, "src-tauri/src/native_terminal.rs"), "utf8");
const daemonBackend = readFileSync(join(root, "src-tauri/src/daemon.rs"), "utf8");
const daemonBin = readFileSync(join(root, "src-tauri/src/bin/terminal-workspace-daemon.rs"), "utf8");
const tauriLib = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
const tauriMain = readFileSync(join(root, "src-tauri/src/main.rs"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");
const standaloneDaemonSmoke = readFileSync(join(root, "scripts/verify-standalone-daemon-smoke.sh"), "utf8");
const visualEvidenceSmoke = readFileSync(join(root, "scripts/verify-visual-evidence.sh"), "utf8");
const visualQaReview = readFileSync(join(root, "docs/visual-qa-review.md"), "utf8");
const app = readFileSync(join(root, "src/App.tsx"), "utf8");
const design = readOptional(join(root, "../DESIGN.md"));

const checks = [
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
    ok: /const terminalPaneId = linkedTab\?\.activePaneId \?\? node\.id;/.test(magicCanvas),
    message: "Linked map terminals must share the active terminal pane identity.",
  },
  {
    ok: /<TerminalComponent[\s\S]*tabId=\{terminalTabId\}[\s\S]*paneId=\{terminalPaneId\}[\s\S]*attachToPtyId=\{linkedTerminalId \?\? null\}[\s\S]*standalone/.test(magicCanvas),
    message: "Terminal map nodes must render a live TerminalComponent.",
  },
  {
    ok: !/Open full terminal for shell work|Open the full terminal to start|terminalReference|terminalSummary|terminalIcon|terminalMeta|terminalPath/.test(magicCanvas),
    message: "Map terminal nodes must not fall back to compact placeholder cards.",
  },
  {
    ok: /const NODE_MIN_SIZE = \{[\s\S]*terminal: \{ width: 640, height: 360 \}/.test(magicCanvas),
    message: "Map terminal nodes must have enough room for a usable terminal.",
  },
  {
    ok: /const TERMINAL_MAP_NODE_SIZE = \{ width: 640, height: 360 \};/.test(workspaceStore),
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
    ok: /id: `terminal-map-\$\{tab\.id\}`/.test(workbenchSidebar),
    message: "Sessions panel must focus the canonical live terminal map node.",
  },
  {
    ok: /width: 640,[\s\S]*height: 360/.test(workbenchSidebar),
    message: "Show-on-map must create live-terminal-sized nodes.",
  },
  {
    ok: /reconcileCanvasState\(\);/.test(app),
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
      ptyBackend.includes("loser.shutdown();") &&
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
      /UnixStream::connect/.test(daemonBackend) &&
      /STATUS_COMMAND/.test(daemonBackend) &&
      /protocol_version/.test(daemonBackend) &&
      /daemon_socket_path/.test(daemonBackend) &&
      /pub fn daemon_ensure_running\(\) -> DaemonStatus/.test(daemonBackend) &&
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
      /UnixListener::bind/.test(daemonBackend) &&
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
      /commands::daemon_kill_session/.test(tauriLib),
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
      /const DAEMON_INPUT_EVENT = "terminal-workspace-daemon-input";/.test(usePty) &&
      /emit\(DAEMON_INPUT_EVENT, \{ id: ptyIdRef\.current, data, seqIds \}\)/.test(usePty) &&
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
      /HashMap::<String, UnixStream>::new/.test(ptyCommands) &&
      /fn open_daemon_input_stream/.test(ptyCommands) &&
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
      /terminal-workspace-latency-trace-/.test(ptyCommands) &&
      /std::thread::current\(\)\.id\(\)/.test(ptyCommands) &&
      /terminal-workspace-latency-trace-/.test(ptyBackend) &&
      /std::thread::current\(\)\.id\(\)/.test(ptyBackend) &&
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
      /target\/release\/terminal-workspace/.test(standaloneDaemonSmoke) &&
      /App did not auto-launch the daemon/.test(standaloneDaemonSmoke) &&
      /Daemon did not survive app restart/.test(standaloneDaemonSmoke) &&
      /Standalone daemon restart reattach passed/.test(standaloneDaemonSmoke) &&
      /xdotool type --clearmodifiers --delay 0 "\$command"/.test(standaloneDaemonSmoke) &&
      /snapshotSession/.test(standaloneDaemonSmoke) &&
      /Standalone daemon smoke passed/.test(standaloneDaemonSmoke),
    message: "Verification scripts must include a repeatable standalone daemon-backed terminal smoke using direct typed input.",
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
    ok: /export type TerminalRuntimeStatus = "starting" \| "running" \| "reconnected" \| "stale" \| "failed";/.test(types) &&
      /status\?: TerminalRuntimeStatus;/.test(types) &&
      /lastError\?: string;/.test(types),
    message: "Terminal state must record explicit runtime status metadata for recovery UI.",
  },
  {
    ok: /onStatus\?: \(status: TerminalRuntimeStatus/.test(usePty) &&
      /onStatus\?\.\("starting"/.test(usePty) &&
      /onStatus\?\.\("failed"/.test(usePty),
    message: "PTY hook must publish starting/running/reconnected/stale/failed runtime states.",
  },
  {
    ok: /function usePty/.test(usePty) &&
      /const stopBrokenTransport = \(error: unknown, operation: "read" \| "write"\)/.test(usePty) &&
      /transportFailedRef\.current/.test(usePty) &&
      !/\[pty write failed\]|\[pty read failed\]/.test(usePty),
    message: "PTY transport failures must become one runtime status update, never repeated terminal-buffer error lines.",
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
