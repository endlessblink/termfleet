// TC-017b/c/d — Canvas2D terminal renderer with input.
//
// Attaches the headless-VT grid, subscribes to the Rust binary dirty-diff
// channel (full sync repaints all; diffs touch only changed rows), and captures
// keystrokes via a hidden textarea (IME-friendly) translated through the keymap
// into VT bytes sent to the daemon PTY. No optimistic echo — the PTY echoes and
// the grid updates via diffs. A plain DOM <canvas>, so it pans/zooms with CSS
// transforms (split-pane and map cases both covered).

import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { GlyphAtlas, measureCell } from "../lib/fontAtlas";
import { GridBuffer } from "../lib/gridBuffer";
import { decodeFrame } from "../lib/gridDiff";
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
  normalizeRange,
  pointToCell,
  rowSpan,
  selectionToText,
  type CellPoint,
  type SelectionRange,
} from "../lib/selection";

const FONT_FAMILY =
  '"JetBrains Mono", "Geist Mono", "FiraCode Nerd Font", "Cascadia Code", "Consolas", monospace';
const FONT_SIZE_PX = 14;
const LINE_HEIGHT = 1.2;

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface TerminalCanvasProps {
  sessionId: string;
  cols?: number;
  rows?: number;
  theme?: RenderTheme;
}

export function TerminalCanvas({
  sessionId,
  cols = 80,
  rows = 24,
  theme = DEFAULT_THEME,
}: TerminalCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Latest terminal modes, kept current by the diff stream, read by input.
  const modesRef = useRef({ appCursor: false, bracketedPaste: false });
  // Render context shared with pointer/copy handlers (set inside the effect).
  const bufferRef = useRef<GridBuffer | null>(null);
  const cellRef = useRef({ width: 8, height: 16, dpr: 1 });
  const selectionRef = useRef<SelectionRange | null>(null);
  const anchorRef = useRef<CellPoint | null>(null);

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
    if (!canvas || !isTauriRuntime()) return;

    let disposed = false;
    const dpr = window.devicePixelRatio || 1;
    const metrics = measureCell(FONT_FAMILY, FONT_SIZE_PX, dpr, LINE_HEIGHT);
    const atlas = new GlyphAtlas(metrics);
    const buffer = new GridBuffer();
    bufferRef.current = buffer;
    cellRef.current = { width: metrics.cellWidth, height: metrics.cellHeight, dpr };
    let ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);

    const syncOverlaySize = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      if (overlay.width !== canvas.width) overlay.width = canvas.width;
      if (overlay.height !== canvas.height) overlay.height = canvas.height;
      overlay.style.width = canvas.style.width;
      overlay.style.height = canvas.style.height;
    };

    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (payload) => {
      if (disposed) return;
      const frame = decodeFrame(payload);
      const changed = buffer.apply(frame);
      modesRef.current = {
        appCursor: buffer.appCursor,
        bracketedPaste: buffer.bracketedPaste,
      };
      const snapshot = buffer.toSnapshot();
      if (frame.full) {
        ctx = sizeCanvasToGrid(canvas, atlas, snapshot.cols, snapshot.rows, dpr);
        renderSnapshot(ctx, atlas, snapshot, dpr, theme);
      } else {
        renderPartial(ctx, atlas, snapshot, changed, dpr, theme);
      }
      syncOverlaySize();
      drawSelectionOverlay();
    };

    // Reflow: derive cols/rows from the shell's pixel box and keep the PTY and
    // the headless grid in lock-step. The grid emits a full sync after a
    // dimension change, repainting at the new size.
    let lastCols = cols;
    let lastRows = rows;
    const applyResize = () => {
      const shell = shellRef.current;
      if (!shell || disposed) return;
      const { cols: nextCols, rows: nextRows } = computeGridSize(
        shell.clientWidth,
        shell.clientHeight,
        metrics.cellWidth,
        metrics.cellHeight,
      );
      if (nextCols === lastCols && nextRows === lastRows) return;
      lastCols = nextCols;
      lastRows = nextRows;
      invoke("daemon_resize_session", { id: sessionId, cols: nextCols, rows: nextRows }).catch(
        console.error,
      );
      invoke("grid_resize", { id: sessionId, cols: nextCols, rows: nextRows }).catch(
        console.error,
      );
    };

    const observer = new ResizeObserver(applyResize);
    if (shellRef.current) observer.observe(shellRef.current);

    (async () => {
      await invoke("grid_attach", { id: sessionId, cols, rows });
      if (disposed) return;
      await invoke("grid_subscribe_diffs", { id: sessionId, onDiff: channel });
      applyResize();
    })().catch(console.error);

    return () => {
      disposed = true;
      observer.disconnect();
      invoke("grid_detach", { id: sessionId }).catch(() => {});
    };
  }, [sessionId, cols, rows, theme]);

  const send = (data: string) => {
    invoke("daemon_write_session", { id: sessionId, data }).catch(console.error);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Copy/paste shortcuts are handled by the browser/clipboard, not as input.
    const key = event.key.toLowerCase();
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
      event.preventDefault();
      send(bytes);
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text");
    if (text) send(encodePaste(text, modesRef.current.bracketedPaste));
  };

  const focusInput = () => inputRef.current?.focus();

  const pointerToCell = (event: React.PointerEvent): CellPoint | null => {
    const buffer = bufferRef.current;
    const canvas = canvasRef.current;
    if (!buffer || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const { width, height } = cellRef.current;
    // Account for any CSS scale applied on the map by normalizing to logical px.
    const scaleX = rect.width / (canvas.width / cellRef.current.dpr);
    const scaleY = rect.height / (canvas.height / cellRef.current.dpr);
    const offsetX = (event.clientX - rect.left) / (scaleX || 1);
    const offsetY = (event.clientY - rect.top) / (scaleY || 1);
    return pointToCell(offsetX, offsetY, width, height, buffer.cols, buffer.rows);
  };

  const handlePointerDown = (event: React.PointerEvent) => {
    focusInput();
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
  };

  const handlePointerUp = () => {
    anchorRef.current = null;
    if (selectionRef.current) copySelection();
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    // Scroll a few lines per notch; positive deltaY (down) reduces history offset.
    const lines = Math.max(1, Math.round(Math.abs(event.deltaY) / 24)) * 3;
    const delta = event.deltaY < 0 ? lines : -lines;
    invoke("grid_scroll", { id: sessionId, delta }).catch(console.error);
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
        style={{ display: "block" }}
      />
      <canvas
        ref={overlayRef}
        className="terminal-canvas-selection"
        aria-hidden="true"
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", display: "block" }}
      />
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
