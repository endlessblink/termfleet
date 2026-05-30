// TC-017b/c — Canvas2D terminal renderer (read-only).
//
// Attaches the headless-VT grid for a session and subscribes to the Rust binary
// dirty-diff channel (`grid_subscribe_diffs`). A full sync repaints the whole
// grid; subsequent diffs touch only changed rows. Because it is a normal DOM
// <canvas>, it pans/zooms with CSS transforms — solving both the split-pane and
// map-surface cases. Input (TC-017d) comes in a later stage.

import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { GlyphAtlas, measureCell } from "../lib/fontAtlas";
import { GridBuffer } from "../lib/gridBuffer";
import { decodeFrame } from "../lib/gridDiff";
import {
  DEFAULT_THEME,
  renderPartial,
  renderSnapshot,
  sizeCanvasToGrid,
  type RenderTheme,
} from "../lib/gridRenderer";

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
      const snapshot = buffer.toSnapshot();
      if (frame.full) {
        ctx = sizeCanvasToGrid(canvas, atlas, snapshot.cols, snapshot.rows, dpr);
        renderSnapshot(ctx, atlas, snapshot, dpr, theme);
      } else {
        renderPartial(ctx, atlas, snapshot, changed, dpr, theme);
      }
    };

    (async () => {
      await invoke("grid_attach", { id: sessionId, cols, rows });
      if (disposed) return;
      await invoke("grid_subscribe_diffs", { id: sessionId, onDiff: channel });
    })().catch(console.error);

    return () => {
      disposed = true;
      invoke("grid_detach", { id: sessionId }).catch(() => {});
    };
  }, [sessionId, cols, rows, theme]);

  return (
    <canvas
      ref={canvasRef}
      className="terminal-canvas"
      data-terminal-renderer="canvas2d"
      style={{ display: "block" }}
    />
  );
}
