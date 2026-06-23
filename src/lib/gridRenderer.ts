// TC-017b — full-frame Canvas2D renderer for the headless-VT grid snapshot.
//
// Draws a backing-store canvas at device-pixel resolution: per cell, fill the
// background rect then blit the foreground glyph tile from the atlas. No diffing
// yet (TC-017c adds dirty-cell updates); this renders the whole visible grid.

import { drawBoxGlyph, isBoxGlyph } from "./boxGlyph";
import { GlyphAtlas } from "./fontAtlas";
import type { GridCell, GridSnapshot } from "./gridSnapshot";
import { drawPowerlineGlyph, isPowerlineGlyph } from "./powerlineGlyph";

const BLANK = new Set([" ", " ", "", "\u0000"]);

function isBlank(char: string): boolean {
  return BLANK.has(char);
}

export interface RenderTheme {
  /** Default background for the whole surface, "#rrggbb". */
  background: string;
  /** Cursor color, "#rrggbb". */
  cursor: string;
}

export const DEFAULT_THEME: RenderTheme = {
  background: "#1d2022",
  cursor: "#d99a45",
};

/**
 * Size a canvas's backing store to the grid at the current device pixel ratio,
 * keeping the CSS box at logical cell dimensions. Returns the device-space ctx.
 */
