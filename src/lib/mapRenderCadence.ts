export function mapTerminalFrameGapMs(
  mapProjection: boolean,
  runtimeActive: boolean,
  interactive: boolean,
) {
  if (!mapProjection) return 0;
  if (!runtimeActive) return 1000;
  return interactive ? 0 : 125;
}

export function mapTerminalTransportMode(
  mapProjection: boolean,
  runtimeActive: boolean,
): "diffs" | "snapshot" {
  return mapProjection && !runtimeActive ? "snapshot" : "diffs";
}

export function shouldRefreshMapSnapshot(
  previousRevision: number | null,
  nextRevision: number,
) {
  return previousRevision === null || previousRevision !== nextRevision;
}

/**
 * CSS `image-rendering` for a terminal canvas.
 *
 * A map node shows the canvas only at zoom >= 1 (below that it paints the cheap
 * character preview) and the map CSS-scales it by the viewport zoom, while the
 * backing store is capped at `MAP_PROJECTION_MAX_DPR` (1.25x) to bound memory across
 * many nodes. Above that cap the browser upscales the bitmap, and the default
 * bilinear filter smeared the glyphs — text read as doubled letters with rows
 * bleeding into each other. Nearest-neighbour keeps the upscale hard and legible.
 *
 * The split pane is never CSS-scaled, so it keeps smooth `auto` (and its backing
 * store still supersamples via `renderScale`, so it stays crisp without this).
 */
export function terminalCanvasImageRendering(
  mapProjection: boolean,
): "pixelated" | "auto" {
  return mapProjection ? "pixelated" : "auto";
}
