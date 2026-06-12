import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal as XTerminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useNativeTerminalPane } from "../hooks/useNativeTerminalPane";
import { usePty } from "../hooks/usePty";
import { TerminalCanvas } from "./TerminalCanvas";
import { syncTerminalLatencyTraceEnv, traceTerminalLatency } from "../lib/terminalLatencyTrace";
import { refreshProjectRootFromActiveTerminal, useWorkspaceStore } from "../stores/workspace";
import type { TerminalRuntimeStatus, WorkstreamInput, WorkstreamPhase, WorkstreamReadiness, WorkstreamStatus } from "../lib/types";
import type { GridSnapshot } from "../lib/gridSnapshot";

const LOCALHOST_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(?:[/?#][^\s"'<>]*)?/gi;
const LOCALHOST_HOST_PORT_PATTERN = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})(?:[/?#][^\s"'<>]*)?/gi;
const STRUCTURED_AGENT_SIGNAL_PATTERN = /\[\[TERMFLEET_AGENT_EVENT\s+({[^\]]+})\]\]/g;

function validPreviewPort(port: string) {
  const value = Number(port);
  return Number.isInteger(value) && value >= 80 && value <= 65535;
}

function detectLocalhostPreviewUrl(output: string): string | null {
  const matches = [...output.matchAll(LOCALHOST_URL_PATTERN)];
  const match = matches[matches.length - 1];
  if (match) {
    const raw = match[0].replace("0.0.0.0", "127.0.0.1");
    try {
      const url = new URL(raw);
      return url.toString().replace(/\/$/, "");
    } catch {
      return null;
    }
  }

  const hostPortMatches = [...output.matchAll(LOCALHOST_HOST_PORT_PATTERN)];
  const hostPortMatch = hostPortMatches[hostPortMatches.length - 1];
  if (hostPortMatch && validPreviewPort(hostPortMatch[1])) {
    return `http://127.0.0.1:${hostPortMatch[1]}`;
  }

  return null;
}

function inferWorkstreamStatus(output: string): "waiting" | "failed" | "done" | null {
  const text = output.toLowerCase();
  if (/\b(waiting for input|needs input|press enter|continue\?|yes\/no|y\/n)\b/.test(text)) {
    return "waiting";
  }
  if (/\b(failed|error|panic|exception|fatal)\b/.test(text)) {
    return "failed";
  }
  if (/\b(done|completed|complete|successfully|all tests passed)\b/.test(text)) {
    return "done";
  }
  return null;
}

function inferProviderReadiness(output: string): {
  readiness: WorkstreamReadiness;
  label: string;
  detail?: string;
  status?: WorkstreamStatus;
  phase?: WorkstreamPhase;
  lastSummary?: string;
  nextAction?: string;
} | null {
  const text = output.toLowerCase();
  const cues = [
    ...[...text.matchAll(/\b(not authenticated|authentication required|log in|login|api key|oauth|sign in)\b/g)].map((match) => ({
      index: match.index ?? 0,
      result: {
        readiness: "auth-required" as const,
        label: "Provider auth required",
        detail: "CLI output indicates login, API key, or sign-in is required.",
        status: "waiting" as const,
        phase: "needs-input" as const,
        lastSummary: "Provider requires authentication",
        nextAction: "Authenticate the CLI, then restart or send a recovery prompt",
      },
    })),
    ...[...text.matchAll(/\b(welcome|ready|session started|authenticated|logged in)\b/g)].map((match) => ({
      index: match.index ?? 0,
      result: {
        readiness: "provider-ready" as const,
        label: "Provider session ready",
        detail: "CLI output indicates provider session readiness.",
        status: "running" as const,
        phase: "active" as const,
        lastSummary: "Provider session is ready",
        nextAction: "Send a task or watch provider response",
      },
    })),
    ...[...text.matchAll(/\b(cancelled|canceled|interrupted|aborted)\b/g)].map((match) => ({
      index: match.index ?? 0,
      result: {
        readiness: "provider-ready" as const,
        label: "Provider interrupted",
        detail: "CLI output indicates the run was interrupted or canceled.",
        status: "stopped" as const,
        phase: "interrupted" as const,
        lastSummary: "Provider acknowledged cancellation",
        nextAction: "Restart or close the workstream",
      },
    })),
  ].sort((a, b) => b.index - a.index);

  return cues[0]?.result ?? null;
}

function phaseForStatus(status: WorkstreamStatus): WorkstreamPhase {
  if (status === "waiting") return "needs-input";
  if (status === "done") return "complete";
  if (status === "failed") return "blocked";
  if (status === "stopped") return "interrupted";
  if (status === "ready") return "queued";
  return "active";
}

function summaryForWorkstreamStatus(status: WorkstreamStatus): { lastSummary: string; nextAction: string } {
  if (status === "waiting") {
    return {
      lastSummary: "Provider is waiting for operator input",
      nextAction: "Send a follow-up prompt",
    };
  }
  if (status === "done") {
    return {
      lastSummary: "Provider reported completion",
      nextAction: "Review output or restart",
    };
  }
  if (status === "failed") {
    return {
      lastSummary: "Provider reported a failure",
      nextAction: "Inspect output and send recovery prompt",
    };
  }
  if (status === "stopped") {
    return {
      lastSummary: "Workstream stopped",
      nextAction: "Restart or close the workstream",
    };
  }
  if (status === "ready") {
    return {
      lastSummary: "Workstream queued",
      nextAction: "Watch provider startup",
    };
  }
  return {
    lastSummary: "Provider is running",
    nextAction: "Watch provider response",
  };
}

interface StructuredAgentSignal {
  status?: WorkstreamStatus;
  phase?: WorkstreamPhase;
  readiness?: WorkstreamReadiness;
  exitCode?: number;
  summary?: string;
  nextAction?: string;
  label?: string;
  detail?: string;
}

function isWorkstreamStatus(value: unknown): value is WorkstreamStatus {
  return value === "ready" ||
    value === "running" ||
    value === "waiting" ||
    value === "failed" ||
    value === "done" ||
    value === "stopped";
}

function isWorkstreamPhase(value: unknown): value is WorkstreamPhase {
  return value === "queued" ||
    value === "launching" ||
    value === "active" ||
    value === "needs-input" ||
    value === "complete" ||
    value === "reviewed" ||
    value === "cancelling" ||
    value === "interrupted" ||
    value === "blocked";
}

function isWorkstreamReadiness(value: unknown): value is WorkstreamReadiness {
  return value === "path-checked" ||
    value === "provider-ready" ||
    value === "auth-required" ||
    value === "unknown";
}

function parseStructuredAgentSignals(output: string) {
  return [...output.matchAll(STRUCTURED_AGENT_SIGNAL_PATTERN)].flatMap((match) => {
    const raw = match[0];
    try {
      const parsed = JSON.parse(match[1]) as Record<string, unknown>;
      const signal: StructuredAgentSignal = {};
      if (isWorkstreamStatus(parsed.status)) signal.status = parsed.status;
      if (isWorkstreamPhase(parsed.phase)) signal.phase = parsed.phase;
      if (isWorkstreamReadiness(parsed.readiness)) signal.readiness = parsed.readiness;
      if (Number.isInteger(parsed.exitCode)) signal.exitCode = parsed.exitCode as number;
      if (typeof parsed.summary === "string") signal.summary = parsed.summary.slice(0, 160);
      if (typeof parsed.nextAction === "string") signal.nextAction = parsed.nextAction.slice(0, 160);
      if (typeof parsed.label === "string") signal.label = parsed.label.slice(0, 80);
      if (typeof parsed.detail === "string") signal.detail = parsed.detail.slice(0, 240);
      return Object.keys(signal).length > 0 ? [{ raw, signal }] : [];
    } catch {
      return [];
    }
  });
}

function resolveCssToken(styles: CSSStyleDeclaration, token: string, fallback: string): string {
  const raw = styles.getPropertyValue(token).trim();
  if (!raw) return fallback;

  const variable = raw.match(/^var\((--[^),\s]+)/)?.[1];
  if (variable) {
    return resolveCssToken(styles, variable, fallback);
  }

  return raw;
}

function terminalThemeFromTokens(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const color = (token: string, fallback: string) => resolveCssToken(styles, token, fallback);

  return {
    background: color("--terminal-bg", "#080c10"),
    foreground: color("--terminal-fg", "#d8dee7"),
    cursor: color("--terminal-cursor", "#d99a45"),
    cursorAccent: color("--terminal-bg", "#080c10"),
    selectionBackground: color("--terminal-selection-bg", "#2a3a50"),
    selectionForeground: color("--terminal-selection-fg", "#f1f5f9"),
    black: color("--terminal-ansi-black", "#0b0e12"),
    red: color("--terminal-ansi-red", "#ef6f72"),
    green: color("--terminal-ansi-green", "#7fc681"),
    yellow: color("--terminal-ansi-yellow", "#d4a44f"),
    blue: color("--terminal-ansi-blue", "#6ea8fe"),
    magenta: color("--terminal-ansi-magenta", "#ad8fcb"),
    cyan: color("--terminal-ansi-cyan", "#7dbac3"),
    white: color("--terminal-ansi-white", "#d8dee7"),
    brightBlack: color("--terminal-ansi-bright-black", "#667383"),
    brightRed: color("--terminal-ansi-bright-red", "#f48b8d"),
    brightGreen: color("--terminal-ansi-bright-green", "#95d996"),
    brightYellow: color("--terminal-ansi-bright-yellow", "#e0b969"),
    brightBlue: color("--terminal-ansi-bright-blue", "#8bb9ff"),
    brightMagenta: color("--terminal-ansi-bright-magenta", "#bea4d8"),
    brightCyan: color("--terminal-ansi-bright-cyan", "#91cbd2"),
    brightWhite: color("--terminal-ansi-bright-white", "#f1f5f9"),
  };
}

interface TerminalProps {
  tabId: string;
  paneId: string;
  cwd?: string;
  command?: string;
  queuedInput?: WorkstreamInput;
  onQueuedInputSent?: (inputId: string) => void;
  attachToPtyId?: string | null;
  standalone?: boolean;
  runtimeActive?: boolean;
  onActivate?: () => void;
  onSnapshot?: (snapshot: GridSnapshot) => void;
  /**
   * Extra backing-store supersample factor for the canvas renderer. Map nodes
   * live under a CSS `scale(zoom)` transform that resamples the canvas bitmap and
   * blurs glyphs; rendering the backing store at a higher resolution gives the
   * compositor more source pixels so text stays crisp when scaled up. 1 = none.
   */
  renderScale?: number;
  /**
   * Render this terminal as a read-only map projection: when the session is in
   * an alternate-screen TUI (zellij/agent prompt) the grid is NOT shrunk to the
   * small node; it stays at its working width and the canvas is CSS-scaled to
   * fit, so a wide alt-screen frame never reflows into garbage. Plain shells
   * still reflow to the node size. Off for split panes. See TerminalCanvas.
  */
  mapProjection?: boolean;
}

export function TerminalComponent({
  tabId,
  paneId,
  cwd,
  command,
  queuedInput,
  onQueuedInputSent,
  attachToPtyId,
  standalone = false,
  runtimeActive = true,
  onActivate,
  onSnapshot,
  renderScale = 1,
  mapProjection = false,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [terminal, setTerminal] = useState<XTerminal | null>(null);
  const [livePtyId, setLivePtyId] = useState<string | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputStatusWindowRef = useRef("");
  const structuredSignalKeysRef = useRef<Set<string>>(new Set());
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const workspaceMode = useWorkspaceStore((s) => s.workspaceUiState.workspaceMode);
  const terminalRendererMode = useWorkspaceStore((s) => s.workspaceUiState.terminalRendererMode);
  const runtimeSessionId = `terminal-${tabId}-${paneId}`;
  // TC-017g: the headless-VT + Canvas2D renderer is now the production desktop
  // terminal — it replaces xterm.js in the Tauri app. xterm.js remains ONLY the
  // browser-preview fallback (no Tauri runtime). `auto` and `canvas2d` both use
  // the canvas renderer on desktop; set VITE_TERMINAL_RENDERER_MODE=web-xterm to
  // force the legacy xterm path on desktop for comparison/escape-hatch.
  const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const canvasMode =
    isTauri && (terminalRendererMode === "canvas2d" || terminalRendererMode === "auto");
  const isRuntimeVisible = standalone
    ? workspaceMode === "canvas" && runtimeActive
    : workspaceMode === "split" && activeTabId === tabId;
  // The native VTE backend draws on a fixed GTK overlay above the WebView; it
  // cannot scale with canvas zoom or clip to the canvas viewport. On the canvas
  // map that produces a floating, mispositioned terminal that overlaps the
  // toolbar and other nodes. Canvas (standalone) nodes therefore use the DOM
  // xterm renderer, which transforms and clips with the canvas. The native pane
  // is reserved for axis-aligned split panes per the native-pane architecture.
  const nativePane = useNativeTerminalPane({
    enabled: isRuntimeVisible && !standalone && !canvasMode,
    rendererMode: terminalRendererMode,
    host: containerElement,
    sessionId: attachToPtyId ?? runtimeSessionId,
    tabId,
    paneId,
    cwd,
    command,
    focused: isRuntimeVisible && !standalone,
  });

  const applyFallbackSize = useCallback((term: XTerminal) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const estimatedCols = Math.max(20, Math.floor(rect.width / 8.2));
    const estimatedRows = Math.max(6, Math.floor(rect.height / 17));
    if (term.cols < estimatedCols * 0.6 && estimatedCols > term.cols) {
      term.resize(estimatedCols, estimatedRows);
    }
  }, []);

  const fitTerminal = useCallback(() => {
    if (!fitAddonRef.current || !terminal) return;
    fitAddonRef.current.fit();
    applyFallbackSize(terminal);
  }, [applyFallbackSize, terminal]);

  const updateTerminalRuntime = useCallback((updates: {
    id?: string;
    status?: TerminalRuntimeStatus;
    reused?: boolean;
    previewUrl?: string;
    error?: string;
  }) => {
    const store = useWorkspaceStore.getState();
    const tab = store.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const previous = tab.terminals.find((t) => t.paneId === paneId);
    const id = updates.id ?? previous?.id ?? attachToPtyId ?? runtimeSessionId;
    store.updateTab(tabId, {
      terminals: [
        ...tab.terminals.filter((t) => t.paneId !== paneId),
        {
          id,
          paneId,
          cols: terminal?.cols ?? previous?.cols ?? 80,
          rows: terminal?.rows ?? previous?.rows ?? 24,
          status: updates.status ?? previous?.status,
          reused: updates.reused ?? previous?.reused,
          previewUrl: updates.previewUrl ?? previous?.previewUrl,
          lastStatusAt: Date.now(),
          lastError: updates.error,
        },
      ],
    });
  }, [attachToPtyId, paneId, runtimeSessionId, tabId, terminal?.cols, terminal?.rows]);

  const updateWorkstreamRuntime = useCallback((updates: {
    status?: WorkstreamStatus;
    phase?: WorkstreamPhase;
    readiness?: WorkstreamReadiness;
    lastSummary?: string;
    nextAction?: string;
    structuredStatus?: boolean;
    exitCode?: number;
    activity?: boolean;
  }) => {
    const store = useWorkspaceStore.getState();
    const tab = store.tabs.find((candidate) => candidate.id === tabId);
    if (!tab?.workstream) return;
    const statusChanged = updates.status && updates.status !== tab.workstream.status;
    const summary = updates.status ? summaryForWorkstreamStatus(updates.status) : null;
    const completed = updates.status === "done" || updates.phase === "complete";
    store.updateTab(tabId, {
      workstream: {
        ...tab.workstream,
        status: updates.status ?? tab.workstream.status,
        readiness: updates.readiness ?? tab.workstream.readiness,
        phase: updates.phase ?? (updates.status ? phaseForStatus(updates.status) : tab.workstream.phase),
        lastSummary: updates.lastSummary ?? summary?.lastSummary ?? tab.workstream.lastSummary,
        nextAction: updates.nextAction ?? summary?.nextAction ?? tab.workstream.nextAction,
        outcome: updates.lastSummary ?? summary?.lastSummary ?? tab.workstream.outcome,
        structuredStatus: updates.structuredStatus ?? tab.workstream.structuredStatus,
        exitCode: updates.exitCode ?? tab.workstream.exitCode,
        completedAt: completed ? tab.workstream.completedAt ?? Date.now() : tab.workstream.completedAt,
        lastActivityAt: updates.activity ? Date.now() : tab.workstream.lastActivityAt,
      },
    });
    if (statusChanged && updates.status) {
      store.recordWorkstreamEvent(tabId, {
        kind: "status",
        label: `Status changed to ${updates.status}`,
        status: updates.status,
      });
    }
  }, [tabId]);

  const handleReady = useCallback((ptyId: string, details: { reused: boolean }) => {
    updateTerminalRuntime({
      id: ptyId,
      status: details.reused ? "reconnected" : "running",
      reused: details.reused,
    });
    setLivePtyId(ptyId);

    const store = useWorkspaceStore.getState();
    const linkedNode = store.canvasState.nodes.find((node) => node.terminalTabId === tabId);
    if (linkedNode && linkedNode.terminalPtyId !== ptyId) {
      store.updateCanvasNode(linkedNode.id, { terminalPtyId: ptyId });
    }
    store.setActiveTerminal(ptyId);
    updateWorkstreamRuntime({ status: "running", activity: true });
  }, [tabId, updateTerminalRuntime, updateWorkstreamRuntime]);

  const handleStatus = useCallback((status: TerminalRuntimeStatus, details?: { id?: string; error?: string }) => {
    updateTerminalRuntime({
      id: details?.id,
      status,
      error: details?.error,
      reused: status === "reconnected" ? true : undefined,
    });
    if (status === "failed") updateWorkstreamRuntime({ status: "failed", activity: true });
  }, [updateTerminalRuntime, updateWorkstreamRuntime]);

  const handleOutput = useCallback((data: string) => {
    outputStatusWindowRef.current = `${outputStatusWindowRef.current}${data}`.slice(-4000);
    const heuristicOutput = outputStatusWindowRef.current.replace(STRUCTURED_AGENT_SIGNAL_PATTERN, "");
    const structuredSignals = parseStructuredAgentSignals(outputStatusWindowRef.current)
      .filter(({ raw }) => {
        if (structuredSignalKeysRef.current.has(raw)) return false;
        structuredSignalKeysRef.current.add(raw);
        return true;
      });
    for (const { signal } of structuredSignals) {
      updateWorkstreamRuntime({
        status: signal.status,
        phase: signal.phase,
        readiness: signal.readiness,
        lastSummary: signal.summary,
        nextAction: signal.nextAction,
        structuredStatus: true,
        exitCode: signal.exitCode,
        activity: true,
      });
      useWorkspaceStore.getState().recordWorkstreamEvent(tabId, {
        kind: "signal",
        label: signal.label ?? "Structured provider signal",
        detail: signal.detail ?? signal.summary,
        status: signal.status,
      });
    }
    if (structuredSignals.length > 0) {
      outputStatusWindowRef.current = "";
      return;
    }
    const providerReadiness = inferProviderReadiness(heuristicOutput);
    updateWorkstreamRuntime({
      status: providerReadiness?.status ?? inferWorkstreamStatus(heuristicOutput) ?? undefined,
      phase: providerReadiness?.phase,
      readiness: providerReadiness?.readiness,
      lastSummary: providerReadiness?.lastSummary,
      nextAction: providerReadiness?.nextAction,
      activity: true,
    });
    if (providerReadiness) {
      const store = useWorkspaceStore.getState();
      const tab = store.tabs.find((candidate) => candidate.id === tabId);
      const alreadyRecorded = tab?.workstream?.events?.some((event) => event.label === providerReadiness.label);
      if (!alreadyRecorded) {
        store.recordWorkstreamEvent(tabId, {
          kind: "provider",
          label: providerReadiness.label,
          detail: providerReadiness.detail,
          status: providerReadiness.status,
        });
      }
    }
    const previewUrl = detectLocalhostPreviewUrl(data);
    if (!previewUrl) return;

    updateTerminalRuntime({ previewUrl });
    const store = useWorkspaceStore.getState();
    const tab = store.tabs.find((candidate) => candidate.id === tabId);
    const previewNode = store.canvasState.nodes.find((node) =>
      node.type === "preview" &&
      node.terminalTabId === tabId &&
      node.linkedTerminalPaneId === paneId
    );
    if (previewNode?.previewPaneId && tab) {
      store.updatePreviewPaneUrl(tab.id, previewNode.previewPaneId, previewUrl);
    }
  }, [paneId, tabId, updateTerminalRuntime, updateWorkstreamRuntime]);

  const { resize, write } = usePty({
    terminal: !canvasMode && isRuntimeVisible && !nativePane.attached ? terminal : null,
    cwd,
    command,
    attachToPtyId,
    runtimeSessionId,
    onReady: handleReady,
    onStatus: handleStatus,
    onOutput: handleOutput,
  });

  useEffect(() => {
    if (canvasMode || !livePtyId || !queuedInput || queuedInput.sentAt) return;
    const text = queuedInput.text.endsWith("\r") ? queuedInput.text : `${queuedInput.text}\r`;
    onQueuedInputSent?.(queuedInput.id);
    write(text);
  }, [canvasMode, livePtyId, onQueuedInputSent, queuedInput?.id, queuedInput?.sentAt, queuedInput?.text, write]);

  // Poll the PTY's live cwd (/proc/<pid>/cwd) so a `cd`/`z` to another path
  // updates the node subtitle + top-bar breadcrumb. Display-only: it never
  // renames the session's project. ~2s cadence; a readlink per visible terminal
  // is cheap. Browser preview has no real PTY, so skip it.
  useEffect(() => {
    if (!isTauri || !livePtyId) return;
    const { refreshLiveCwd } = useWorkspaceStore.getState();
    void refreshLiveCwd(livePtyId);
    const interval = setInterval(() => {
      void useWorkspaceStore.getState().refreshLiveCwd(livePtyId);
    }, 2000);
    return () => clearInterval(interval);
  }, [isTauri, livePtyId]);

  // Create terminal instance — only once per mount
  useEffect(() => {
    if (!containerRef.current) return;
    syncTerminalLatencyTraceEnv().catch(console.error);
    const terminalTheme = terminalThemeFromTokens(containerRef.current);

    const term = new XTerminal({
      cols: 96,
      rows: 24,
      cursorBlink: true,
      cursorStyle: "bar",
      drawBoldTextInBrightColors: true,
      fontSize: 14,
      fontWeight: 400,
      fontWeightBold: 700,
      fontFamily: '"JetBrains Mono", "FiraCode Nerd Font", "MesloLGS NF", "Geist Mono", "Cascadia Code", "Consolas", monospace',
      letterSpacing: 0,
      lineHeight: 1.16,
      minimumContrastRatio: 1,
      scrollback: 3000,
      allowProposedApi: true,
      theme: terminalTheme,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => webglAddon.dispose());
      term.loadAddon(webglAddon);
      traceTerminalLatency("frontend.xterm.webgl.loaded", {
        tabId,
        paneId,
      });
    } catch (error) {
      console.warn("xterm WebGL renderer unavailable; falling back to DOM renderer", error);
      traceTerminalLatency("frontend.xterm.webgl.failed", {
        tabId,
        paneId,
        error: String(error),
      });
    }
    term.open(containerRef.current);

    const renderDisposable = term.onRender((event) => {
      traceTerminalLatency("frontend.xterm.render", {
        tabId,
        paneId,
        start: event.start,
        end: event.end,
      });
    });

    term.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown") {
        traceTerminalLatency("frontend.xterm.keydown", {
          tabId,
          paneId,
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          repeat: event.repeat,
        });
      }
      const key = event.key.toLowerCase();
      const copyShortcut = (event.ctrlKey || event.metaKey) && event.shiftKey && key === "c";
      const pasteShortcut =
        ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "v") ||
        ((event.ctrlKey || event.metaKey) && key === "v");

      if (copyShortcut && event.type === "keydown") {
        const selection = term.getSelection();
        if (selection) {
          navigator.clipboard?.writeText(selection).catch(console.error);
        }
        return false;
      }

      if (pasteShortcut && event.type === "keydown") {
        navigator.clipboard?.readText()
          .then((text) => {
            if (text) write(text);
          })
          .catch(console.error);
        return false;
      }

      return true;
    });

    fitAddonRef.current = fitAddon;
    requestAnimationFrame(() => {
      fitAddon.fit();
      applyFallbackSize(term);
      setTerminal(term);
    });

    return () => {
      renderDisposable.dispose();
      term.dispose();
      setTerminal(null);
    };
  }, [applyFallbackSize, paneId, tabId, write]);

  // Re-fit and refresh when this terminal becomes visible.
  useEffect(() => {
    if (!isRuntimeVisible || !fitAddonRef.current || !terminal) return;

    const refresh = () => {
      fitTerminal();
      resize(terminal.cols, terminal.rows);
      terminal.refresh(0, terminal.rows - 1);
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(refresh);
    });
    const timeout = setTimeout(refresh, 80);

    return () => clearTimeout(timeout);
  }, [isRuntimeVisible, terminal, resize, fitTerminal]);

  // Handle resizing with debounce
  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      if (fitAddonRef.current && terminal) {
        fitTerminal();
        resize(terminal.cols, terminal.rows);
      }
    }, 50);
  }, [terminal, resize, fitTerminal]);

  // ResizeObserver for container
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [handleResize]);

  // Focus terminal when this pane becomes the active pane
  const activePaneId = useWorkspaceStore((s) => {
    const tab = s.tabs.find((t) => t.id === tabId);
    return tab?.activePaneId;
  });

  useEffect(() => {
    if (activePaneId === paneId && activeTabId === tabId && workspaceMode === "split" && terminal && !nativePane.attached) {
      requestAnimationFrame(() => {
        terminal.focus();
      });
    }
  }, [activePaneId, paneId, activeTabId, tabId, terminal, workspaceMode, nativePane.attached]);

  useEffect(() => {
    if (activePaneId !== paneId || activeTabId !== tabId || !isRuntimeVisible) return;

    let refreshing = false;
    const refreshCwd = () => {
      if (refreshing) return;
      refreshing = true;
      refreshProjectRootFromActiveTerminal()
        .catch(console.error)
        .finally(() => {
          refreshing = false;
        });
    };

    refreshCwd();
    const interval = window.setInterval(refreshCwd, 1200);
    return () => window.clearInterval(interval);
  }, [activePaneId, paneId, activeTabId, tabId, isRuntimeVisible]);

  useEffect(() => {
    if (standalone && runtimeActive && terminal && !nativePane.attached) {
      requestAnimationFrame(() => {
        fitTerminal();
        resize(terminal.cols, terminal.rows);
        terminal.focus();
      });
    }
  }, [standalone, runtimeActive, terminal, resize, fitTerminal, nativePane.attached]);

  const focusWebTerminal = useCallback(() => {
    if (!nativePane.attached) {
      terminal?.focus();
    }
  }, [nativePane.attached, terminal]);

  return (
    <div
      className="terminal-block-shell"
      // No tabIndex: the wrapper must NOT be a Tab stop. With tabIndex={0} a
      // Shift+Tab inside the terminal moved focus from the hidden input to this
      // wrapper (off the textarea), so the keystroke never reached the PTY and
      // zellij's back-tab did nothing. Focus is driven by click → focusWebTerminal.
      onPointerDownCapture={() => {
        onActivate?.();
        focusWebTerminal();
        // Do NOT stopPropagation here: this is the capture phase, so stopping the
        // event would prevent it from ever reaching TerminalCanvas's own
        // onPointerDown — which is exactly what begins a drag-select. On the map
        // (standalone) that killed text selection inside the terminal node. Map
        // pan/node-drag are MOUSE events and are already blocked from bubbling by
        // the bubble-phase onMouseDown below, so we don't need to swallow pointer
        // events to keep the canvas from panning.
      }}
      onMouseDown={(event) => {
        onActivate?.();
        focusWebTerminal();
        if (standalone) event.stopPropagation();
      }}
      onClick={() => {
        onActivate?.();
        focusWebTerminal();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onActivate?.();
        focusWebTerminal();

        const selection = terminal?.getSelection();
        if (selection) {
          navigator.clipboard?.writeText(selection).catch(console.error);
          return;
        }

        navigator.clipboard?.readText()
          .then((text) => {
            if (text) write(text);
          })
          .catch(console.error);
      }}
    >
      <div className="terminal-block-rail" aria-hidden="true">
        <span className="terminal-block-marker terminal-block-marker--active" />
        <span className="terminal-block-spine" />
        <span className="terminal-block-marker" />
        <span className="terminal-block-context-dot" />
      </div>
      {canvasMode ? (
        <div className="terminal-container" data-terminal-renderer="canvas2d">
          <TerminalCanvas
            sessionId={attachToPtyId ?? runtimeSessionId}
            tabId={tabId}
            paneId={paneId}
            cwd={cwd}
            command={command}
            renderScale={renderScale}
            mapProjection={mapProjection}
            onReady={handleReady}
            onStatus={handleStatus}
            onOutput={handleOutput}
            onSnapshot={onSnapshot}
            queuedInput={queuedInput}
            onQueuedInputSent={onQueuedInputSent}
          />
        </div>
      ) : (
        <div
          ref={(element) => {
            containerRef.current = element;
            setContainerElement(element);
          }}
          className="terminal-container"
          data-terminal-renderer={nativePane.attached ? "native" : "web-xterm"}
          title={nativePane.unavailableReason ?? undefined}
        />
      )}
    </div>
  );
}
