// TC-017b/c/d — Canvas2D terminal renderer with input.
//
// Attaches the headless-VT grid, subscribes to the Rust binary dirty-diff
// channel (full sync repaints all; diffs touch only changed rows), and captures
// keystrokes via a hidden textarea (IME-friendly) translated through the keymap
// into VT bytes sent to the daemon PTY. No optimistic echo — the PTY echoes and
// the grid updates via diffs. A plain DOM <canvas>, so it pans/zooms with CSS
// transforms (split-pane and map cases both covered).

import { useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  createDaemonInputQueue,
  nextTerminalInputSequence,
  type DaemonInputQueue,
} from "../lib/daemonInputQueue";
import { GlyphAtlas, measureCell } from "../lib/fontAtlas";
import { GridBuffer } from "../lib/gridBuffer";
import { decodeFrame } from "../lib/gridDiff";
import { needsLegacyPromptRepair } from "../lib/legacyPromptRepair";
import {
  computeGridSize,
  DEFAULT_THEME,
  renderPartial,
  renderSnapshot,
  sizeCanvasToGrid,
  type RenderTheme,
} from "../lib/gridRenderer";
import { encodePaste, keyEventToBytes } from "../lib/keymap";
import {
  encodeMouseReport,
  pointerButtonToTerminalButton,
  shouldSendWheelToTerminalApp,
} from "../lib/terminalMouse";
import {
  normalizeRange,
  pointToCell,
  rowSpan,
  selectionToText,
  type CellPoint,
  type SelectionRange,
} from "../lib/selection";
import { useWorkspaceStore } from "../stores/workspace";
import type { GridSnapshot } from "../lib/gridSnapshot";
import type { WorkstreamInput } from "../lib/types";
import { syncTerminalLatencyTraceEnv, traceTerminalLatency } from "../lib/terminalLatencyTrace";

// Hack is the terminal buffer font (Warp's default terminal font), bundled via
// @font-face. Fallbacks keep things sane before the face loads / on other systems.
const FONT_FAMILY =
  '"Hack", "JetBrains Mono", "Geist Mono", "Cascadia Code", "Consolas", monospace';
const FONT_SIZE_PX = 14;
const LINE_HEIGHT = 1.2;
// Synthetic weight boost is DISABLED. Hack ships only 400/700; a `strokeText`
// halo in the glyph's own colour was tried to fake a medium weight, but measured
// blur testing (e2e/blur-metric) showed it inflates anti-aliased fringe pixels
// ~40% at every devicePixelRatio — that halo is exactly what read as "blurry"
// text on both the fullscreen pane and the map. Crisp 400 is the correct
// trade-off; if the buffer reads too thin, switch to a font with a real medium
// weight rather than re-introducing a stroke.
const FONT_WEIGHT_BOOST_PX = 0;

// Faces the glyph atlas rasterizes (regular/bold × upright/italic). The atlas
// measures cell width and bakes glyph tiles synchronously, so every face must be
// loaded first or the metrics/tiles fall back to a different font and misalign.
const TERMINAL_FONT_FACES = [
  `${FONT_SIZE_PX}px "Hack"`,
  `700 ${FONT_SIZE_PX}px "Hack"`,
  `italic ${FONT_SIZE_PX}px "Hack"`,
  `italic 700 ${FONT_SIZE_PX}px "Hack"`,
];

