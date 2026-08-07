// TC-017b — offscreen font atlas for the Canvas2D terminal renderer.
//
// Pre-renders glyph tiles (one per char + color + style) into offscreen
// canvases at device-pixel resolution and blits them with `drawImage`, instead
// of calling `fillText` for every cell every frame. WebKitGTK WebGL/DMA-BUF is
// unstable, so this is deliberately Canvas2D-only.
//
// A "tinted glyph cache" is itself a valid atlas: each unique
// (char, fg, bold, italic) is rasterized once, then reused. Terminals draw from
// a bounded palette, so the cache stays small in practice.

export interface CellMetrics {
  /** Cell width in CSS pixels. */
  cellWidth: number;
  /** Cell height in CSS pixels. */
  cellHeight: number;
  /** Font size in CSS pixels. */
  fontSizePx: number;
  fontFamily: string;
  /** Device pixel ratio the tiles are rasterized at. */
  dpr: number;
  /**
   * Synthetic weight boost in device pixels. A hairline stroke of this width is
   * drawn over each glyph to thicken stems when the font lacks a medium weight
   * (e.g. Hack ships only 400/700). 0 disables it.
   */
  weightBoostPx: number;
}

type TileCanvas = HTMLCanvasElement | OffscreenCanvas;

// Terminal output can contain arbitrary true-colour sequences. Keep the atlas
// useful for normal redraws without allowing a long-lived pane to retain one
// canvas per unique (character, colour, style) forever.
const MAX_GLYPH_ATLAS_TILES = 4096;

function createCanvas(width: number, height: number): TileCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function tileContext(canvas: TileCanvas): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("could not acquire 2d context for glyph tile");
  return ctx;
}

/**
 * Compute monospace cell metrics for a font at a given size. `lineHeight` is a
 * multiplier applied to the font size to get the cell height.
 */
export function measureCell(
  fontFamily: string,
  fontSizePx: number,
  dpr: number,
  lineHeight = 1.2,
  weightBoostCssPx = 0,
): CellMetrics {
  const probe = createCanvas(8, 8);
  const ctx = tileContext(probe);
  ctx.font = `${fontSizePx}px ${fontFamily}`;
  // Monospace: every printable advance is equal; measure a wide-ish glyph.
  const advance = ctx.measureText("M").width || fontSizePx * 0.6;
  return {
    cellWidth: Math.max(1, Math.round(advance)),
    cellHeight: Math.max(1, Math.round(fontSizePx * lineHeight)),
    fontSizePx,
    fontFamily,
    dpr,
    weightBoostPx: Math.max(0, weightBoostCssPx) * dpr,
  };
}

export class GlyphAtlas {
  private readonly tiles = new Map<string, TileCanvas>();
  private readonly tileW: number;
  private readonly tileH: number;
  private readonly baseline: number;

  constructor(private readonly metrics: CellMetrics) {
    this.tileW = Math.ceil(metrics.cellWidth * metrics.dpr);
    this.tileH = Math.ceil(metrics.cellHeight * metrics.dpr);
    // Alphabetic baseline near the bottom of the cell. Empirical 0.8 keeps
    // descenders inside the tile for typical monospace fonts.
    this.baseline = Math.round(this.tileH * 0.8);
  }

  get cellWidth(): number {
    return this.metrics.cellWidth;
  }

  get cellHeight(): number {
    return this.metrics.cellHeight;
  }

  get deviceTileWidth(): number {
    return this.tileW;
  }

  get deviceTileHeight(): number {
    return this.tileH;
  }

  private key(char: string, fg: string, bold: boolean, italic: boolean, widthCells: number): string {
    return `${char}\u0000${fg}\u0000${bold ? 1 : 0}${italic ? 1 : 0}\u0000${widthCells}`;
  }

  /** Get (rasterizing on first use) the tile for a glyph in a given color/style. */
  tile(char: string, fg: string, bold: boolean, italic: boolean, widthCells = 1): TileCanvas {
    const tileCells = Math.max(1, Math.ceil(widthCells));
    const key = this.key(char, fg, bold, italic, tileCells);
    const cached = this.tiles.get(key);
    if (cached) {
      // Map insertion order supplies a small LRU: recently visible glyphs stay
      // hot while old colours become collectible once the cap is reached.
      this.tiles.delete(key);
      this.tiles.set(key, cached);
      return cached;
    }

    const canvas = createCanvas(this.tileW * tileCells, this.tileH);
    const ctx = tileContext(canvas);
    const m = this.metrics;
    const weight = bold ? "700" : "400";
    const style = italic ? "italic " : "";
    ctx.font = `${style}${weight} ${m.fontSizePx * m.dpr}px ${m.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = fg;
    ctx.fillText(char, 0, this.baseline);
    // Synthetic medium weight: stroke the glyph in its own color to thicken
    // stems. Baked once into the device-resolution tile, so it stays crisp.
    if (m.weightBoostPx > 0) {
      ctx.strokeStyle = fg;
      ctx.lineWidth = m.weightBoostPx;
      ctx.lineJoin = "round";
      ctx.strokeText(char, 0, this.baseline);
    }

    this.tiles.set(key, canvas);
    while (this.tiles.size > MAX_GLYPH_ATLAS_TILES) {
      const oldest = this.tiles.keys().next().value;
      if (typeof oldest !== "string") break;
      this.tiles.delete(oldest);
    }
    return canvas;
  }

  /** Number of cached tiles (for diagnostics/tests). */
  get size(): number {
    return this.tiles.size;
  }
}

// Shared glyph-atlas cache. An atlas's tiles are a pure function of its
// `CellMetrics` (tiles are keyed by char/fg/bold/italic and rasterized from the
// metrics' font/size/dpr), so every terminal instance with the same metrics can
// safely share one atlas instead of allocating its own. With many live map
// terminals this collapses N duplicated tile caches (hundreds of MB at 2x dpr)
// to one per distinct metrics identity (typically just {1x dpr, 2x dpr}).
//
// The cache is module-global and intentionally never evicted on terminal
// unmount: a shared atlas outlives any single instance, and the set of distinct
// metrics is tiny and bounded.
const sharedAtlases = new Map<string, GlyphAtlas>();

function metricsKey(metrics: CellMetrics): string {
  return [
    metrics.fontFamily,
    metrics.fontSizePx,
    metrics.dpr,
    metrics.cellWidth,
    metrics.cellHeight,
    metrics.weightBoostPx,
  ].join("|");
}

/**
 * Get the process-wide shared `GlyphAtlas` for these metrics, creating it on
 * first use. Callers MUST NOT dispose the returned atlas — it is shared across
 * all terminal instances at the same metrics identity.
 */
export function getSharedAtlas(metrics: CellMetrics): GlyphAtlas {
  const key = metricsKey(metrics);
  let atlas = sharedAtlases.get(key);
  if (!atlas) {
    atlas = new GlyphAtlas(metrics);
    sharedAtlases.set(key, atlas);
  }
  return atlas;
}

/** Number of distinct shared atlases (for diagnostics/tests). */
export function sharedAtlasCount(): number {
  return sharedAtlases.size;
}
