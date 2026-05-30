// TC-017b — Canvas2D terminal renderer (read-only full-frame).
//
// Attaches the headless-VT grid for a session, then polls `grid_snapshot` on a
// requestAnimationFrame loop and renders the whole frame via the glyph atlas.
// Input (TC-017d) and binary dirty-diff (TC-017c) come in later stages; this is
// the visible-output half. Because it is a normal DOM <canvas>, it pans/zooms
// with CSS transforms — solving both the split-pane and map-surface cases.

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GlyphAtlas, measureCell } from "../lib/fontAtlas";
import {
  DEFAULT_THEME,
  renderSnapshot,
  sizeCanvasToGrid,
  type RenderTheme,
} from "../lib/gridRenderer";
import { parseGridSnapshot } from "../lib/gridSnapshot";

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
    let frame = 0;
    const dpr = window.devicePixelRatio || 1;
    const metrics = measureCell(FONT_FAMILY, FONT_SIZE_PX, dpr, LINE_HEIGHT);
    const atlas = new GlyphAtlas(metrics);
    const ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);

    let inFlight = false;
    const pump = async () => {
      if (disposed || inFlight) {
        frame = requestAnimationFrame(pump);
        return;
      }
      inFlight = true;
      try {
        const json = await invoke<string>("grid_snapshot", { id: sessionId });
        if (!disposed) {
          const snapshot = parseGridSnapshot(json);
          sizeCanvasToGrid(canvas, atlas, snapshot.cols, snapshot.rows, dpr);
          renderSnapshot(ctx, atlas, snapshot, dpr, theme);
        }
      } catch {
        // Grid may not be attached yet on the very first frames; keep polling.
      } finally {
        inFlight = false;
        if (!disposed) frame = requestAnimationFrame(pump);
      }
    };

    invoke("grid_attach", { id: sessionId, cols, rows })
      .catch(console.error)
      .finally(() => {
        if (!disposed) frame = requestAnimationFrame(pump);
      });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
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
