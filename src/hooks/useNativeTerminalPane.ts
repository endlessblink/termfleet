import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { traceTerminalLatency } from "../lib/terminalLatencyTrace";
import type { TerminalRendererMode } from "../lib/types";

type NativeTerminalBackend = "vteGtk" | "wgpu" | "webXtermFallback";
type NativeTerminalReadinessPhase =
  | "unsupportedPlatform"
  | "runtimeMissing"
  | "developmentHeadersMissing"
  | "backendNotCompiled"
  | "embeddingNotReady"
  | "directPtyNotReady"
  | "ready";

interface NativeTerminalCapabilities {
  platform: string;
  preferredBackend: NativeTerminalBackend;
  readinessPhase: NativeTerminalReadinessPhase;
  available: boolean;
  reason: string;
  supportsEmbedding: boolean;
  supportsDirectPty: boolean;
  runtimeDetected: boolean;
  developmentHeadersDetected: boolean;
  runtimeSymbolsAvailable: boolean;
  backendCompiled: boolean;
  gtkEmbeddingProbeCompiled: boolean;
  embeddingReady: boolean;
  directPtyReady: boolean;
  requiredPackages: string[];
}

interface NativeTerminalBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface UseNativeTerminalPaneOptions {
  enabled: boolean;
  rendererMode: TerminalRendererMode;
  host: HTMLElement | null;
  sessionId: string;
  tabId: string;
  paneId: string;
  cwd?: string;
  command?: string;
  focused: boolean;
}

function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function wantsNativeRenderer(_mode: TerminalRendererMode) {
  // Native VTE overlay is disabled: the GTK-over-WebKitGTK embedding was fragile
  // (sizing, pixman crashes, keyboard focus, and it can't live on the canvas
  // map). All terminals use the xterm.js renderer, which fills its pane, types
  // reliably, and works in both split and map surfaces. The daemon/PTY backend
  // is unchanged. To restore native VTE, revert this file (and native_gtk_pane.rs)
  // from the `native-vte-snapshot` git tag.
  return false;
}

function boundsForElement(element: HTMLElement): NativeTerminalBounds {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

let capabilityPromise: Promise<NativeTerminalCapabilities> | null = null;

function loadCapabilities() {
  capabilityPromise ??= invoke<NativeTerminalCapabilities>("native_terminal_capabilities");
  return capabilityPromise;
}

export function useNativeTerminalPane({
  enabled,
  rendererMode,
  host,
  sessionId,
  tabId,
  paneId,
  cwd,
  command,
  focused,
}: UseNativeTerminalPaneOptions) {
  const [attached, setAttached] = useState(false);
  const [handle, setHandle] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const updateStateRef = useRef({ visible: enabled, focused });

  useEffect(() => {
    updateStateRef.current = { visible: enabled, focused };
  }, [enabled, focused]);

  useEffect(() => {
    if (!enabled || !host || !isTauriRuntime() || !wantsNativeRenderer(rendererMode)) {
      setAttached(false);
      setHandle(null);
      return;
    }

    let cancelled = false;
    let nativeHandle: string | null = null;
    const hostElement = host;
    let pendingFrame: number | null = null;

    const updateNativePane = () => {
      if (cancelled || !nativeHandle) return;
      const bounds = boundsForElement(hostElement);
      invoke("native_terminal_update", {
        request: {
          handle: nativeHandle,
          bounds,
          visible: updateStateRef.current.visible,
          focused: updateStateRef.current.focused,
        },
      }).catch(console.error);
    };

    const scheduleNativePaneUpdate = () => {
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
      }
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        updateNativePane();
      });
    };

    async function attachNativePane() {
      const capabilities = await loadCapabilities().catch((error) => {
        setUnavailableReason(String(error));
        return null;
      });

      if (cancelled || !capabilities) return;
      if (!capabilities.available) {
        setUnavailableReason(capabilities.reason);
        setAttached(false);
        traceTerminalLatency("frontend.native_terminal.unavailable", {
          sessionId,
          tabId,
          paneId,
          rendererMode,
          reason: capabilities.reason,
          platform: capabilities.platform,
          preferredBackend: capabilities.preferredBackend,
          readinessPhase: capabilities.readinessPhase,
          runtimeDetected: capabilities.runtimeDetected,
          developmentHeadersDetected: capabilities.developmentHeadersDetected,
          runtimeSymbolsAvailable: capabilities.runtimeSymbolsAvailable,
          backendCompiled: capabilities.backendCompiled,
          gtkEmbeddingProbeCompiled: capabilities.gtkEmbeddingProbeCompiled,
          embeddingReady: capabilities.embeddingReady,
          directPtyReady: capabilities.directPtyReady,
          requiredPackages: capabilities.requiredPackages,
        });
        return;
      }

      const created = await invoke<{ handle: string }>("native_terminal_create", {
        request: {
          sessionId,
          tabId,
          paneId,
          windowLabel: "main",
          bounds: boundsForElement(hostElement),
          cwd: cwd ?? null,
          command: command ?? null,
        },
      });

      if (cancelled) {
        await invoke("native_terminal_destroy", { handle: created.handle }).catch(console.error);
        return;
      }

      nativeHandle = created.handle;
      setHandle(created.handle);
      setUnavailableReason(null);
      setAttached(true);
      updateNativePane();
      traceTerminalLatency("frontend.native_terminal.attached", {
        sessionId,
        tabId,
        paneId,
        handle: created.handle,
      });
    }

    attachNativePane().catch((error) => {
      setUnavailableReason(String(error));
      setAttached(false);
    });

    const observer = new ResizeObserver(() => {
      scheduleNativePaneUpdate();
    });
    observer.observe(host);
    window.addEventListener("resize", scheduleNativePaneUpdate);
    window.addEventListener("scroll", scheduleNativePaneUpdate, true);
    const reconciliationInterval = window.setInterval(scheduleNativePaneUpdate, 250);

    return () => {
      cancelled = true;
      if (pendingFrame !== null) {
        cancelAnimationFrame(pendingFrame);
      }
      window.removeEventListener("resize", scheduleNativePaneUpdate);
      window.removeEventListener("scroll", scheduleNativePaneUpdate, true);
      window.clearInterval(reconciliationInterval);
      observer.disconnect();
      if (nativeHandle) {
        invoke("native_terminal_destroy", { handle: nativeHandle }).catch(console.error);
      }
      setHandle(null);
      setAttached(false);
    };
  }, [command, cwd, enabled, host, paneId, rendererMode, sessionId, tabId]);

  useEffect(() => {
    if (!attached || !handle || !host) return;
    invoke("native_terminal_update", {
      request: {
        handle,
        bounds: boundsForElement(host),
        visible: enabled,
        focused,
      },
    }).catch(console.error);
  }, [attached, enabled, focused, handle, host]);

  return {
    attached,
    unavailableReason,
  };
}
