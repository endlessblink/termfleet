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
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  // Latest terminal modes, kept current by the diff stream, read by input.
  const modesRef = useRef({ appCursor: false, bracketedPaste: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isTauriRuntime()) return;

    let disposed = false;
    const dpr = window.devicePixelRatio || 1;
    const metrics = measureCell(FONT_FAMILY, FONT_SIZE_PX, dpr, LINE_HEIGHT);
    const atlas = new GlyphAtlas(metrics);
    const buffer = new GridBuffer();
    let ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);

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
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && (key === "c" || key === "v")) {
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

  return (
    <div
      ref={shellRef}
      className="terminal-canvas-shell"
      style={{ position: "relative", display: "block", width: "100%", height: "100%" }}
      onPointerDown={focusInput}
    >
      <canvas
        ref={canvasRef}
        className="terminal-canvas"
        data-terminal-renderer="canvas2d"
        style={{ display: "block" }}
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
