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
import type { TerminalRuntimeStatus } from "../lib/types";

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
  attachToPtyId?: string | null;
  standalone?: boolean;
  runtimeActive?: boolean;
  onActivate?: () => void;
}

export function TerminalComponent({
  tabId,
  paneId,
  cwd,
  command,
  attachToPtyId,
  standalone = false,
  runtimeActive = true,
  onActivate,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerElement, setContainerElement] = useState<HTMLDivElement | null>(null);
  const [terminal, setTerminal] = useState<XTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const workspaceMode = useWorkspaceStore((s) => s.workspaceUiState.workspaceMode);
  const terminalRendererMode = useWorkspaceStore((s) => s.workspaceUiState.terminalRendererMode);
  const runtimeSessionId = `terminal-${tabId}-${paneId}`;
  // TC-017g: opt-in headless-VT + Canvas2D renderer. Default stays xterm until
  // the live latency + TUI gate is cleared (set VITE_TERMINAL_RENDERER_MODE=canvas2d).
  const canvasMode =
    terminalRendererMode === "canvas2d" &&
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window;
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
          lastStatusAt: Date.now(),
          lastError: updates.error,
        },
      ],
    });
  }, [attachToPtyId, paneId, runtimeSessionId, tabId, terminal?.cols, terminal?.rows]);

  const handleReady = useCallback((ptyId: string, details: { reused: boolean }) => {
    updateTerminalRuntime({
      id: ptyId,
      status: details.reused ? "reconnected" : "running",
      reused: details.reused,
    });

    const store = useWorkspaceStore.getState();
    const linkedNode = store.canvasState.nodes.find((node) => node.terminalTabId === tabId);
    if (linkedNode && linkedNode.terminalPtyId !== ptyId) {
      store.updateCanvasNode(linkedNode.id, { terminalPtyId: ptyId });
    }
    store.setActiveTerminal(ptyId);
  }, [tabId, updateTerminalRuntime]);

  const handleStatus = useCallback((status: TerminalRuntimeStatus, details?: { id?: string; error?: string }) => {
    updateTerminalRuntime({
      id: details?.id,
      status,
      error: details?.error,
      reused: status === "reconnected" ? true : undefined,
    });
  }, [updateTerminalRuntime]);

  const { resize, write } = usePty({
    terminal: !canvasMode && isRuntimeVisible && !nativePane.attached ? terminal : null,
    cwd,
    command,
    attachToPtyId,
    runtimeSessionId,
    onReady: handleReady,
    onStatus: handleStatus,
  });

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
      tabIndex={0}
      onPointerDownCapture={(event) => {
        onActivate?.();
        focusWebTerminal();
        if (standalone) event.stopPropagation();
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
            cwd={cwd}
            command={command}
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
