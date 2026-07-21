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