const DEFAULT_TERMINAL_MODES = {
  appCursor: false,
  bracketedPaste: false,
  altScreen: false,
  mouseReport: false,
  alternateScroll: false,
  sgrMouse: false,
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface TerminalCanvasProps {
  sessionId: string;
  tabId: string;
  paneId: string;
  cwd?: string;
  command?: string;
  cols?: number;
  rows?: number;
  theme?: RenderTheme;
  // Backing-store supersample factor. Map nodes (under the canvas CSS scale()
  // transform) pass 2 so glyphs stay crisp when the compositor scales the bitmap;
  // split panes leave it 1. Constant per mount — see the effect's dpr note.
  renderScale?: number;
  // Read-only map projection. When true and the session is in an alternate-screen
  // TUI, the grid/PTY is NOT shrunk to the node; it stays at its working width and
  // the canvas is CSS-scaled to fit, so a wide alt-screen frame (agent/zellij) is
  // never reflowed into garbage on a small map node. Plain shells still reflow.
  mapProjection?: boolean;
  // Lifecycle reporting so the workspace store can track the canvas-owned PTY.
  // Without these, tab.terminals is never populated for canvas terminals (the
  // production default), so the status bar shows "0 ptys" and store ops that map
  // over tab.terminals (close, cwd-sync) silently no-op.
  onReady?: (ptyId: string, details: { reused: boolean }) => void;
  onStatus?: (status: "starting" | "failed", details?: { error?: string }) => void;
  onOutput?: (data: string) => void;
  onExit?: (details: { id: string; code: number; success: boolean }) => void;
  onSnapshot?: (snapshot: GridSnapshot) => void;
  queuedInput?: WorkstreamInput;
  onQueuedInputSent?: (inputId: string) => void;
}

export function TerminalCanvas({
  sessionId,
  tabId,
  paneId,
  cwd,
  command,
  cols = 80,
  rows = 24,
  theme = DEFAULT_THEME,
  renderScale = 1,
  mapProjection = false,
  onReady,
  onStatus,
  onOutput,
  onExit,
  onSnapshot,
  queuedInput,
  onQueuedInputSent,
}: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const daemonInputQueueRef = useRef<DaemonInputQueue | null>(null);
  const scrollToBottomPendingRef = useRef(false);
  // Stable handle to the current session id for the window-capture key handler,
  // which is registered once and must not close over a stale prop.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const shellRef = useRef<HTMLDivElement>(null);
  // Latest terminal modes, kept current by the diff stream, read by input.
  const modesRef = useRef({ ...DEFAULT_TERMINAL_MODES });
  // Callbacks are read through a ref so the (expensive) attach effect does not
  // re-run when the parent passes new closure identities each render.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  // True once the first diff frame has arrived, so modesRef reflects the real
  // terminal modes (bracketedPaste etc.) rather than the false defaults. Paste is
  // gated on this: pasting before the first frame would wrap with stale modes and
  // a multi-line paste's newlines (normalized to \r) would auto-run instead of
  // landing as bracketed paste. Waiters resolve when the first frame lands.
  const firstFrameRef = useRef(false);
  const firstFrameWaitersRef = useRef<Array<() => void>>([]);
  const sessionEpochRef = useRef(0);
  // Render context shared with pointer/copy handlers (set inside the effect).
  const bufferRef = useRef<GridBuffer | null>(null);
  const cellRef = useRef({ width: 8, height: 16, dpr: 1 });
  const selectionRef = useRef<SelectionRange | null>(null);
  const anchorRef = useRef<CellPoint | null>(null);
  // Gate atlas construction until the bundled Hack faces are loaded so cell
  // metrics and glyph tiles are measured against the real font, not a fallback.
  const [fontsReady, setFontsReady] = useState(
    () => typeof document === "undefined" || !document.fonts
      ? true
      : TERMINAL_FONT_FACES.every((face) => document.fonts.check(face)),
  );
  const [attachError, setAttachError] = useState<string | null>(null);

  useEffect(() => {
    syncTerminalLatencyTraceEnv().catch(console.error);
  }, []);

  useEffect(() => {
    if (fontsReady || typeof document === "undefined" || !document.fonts) return;
    let cancelled = false;
    Promise.all(TERMINAL_FONT_FACES.map((face) => document.fonts.load(face)))
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setFontsReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [fontsReady]);

  const drawSelectionOverlay = () => {
    const overlay = overlayRef.current;
    const buffer = bufferRef.current;
    if (!overlay || !buffer) return;
    const octx = overlay.getContext("2d");
    if (!octx) return;
    octx.clearRect(0, 0, overlay.width, overlay.height);
    const range = selectionRef.current;
    if (!range) return;

    const { width, height, dpr } = cellRef.current;
    const cellW = width * dpr;
    const cellH = height * dpr;
    octx.fillStyle = "rgba(90, 140, 220, 0.35)";
    for (let row = range.start.row; row <= range.end.row; row += 1) {
      const span = rowSpan(range, row, buffer.cols);
      if (!span) continue;
      const x = Math.round(span[0] * cellW);
      const w = Math.ceil((span[1] - span[0] + 1) * cellW);
      octx.fillRect(x, Math.round(row * cellH), w, Math.ceil(cellH));
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isTauriRuntime() || !fontsReady) return;

    let disposed = false;
    sessionEpochRef.current += 1;
    firstFrameRef.current = false;
    firstFrameWaitersRef.current = [];
    modesRef.current = { ...DEFAULT_TERMINAL_MODES };
    selectionRef.current = null;
    anchorRef.current = null;
    setAttachError(null);
    // Fold the supersample factor into the device pixel ratio used for the backing
    // store and glyph atlas. The CSS box stays at logical size (sizeCanvasToGrid
    // sets style.width from cellWidth, not dpr), so a 2x renderScale just packs 2x
    // more device pixels behind the same on-screen size — crisp under CSS scale().
    // renderScale is constant per mount, so it's safe in this effect's deps.
    const dpr = (window.devicePixelRatio || 1) * Math.max(1, renderScale);
    const metrics = measureCell(FONT_FAMILY, FONT_SIZE_PX, dpr, LINE_HEIGHT, FONT_WEIGHT_BOOST_PX);
    const atlas = new GlyphAtlas(metrics);
    const buffer = new GridBuffer();
    bufferRef.current = buffer;
    cellRef.current = { width: metrics.cellWidth, height: metrics.cellHeight, dpr };
    let ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let visibleContentSeen = false;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let blankGuardTimer: ReturnType<typeof setTimeout> | null = null;
    let exitPollTimer: ReturnType<typeof setInterval> | null = null;
    let exitReported = false;
    let reusedSession = false;
    let legacyPromptRepairSent = false;
    let renderScheduled = false;
    let pendingFullRender = false;
    const pendingRenderRows = new Set<number>();

    const syncOverlaySize = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      if (overlay.width !== canvas.width) overlay.width = canvas.width;
      if (overlay.height !== canvas.height) overlay.height = canvas.height;
      overlay.style.width = canvas.style.width;
      overlay.style.height = canvas.style.height;
    };

    const scheduleRender = () => {
      if (renderScheduled) return;
      renderScheduled = true;
      requestAnimationFrame(() => {
        if (disposed) return;
        renderScheduled = false;
        const full = pendingFullRender;
        const rowsToRender = new Set(pendingRenderRows);
        pendingFullRender = false;
        pendingRenderRows.clear();
        const snapshot = buffer.toSnapshot();
        onSnapshotRef.current?.(snapshot);
        if (full) {
          ctx = sizeCanvasToGrid(canvas, atlas, snapshot.cols, snapshot.rows, dpr);
          renderSnapshot(ctx, atlas, snapshot, dpr, theme);
        } else {
          renderPartial(ctx, atlas, snapshot, rowsToRender, dpr, theme);
        }
        traceTerminalLatency("frontend.canvas.render", {
          id: sessionId,
          full,
          changedRows: rowsToRender.size,
        });
        traceTerminalLatency("frontend.canvas.render.raf", {
          id: sessionId,
          full,
          changedRows: rowsToRender.size,
        });
        syncOverlaySize();
        drawSelectionOverlay();
      });
    };

    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (payload) => {
      if (disposed) return;
      let frame;
      let changed;
      try {
        frame = decodeFrame(payload);
        changed = buffer.apply(frame);
        traceTerminalLatency("frontend.canvas.diff.receive", {
          id: sessionId,
          full: frame.full,
          changedRows: changed.size,
          bytes: payload.byteLength,
        });
      } catch (error) {
        const message = `Terminal grid diff failed: ${String(error)}`;
        console.error(message, error);
        setAttachError(message);
        onStatusRef.current?.("failed", { error: message });
        return;
      }
      setAttachError(null);
      const prevAltScreen = modesRef.current.altScreen;
      modesRef.current = {
        appCursor: buffer.appCursor,
        bracketedPaste: buffer.bracketedPaste,
        altScreen: buffer.altScreen,
        mouseReport: buffer.mouseReport,
        alternateScroll: buffer.alternateScroll,
        sgrMouse: buffer.sgrMouse,
      };
      const firstFrame = !firstFrameRef.current;
      if (firstFrame) {
        firstFrameRef.current = true;
        const waiters = firstFrameWaitersRef.current;
        firstFrameWaitersRef.current = [];
        for (const resolve of waiters) resolve();
      }
      for (const row of changed) {
        pendingRenderRows.add(row);
      }
      pendingFullRender = pendingFullRender || frame.full;
      visibleContentSeen =
        visibleContentSeen ||
        (frame.full
          ? buffer.cells.some((row) => row.some((cell) => cell.c.trim() !== ""))
          : [...changed].some((row) =>
              buffer.cells[row]?.some((cell) => cell.c.trim() !== "")
            ));
      if (onOutputRef.current) {
        const changedText = [...changed]
          .sort((a, b) => a - b)
          .map((row) => buffer.cells[row]?.map((cell) => cell.c).join("").trimEnd() ?? "")
          .filter(Boolean)
          .join("\n");
        if (changedText) onOutputRef.current(changedText);
      }
      if (reusedSession && firstFrame && !legacyPromptRepairSent) {
        const snapshot = buffer.toSnapshot();
        if (needsLegacyPromptRepair(snapshot)) {
          legacyPromptRepairSent = true;
          invoke("grid_scroll_to_bottom", { id: sessionId }).catch(console.error);
          invoke("daemon_write_session", { id: sessionId, data: "\x0c" }).catch(console.error);
        }
      }
      scheduleRender();
      // Keep the map node fitted to the current mode: re-fit the frozen canvas
      // after a full sync (which resets canvas size), and switch freeze↔reflow
      // when the inner app enters/leaves alt-screen. The first frame also runs
      // this so the deferred post-attach reconcile happens once modes are known.
      if (mapProjection && (firstFrame || frame.full || prevAltScreen !== buffer.altScreen)) {
        reconcileLayout();
      }
    };

    // Reflow: derive cols/rows from the shell's pixel box and keep the PTY and
    // the headless grid in lock-step. The grid emits a full sync after a
    // dimension change, repainting at the new size.
    //
    // `attached` gates resize until grid_attach has completed. The ResizeObserver
    // can fire on the initial layout (and on the first window resize) BEFORE the
    // async attach below resolves; without this gate that early fire records the
    // pane size in lastCols/lastRows while grid_resize no-ops on the unattached
    // session, so the post-attach applyResize() then sees no change and the grid
    // stays stuck at the 80×24 attach default until the next resize. Gating keeps
    // lastCols/lastRows at the attach defaults so the first real fit always runs.
    let attached = false;
    let lastCols = cols;
    let lastRows = rows;

    // Derive the grid/PTY dimensions from the shell's pixel box. Falls back to
    // the prop defaults while the pane is unmeasured (clientWidth 0, e.g. a
    // not-yet-laid-out or hidden pane) so a collapsed pane never sends a bogus
    // 1-column size.
    const measure = (): { cols: number; rows: number } => {
      const shell = shellRef.current;
      if (!shell || shell.clientWidth <= 0 || shell.clientHeight <= 0) {
        return { cols, rows };
      }
      return computeGridSize(
        shell.clientWidth,
        shell.clientHeight,
        metrics.cellWidth,
        metrics.cellHeight,
      );
    };

    // Resize the headless grid and the PTY winsize together. The two MUST stay in
    // lock-step: the grid parses the PTY's byte stream, so if its width differs
    // from the PTY winsize the shell/TUI wraps lines for a width the grid doesn't
    // have, producing the duplicated/clipped-prompt corruption.
    //
    // Order matters: resize the GRID first (awaited), THEN the PTY. The PTY resize
    // raises SIGWINCH and the shell reprints its prompt at the new width; if the
    // grid parser hasn't resized yet it parses that reprint at the old width and
    // the prompt stacks/garbles. Awaiting grid_resize first guarantees the parser
    // is already at the new width when the reprint bytes arrive.
    const applyResize = async () => {
      if (disposed || !attached) return;
      const { cols: nextCols, rows: nextRows } = measure();
      if (nextCols === lastCols && nextRows === lastRows) return;
      lastCols = nextCols;
      lastRows = nextRows;
      try {
        await invoke("grid_resize", { id: sessionId, cols: nextCols, rows: nextRows });
      } catch (error) {
        console.error(error);
      }
      if (disposed) return;
      // Await the PTY resize too. Fire-and-forget left a window where applyResize
      // resolved while the SIGWINCH was still in flight; a fast shell could reprint
      // before its winsize updated, stacking a wrong-width prompt. Awaiting closes
      // that window (the grid is already at the new width from the await above).
      try {
        await invoke("daemon_resize_session", { id: sessionId, cols: nextCols, rows: nextRows });
      } catch (error) {
        console.error(error);
      }
    };

    // Map-projection freeze: scale the (frozen-size) canvas down to fit the node
    // box instead of reflowing. Pointer math already normalizes by the canvas'
    // getBoundingClientRect, so a CSS transform here doesn't break clicks.
    const applyProjectionScale = () => {
      const shell = shellRef.current;
      if (!canvas || !shell) return;
      const logicalW = parseFloat(canvas.style.width) || canvas.width / dpr;
      const logicalH = parseFloat(canvas.style.height) || canvas.height / dpr;
      if (logicalW <= 0 || logicalH <= 0) return;
      const scale = Math.min(1, shell.clientWidth / logicalW, shell.clientHeight / logicalH);
      const transform = `scale(${scale})`;
      canvas.style.transformOrigin = "top left";
      canvas.style.transform = transform;
      const overlay = overlayRef.current;
      if (overlay) {
        overlay.style.transformOrigin = "top left";
        overlay.style.transform = transform;
      }
    };

    const clearProjectionScale = () => {
      if (canvas.style.transform) canvas.style.transform = "";
      const overlay = overlayRef.current;
      if (overlay && overlay.style.transform) overlay.style.transform = "";
    };

    // Decide between freeze (alt-screen on the map) and reflow (everything else).
    // For map nodes we must wait for the first frame so altScreen is known —
    // reflowing a wide alt-screen frame before then is exactly the corruption
    // this avoids; the first-frame handler re-runs this once modes are real.
    const reconcileLayout = () => {
      if (mapProjection && !firstFrameRef.current) return;
      if (mapProjection && modesRef.current.altScreen) {
        applyProjectionScale();
      } else {
        clearProjectionScale();
        void applyResize();
      }
    };

    // Coalesce ResizeObserver bursts. On the map a node animates/zooms into place
    // and the shell's pixel box steps through several intermediate sizes before it
    // settles; firing applyResize on each step sends a SIGWINCH per step, and the
    // shell reprints its prompt for every one — that's the stacked-duplicate-prompt
    // corruption. A trailing debounce collapses the burst into a single resize at
    // the final settled size, so the shell gets exactly one SIGWINCH. The forced
    // post-attach reconcile below stays immediate (it runs once, off this path).
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        reconcileLayout();
      }, 80);
    };

    const observer = new ResizeObserver(scheduleResize);
    if (shellRef.current) observer.observe(shellRef.current);

    const forceSnapshotRefresh = async () => {
      if (disposed || visibleContentSeen) return;
      try {
        const json = await invoke<string>("grid_snapshot", { id: sessionId });
        if (disposed || visibleContentSeen) return;
        const snapshot = JSON.parse(json) as GridSnapshot;
        if (!snapshot?.cells?.length) return;
        ctx = sizeCanvasToGrid(canvas, atlas, snapshot.cols, snapshot.rows, dpr);
        renderSnapshot(ctx, atlas, snapshot, dpr, theme);
        syncOverlaySize();
        drawSelectionOverlay();
        visibleContentSeen = snapshot.cells.some((row) =>
          row.some((cell) => cell.c.trim() !== "")
        );
      } catch (error) {
        if (!disposed) {
          const message = String(error);
          console.error("Terminal canvas snapshot refresh failed:", error);
          setAttachError(message);
          onStatusRef.current?.("failed", { error: message });
        }
      }
    };

    const failIfStillBlank = () => {
      if (disposed || visibleContentSeen) return;
      const message =
        "No visible terminal content was received from the grid stream after attach.";
      console.error(message);
      setAttachError(message);
      onStatusRef.current?.("failed", { error: message });
    };

    (async () => {
      // Ensure the daemon owns the PTY (the daemon is the PTY authority), then
      // attach the headless grid and subscribe to its binary diff stream.
      //
      // Spawn the PTY at the *measured* pane size (not the 80x24 prop default) so a
      // fresh shell prints its first prompt at the real width. The old path spawned
      // at 80, then resized — SIGWINCH made the shell reprint, leaving a stale
      // wrong-width prompt stacked above the live one (the duplicate-prompt bug).
      // Attach the grid at the same size so the daemon's scrollback replay (and a
      // reused session's wide history) is parsed at the width the shell is using.
      onStatusRef.current?.("starting");
      const daemonStatus = await invoke<{ reachable: boolean; message: string }>("daemon_ensure_running");
      if (!daemonStatus.reachable) {
        throw new Error(daemonStatus.message);
      }
      const init = measure();
      const ensured = await invoke<{
        id: string;
        reused: boolean;
        cols?: number | null;
        rows?: number | null;
      }>("daemon_ensure_session", {
        id: sessionId,
        cwd,
        command,
        cols: init.cols,
        rows: init.rows,
      });
      if (disposed) return;
      // On a map node, attach a reused session at its live working size (read back
      // from the daemon) and DON'T resize it down: a wide alt-screen TUI shrunk to
      // the tiny node reflows into garbage and a static app never repaints. The
      // post-attach reconcile then either freezes+scales (alt-screen) or reflows
      // (plain shell) once the first frame reveals the mode. A fresh session has no
      // prior size, so it spawns at the node size like split panes.
      const keepWorkingSize =
        mapProjection &&
        ensured.reused &&
        typeof ensured.cols === "number" &&
        ensured.cols > 0 &&
        typeof ensured.rows === "number" &&
        ensured.rows > 0;
      const attachCols = keepWorkingSize ? (ensured.cols as number) : init.cols;
      const attachRows = keepWorkingSize ? (ensured.rows as number) : init.rows;
      reusedSession = ensured.reused;
      // A reused session is already running at its old winsize; bring it to this
      // pane's size. A fresh session already spawned at init size above, so resizing
      // it here would be a redundant SIGWINCH → an extra prompt reprint — skip it.
      // Map projection skips this entirely to preserve the working size.
      if (ensured.reused && !keepWorkingSize) {
        await invoke("daemon_resize_session", { id: sessionId, cols: attachCols, rows: attachRows });
        if (disposed) return;
      }
      await invoke("grid_attach", { id: sessionId, cols: attachCols, rows: attachRows });
      if (disposed) return;
      await invoke("grid_scroll_to_bottom", { id: sessionId });
      if (disposed) return;
      await invoke("grid_subscribe_diffs", { id: sessionId, onDiff: channel });
      attached = true;
      lastCols = attachCols;
      lastRows = attachRows;
      refreshTimer = setTimeout(() => {
        void forceSnapshotRefresh();
      }, 900);
      blankGuardTimer = setTimeout(failIfStillBlank, 3000);
      exitPollTimer = setInterval(() => {
        if (disposed || exitReported) return;
        void invoke<Array<{
          id: string;
          kind: string;
          exit_status?: { code?: number | null; success?: boolean } | null;
        }>>("daemon_list_session_events")
          .then((events) => {
            if (disposed || exitReported) return;
            const exitEvent = [...events]
              .reverse()
              .find((event) =>
                event.id === sessionId &&
                (event.kind === "eof" || event.kind === "killed" || event.kind === "read-error")
              );
            if (!exitEvent) return;
            exitReported = true;
            const code = exitEvent.exit_status?.code ?? (exitEvent.kind === "read-error" ? 1 : 0);
            const success = exitEvent.exit_status?.success ?? exitEvent.kind !== "read-error";
            onExitRef.current?.({ id: sessionId, code, success });
          })
          .catch(() => {});
      }, 500);
      // Reconcile only if layout settled to a different size during the awaits.
      // On a map node this defers (firstFrame not yet) so the mode is known before
      // we choose freeze vs reflow; the first-frame handler runs it then.
      reconcileLayout();
      // Report the live PTY so the store records it in tab.terminals. The daemon
      // is the PTY authority and `reused` is true when we reattached to a session
      // that survived an unmount/project-switch (vs. a freshly spawned shell).
      onReadyRef.current?.(ensured.id, { reused: ensured.reused });
    })().catch((error) => {
      if (disposed) return;
      const message = String(error);
      console.error(error);
      setAttachError(message);
      onStatusRef.current?.("failed", { error: message });
    });

    return () => {
      disposed = true;
      if (refreshTimer !== null) clearTimeout(refreshTimer);
      if (blankGuardTimer !== null) clearTimeout(blankGuardTimer);
      if (exitPollTimer !== null) clearInterval(exitPollTimer);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      daemonInputQueueRef.current?.dispose();
      daemonInputQueueRef.current = null;
      observer.disconnect();
      invoke("grid_detach", { id: sessionId }).catch(() => {});
    };
  }, [sessionId, cwd, command, cols, rows, theme, fontsReady, renderScale, mapProjection]);

  const scheduleScrollToBottom = () => {
    if (scrollToBottomPendingRef.current) return;
    scrollToBottomPendingRef.current = true;
    requestAnimationFrame(() => {
      scrollToBottomPendingRef.current = false;
      invoke("grid_scroll_to_bottom", { id: sessionIdRef.current }).catch(console.error);
    });
  };

  const send = (data: string, seqId = nextTerminalInputSequence(), source = "canvas-send") => {
    scheduleScrollToBottom();
    let queue = daemonInputQueueRef.current;
    if (!queue) {
      queue = createDaemonInputQueue({
        getId: () => sessionIdRef.current,
        source,
        onFallbackError: console.error,
      });
      daemonInputQueueRef.current = queue;
    }
    queue.queue(data, seqId);
  };

  useEffect(() => {
    if (!queuedInput || queuedInput.sentAt) return;
    const inputId = queuedInput.id;
    const text = queuedInput.text.endsWith("\r") ? queuedInput.text : `${queuedInput.text}\r`;
    let cancelled = false;
    void waitForFirstFrame().then(() => {
      if (cancelled) return;
      onQueuedInputSent?.(inputId);
      send(text, nextTerminalInputSequence(), "canvas-workstream-input");
    });
    return () => {
      cancelled = true;
    };
  }, [queuedInput?.id, queuedInput?.sentAt, queuedInput?.text, onQueuedInputSent]);

  const syncFocusedTerminal = useCallback(() => {
    if (!inputRef.current || document.activeElement !== inputRef.current) return;
    // Tell the backend this terminal owns the keyboard, so the Linux GTK
    // Tab-interceptor routes Tab/Shift+Tab to the current PTY. This must also run
    // when sessionId changes while the hidden textarea stays focused; otherwise
    // GTK-level Tab rescue can keep pointing at the old PTY.
    invoke("set_focused_terminal", { id: sessionIdRef.current }).catch(() => {});
    // Mark this PTY as the active terminal so the top-bar breadcrumb tracks the
    // focused pane's live cwd.
    useWorkspaceStore.getState().setActiveTerminal(sessionIdRef.current);
  }, []);

  useEffect(() => {
    syncFocusedTerminal();
  }, [sessionId, syncFocusedTerminal]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Copy/paste shortcuts are handled by the browser/clipboard, not as input.
    const key = event.key.toLowerCase();
    if (event.ctrlKey && event.shiftKey && key === "f") {
      event.preventDefault();
      event.stopPropagation();
      useWorkspaceStore.getState().toggleImmersiveTerminal(tabId, paneId);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "c") {
      copySelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === "v") {
      return;
    }
    const bytes = keyEventToBytes(event.nativeEvent, {
      appCursor: modesRef.current.appCursor,
    });
    if (bytes !== null) {
      const seqId = nextTerminalInputSequence();
      traceTerminalLatency("frontend.canvas.keydown", {
        id: sessionId,
        bytes: bytes.length,
        seqId,
        key: event.key,
      });
      // preventDefault stops the browser default (notably Tab/Shift+Tab focus
      // traversal, which would otherwise move focus off this textarea and out of
      // the terminal); stopPropagation keeps the key from bubbling to any app
      // chrome listener. Together they guarantee a focused terminal owns the key.
      event.preventDefault();
      event.stopPropagation();
      send(bytes, seqId, "canvas-keydown");
    }
  };

  // Window-level CAPTURE keydown handler. The textarea's own onKeyDown is a
  // bubble-phase listener; WebKitGTK performs Tab/Shift+Tab focus traversal as a
  // default action that, on Linux, can move focus off the textarea before the
  // bubble handler runs — so Shift+Tab (zellij back-tab) never reached the PTY.
  // Capture phase fires window→target FIRST, so intercepting here lets us
  // preventDefault the traversal and forward the bytes while the terminal is
  // focused. stopPropagation also prevents the bubble handler from double-sending.
  useEffect(() => {
    const onCaptureKeyDown = (event: KeyboardEvent) => {
      if (!inputRef.current || document.activeElement !== inputRef.current) return;
      const key = event.key.toLowerCase();
      const immersiveTerminal = useWorkspaceStore.getState().workspaceUiState.immersiveTerminal;
      const isImmersivePane =
        immersiveTerminal.enabled &&
        immersiveTerminal.tabId === tabId &&
        immersiveTerminal.paneId === paneId;
      if (
        isImmersivePane &&
        event.key === "Escape" &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        event.preventDefault();
        event.stopPropagation();
        useWorkspaceStore.getState().exitImmersiveTerminal();
        return;
      }
      if (event.ctrlKey && event.shiftKey && key === "f") {
        event.preventDefault();
        event.stopPropagation();
        useWorkspaceStore.getState().toggleImmersiveTerminal(tabId, paneId);
        return;
      }
      // Leave copy/paste shortcuts to the bubble handler / browser clipboard.
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "c" || key === "v")) {
        return;
      }
      const bytes = keyEventToBytes(event, { appCursor: modesRef.current.appCursor });
      if (bytes === null) return;
      const seqId = nextTerminalInputSequence();
      traceTerminalLatency("frontend.canvas.keydown", {
        id: sessionIdRef.current,
        bytes: bytes.length,
        seqId,
        key: event.key,
        capture: true,
      });
      event.preventDefault();
      event.stopPropagation();
      send(bytes, seqId, "canvas-capture-keydown");
    };
    window.addEventListener("keydown", onCaptureKeyDown, true);
    return () => window.removeEventListener("keydown", onCaptureKeyDown, true);
  }, [paneId, tabId]);

  // Resolve once the first diff frame has set the real terminal modes, or after a
  // short timeout so a paste is never lost if the backend is slow/quiet.
  const waitForFirstFrame = (): Promise<void> => {
    if (firstFrameRef.current) return Promise.resolve();
    const epoch = sessionEpochRef.current;
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (epoch !== sessionEpochRef.current) return;
        resolve();
      };
      firstFrameWaitersRef.current.push(finish);
      window.setTimeout(finish, 500);
    });
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text");
    if (!text) return;
    // Gate on the first frame: pasting before modesRef reflects the real
    // bracketedPaste mode would send a multi-line paste unwrapped, and its
    // newlines (normalized to \r) would auto-run each line instead of landing as
    // a single bracketed paste.
    const epoch = sessionEpochRef.current;
    void waitForFirstFrame().then(() => {
      if (epoch !== sessionEpochRef.current) return;
      if (text) send(encodePaste(text, modesRef.current.bracketedPaste));
    });
  };

  const focusInput = () => inputRef.current?.focus();

  const clientPointToCell = (clientX: number, clientY: number): CellPoint | null => {
    const buffer = bufferRef.current;
    const canvas = canvasRef.current;
    if (!buffer || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { width, height } = cellRef.current;
    // Account for any CSS scale applied on the map by normalizing to logical px.
    const scaleX = rect.width / (canvas.width / cellRef.current.dpr);
    const scaleY = rect.height / (canvas.height / cellRef.current.dpr);
    const offsetX = (clientX - rect.left) / (scaleX || 1);
    const offsetY = (clientY - rect.top) / (scaleY || 1);
    return pointToCell(offsetX, offsetY, width, height, buffer.cols, buffer.rows);
  };

  const pointerToCell = (event: React.PointerEvent): CellPoint | null =>
    clientPointToCell(event.clientX, event.clientY);

  const pointerToVtCell = (event: React.PointerEvent): { col: number; row: number } | null => {
    const buffer = bufferRef.current;
    if (!buffer) return null;
    const point = pointerToCell(event);
    return {
      col: Math.min(buffer.cols, Math.max(1, (point?.col ?? 0) + 1)),
      row: Math.min(buffer.rows, Math.max(1, (point?.row ?? 0) + 1)),
    };
  };

  const sendPointerMouseReport = (event: React.PointerEvent, release = false) => {
    const terminalButton = pointerButtonToTerminalButton(event.button);
    if (terminalButton === null) return false;
    const cell = pointerToVtCell(event);
    if (!cell) return false;
    const modes = modesRef.current;
    send(encodeMouseReport({
      button: terminalButton,
      col: cell.col,
      row: cell.row,
      sgr: modes.sgrMouse,
      release,
      modifiers: event,
    }));
    return true;
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    focusInput();
    if (modesRef.current.mouseReport) {
      if (sendPointerMouseReport(event)) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (event.button !== 0) return;
    const cell = pointerToCell(event);
    if (!cell) return;
    anchorRef.current = cell;
    selectionRef.current = null;
    drawSelectionOverlay();
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!anchorRef.current || (event.buttons & 1) === 0) return;
    const cell = pointerToCell(event);
    if (!cell) return;
    selectionRef.current = normalizeRange(anchorRef.current, cell);
    drawSelectionOverlay();
  };

  const copySelection = () => {
    const buffer = bufferRef.current;
    const range = selectionRef.current;
    if (!buffer || !range) return;
    const text = selectionToText(buffer.cells, range);
    if (text) navigator.clipboard?.writeText(text).catch(console.error);
    // Writing to the clipboard can move focus off the hidden textarea; without
    // restoring it, the next keystroke (e.g. Shift+Tab) falls through to the
    // browser's focus traversal and escapes the terminal instead of reaching the
    // PTY. Re-own keyboard focus after every copy.
    focusInput();
  };

  const handlePointerUp = (event: React.PointerEvent) => {
    if (modesRef.current.mouseReport) {
      if (sendPointerMouseReport(event, true)) {
        event.preventDefault();
        event.stopPropagation();
      }
      anchorRef.current = null;
      focusInput();
      return;
    }
    anchorRef.current = null;
    if (selectionRef.current) copySelection();
    // A selection drag ends with the pointer up; make sure the textarea keeps
    // keyboard focus so terminal shortcuts (Shift+Tab back-tab, Ctrl keys) go to
    // the PTY rather than the browser.
    focusInput();
  };

  // Translate a wheel event into the cell (1-based col/row) under the pointer.
  // Shared with mouse-wheel reporting so the byte sequence names the right cell.
  const wheelCell = (event: React.WheelEvent): { col: number; row: number } => {
    const buffer = bufferRef.current;
    if (!buffer) return { col: 1, row: 1 };
    const point = clientPointToCell(event.clientX, event.clientY);
    // VT mouse coordinates are 1-based; clamp into the grid.
    return {
      col: Math.min(buffer.cols, Math.max(1, (point?.col ?? 0) + 1)),
      row: Math.min(buffer.rows, Math.max(1, (point?.row ?? 0) + 1)),
    };
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const notches = Math.max(1, Math.round(Math.abs(event.deltaY) / 24));
    const up = event.deltaY < 0;
    const modes = modesRef.current;

    // Plain wheel scrolls TermFleet's own history. Alt+wheel is the explicit
    // escape hatch for apps that own wheel input (zellij, vim, htop, less, tmux).
    if (shouldSendWheelToTerminalApp(event) && modes.mouseReport) {
      const { col, row } = wheelCell(event);
      const button = up ? 64 : 65;
      const report = encodeMouseReport({
        button,
        col,
        row,
        sgr: modes.sgrMouse,
        modifiers: event,
      });
      send(report.repeat(notches));
      return;
    }

    // Alt-screen alternate-scroll (DECSET 1007) remains available through
    // Alt+wheel, honoring application-cursor mode.
    if (shouldSendWheelToTerminalApp(event) && modes.altScreen && modes.alternateScroll) {
      const seq = up
        ? modes.appCursor ? "\x1bOA" : "\x1b[A"
        : modes.appCursor ? "\x1bOB" : "\x1b[B";
      send(seq.repeat(notches * 3));
      return;
    }

    invoke("grid_scroll", { id: sessionId, delta: (up ? 1 : -1) * notches * 3 }).catch(
      console.error,
    );
  };

  return (
    <div
      ref={shellRef}
      className="terminal-canvas-shell"
      style={{ position: "relative", display: "block", width: "100%", height: "100%" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      <canvas
        ref={canvasRef}
        className="terminal-canvas"
        data-terminal-renderer="canvas2d"
        style={{
          display: "block",
          imageRendering: "auto",
        }}
      />
      <canvas
        ref={overlayRef}
        className="terminal-canvas-selection"
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          pointerEvents: "none",
          display: "block",
          imageRendering: "auto",
        }}
      />
      {attachError ? (
        <div
          className="terminal-canvas-error"
          role="status"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            paddingLeft: 18,
            paddingRight: 18,
            color: "#f0b36a",
            background: "rgba(29, 32, 34, 0.92)",
            fontFamily: FONT_FAMILY,
            fontSize: 12,
            pointerEvents: "none",
            whiteSpace: "pre-wrap",
          }}
        >
          Terminal attach failed: {attachError}
        </div>
      ) : null}
      <textarea
        ref={inputRef}
        className="terminal-canvas-input"
        aria-label="Terminal input"
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onFocus={syncFocusedTerminal}
        onBlur={() => {
          invoke("set_focused_terminal", { id: null }).catch(() => {});
        }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          margin: 0,
          padding: 0,
          border: "none",
          outline: "none",
          resize: "none",
          background: "transparent",
          color: "transparent",
          caretColor: "transparent",
          // Keep it interactive but invisible; it owns keyboard focus.
          opacity: 0,
          overflow: "hidden",
          whiteSpace: "pre",
        }}
      />
    </div>
  );
}