export function sizeCanvasToGrid(
  canvas: HTMLCanvasElement,
  atlas: GlyphAtlas,
  cols: number,
  rows: number,
  dpr: number,
): CanvasRenderingContext2D {
  const cssWidth = cols * atlas.cellWidth;
  const cssHeight = rows * atlas.cellHeight;
  // Size the backing store from the SAME integer device-space cell pitch the
  // renderer uses (renderSnapshot/renderPartial round cellWidth*dpr). Sizing
  // from the unrounded product instead would make cols*round(pitch) overflow
  // ceil(cols*cellWidth*dpr) at fractional dpr, clipping the last columns.
  const cellWDev = Math.round(atlas.cellWidth * dpr);
  const cellHDev = Math.round(atlas.cellHeight * dpr);
  const deviceWidth = cols * cellWDev;
  const deviceHeight = rows * cellHDev;

  if (canvas.width !== deviceWidth) canvas.width = deviceWidth;
  if (canvas.height !== deviceHeight) canvas.height = deviceHeight;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("could not acquire 2d context for terminal canvas");
  // Glyph tiles are pre-rasterized at device resolution and blitted 1:1, so
  // resampling must be off — smoothing would soften otherwise pixel-aligned text.
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

/**
 * Compute the cols×rows that fit a pixel box, given logical cell metrics.
 * Clamped to a sane minimum so a collapsed pane never sends a 0-size resize.
 */
export function computeGridSize(
  widthPx: number,
  heightPx: number,
  cellWidth: number,
  cellHeight: number,
): { cols: number; rows: number } {
  return {
    cols: Math.max(1, Math.floor(widthPx / cellWidth)),
    rows: Math.max(1, Math.floor(heightPx / cellHeight)),
  };
}

/**
 * Decide whether a terminal should REFLOW its grid to the node's measured size
 * or FREEZE at its current working size (TC-037 map projection).
 *
 * An interactive TUI on the operations map is normally frozen + clipped, because
 * reflowing a WIDE TUI into a SMALLER node fragments it. But that hazard is
 * shrink-only: GROWING a node never fragments — the app just gets more room. So
 * freeze only when the node would shrink the working grid in either dimension;
 * otherwise reflow so the terminal fills the grown node instead of leaving a
 * dead (background-colored) band below it.
 *
 * `preservesProjectionSize` is true only for an interactive map node (mouse/SGR/
 * alt-screen/alt-scroll modes). When false (a normal pane, or a non-interactive
 * map node) the answer is always "reflow".
 */
export function mapNodeLayoutMode(params: {
  altScreenOnMap: boolean;
}): "reflow" | "freeze" {
  // Freeze + clip ONLY a true full-screen ALT-SCREEN TUI (vim/htop, and any agent
  // that switches to the alternate screen). Reflowing one of those re-runs its
  // redraw at a different width and fragments it into visual wreckage — that's the
  // zellij-fragmentation reason the clip path exists.
  //
  // Everything else reflows, including PRIMARY-screen agents that merely enable
  // mouse-report (Claude/Codex inline). Primary-screen reflow is just line-rewrap,
  // which is safe — and necessary, or the grid stays frozen-small inside a larger
  // node and leaves a black band below. Gating freeze on mouse-report (too broad)
  // is exactly what regressed this.
  return params.altScreenOnMap ? "freeze" : "reflow";
}

function resolveColors(cell: GridCell): { fg: string; bg: string } {
  let fg = cell.fg;
  let bg = cell.bg;
  if (cell.inverse) {
    [fg, bg] = [bg, fg];
  }
  return { fg, bg };
}

function drawRow(
  ctx: CanvasRenderingContext2D,
  atlas: GlyphAtlas,
  line: GridCell[],
  row: number,
  cellW: number,
  cellH: number,
  dpr: number,
  theme: RenderTheme,
): void {
  const y = Math.round(row * cellH);
  // Clear the row band to the default background first (handles cells that
  // changed from colored back to default in a diff).
  ctx.fillStyle = theme.background;
  ctx.fillRect(0, y, ctx.canvas.width, Math.ceil(cellH) + 1);

  for (let col = 0; col < line.length; col += 1) {
    const cell = line[col];
    const { bg } = resolveColors(cell);
    const x = Math.round(col * cellW);

    // Background: only paint when it differs from the surface default, and
    // overdraw by 1px to avoid seams between device-rounded cells.
    if (bg !== theme.background) {
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
    }
  }

  for (let col = 0; col < line.length; col += 1) {
    const cell = line[col];
    const { fg } = resolveColors(cell);
    const x = Math.round(col * cellW);

    if (!isBlank(cell.c)) {
      const cp = cell.c.codePointAt(0) ?? 0;
      // Box-drawing / block elements draw geometrically so borders tile with no
      // sub-pixel gaps; everything else blits from the glyph atlas.
      if (isBoxGlyph(cp) && drawBoxGlyph(ctx, cp, x, y, cellW, cellH, fg)) {
        // handled
      } else if (isPowerlineGlyph(cp) && drawPowerlineGlyph(ctx, cp, x, y, cellW, cellH, fg)) {
        // handled
      } else {
        const widthCells = cell.wide ? 2 : 1;
        const tile = atlas.tile(cell.c, fg, Boolean(cell.bold), Boolean(cell.italic), widthCells);
        ctx.drawImage(tile as CanvasImageSource, x, y);
      }
    }

    if (cell.underline) {
      ctx.fillStyle = fg;
      const widthCells = cell.wide ? 2 : 1;
      ctx.fillRect(
        x,
        y + Math.round(cellH * 0.9),
        Math.ceil(cellW * widthCells),
        Math.max(1, Math.round(dpr)),
      );
    }
  }
}

function drawCursor(
  ctx: CanvasRenderingContext2D,
  snapshot: GridSnapshot,
  cellW: number,
  cellH: number,
  dpr: number,
  theme: RenderTheme,
): void {
  if (!snapshot.cursorVisible) return;
  const cx = Math.round(snapshot.cursor.col * cellW);
  const cy = Math.round(snapshot.cursor.line * cellH);
  ctx.fillStyle = theme.cursor;
  // Bar cursor (2 device px wide), matching the xterm "bar" style in use.
  ctx.fillRect(cx, cy, Math.max(2, Math.round(2 * dpr)), Math.ceil(cellH));
}

/** Render the full snapshot into a device-space 2D context. */
export function renderSnapshot(
  ctx: CanvasRenderingContext2D,
  atlas: GlyphAtlas,
  snapshot: GridSnapshot,
  dpr: number,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  // Round the device-space cell pitch to whole pixels. cellWidth/cellHeight are
  // integer CSS px, but at fractional dpr (1.5/2.25 under display scaling) the
  // raw product is fractional, and drawRow's Math.round(col*cellW) then lands
  // glyph tiles on uneven pixel boundaries — adjacent tiles bleed and the text
  // reads blurry. Integer pitch makes the grid pixel-exact at any dpr (tiles are
  // rasterized at device res and blitted 1:1 with smoothing off).
  const cellW = Math.round(atlas.cellWidth * dpr);
  const cellH = Math.round(atlas.cellHeight * dpr);

  ctx.fillStyle = theme.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  for (let row = 0; row < snapshot.cells.length; row += 1) {
    drawRow(ctx, atlas, snapshot.cells[row], row, cellW, cellH, dpr, theme);
  }
  drawCursor(ctx, snapshot, cellW, cellH, dpr, theme);
}

/** Re-render only the given row indices, then the cursor (TC-017c diff path). */
export function renderPartial(
  ctx: CanvasRenderingContext2D,
  atlas: GlyphAtlas,
  snapshot: GridSnapshot,
  rows: Iterable<number>,
  dpr: number,
  theme: RenderTheme = DEFAULT_THEME,
): void {
  // Integer device-space pitch — see renderSnapshot for why fractional dpr blurs.
  const cellW = Math.round(atlas.cellWidth * dpr);
  const cellH = Math.round(atlas.cellHeight * dpr);

  for (const row of rows) {
    if (row >= 0 && row < snapshot.cells.length) {
      drawRow(ctx, atlas, snapshot.cells[row], row, cellW, cellH, dpr, theme);
    }
  }
  drawCursor(ctx, snapshot, cellW, cellH, dpr, theme);
}
