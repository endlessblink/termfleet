function eventTime(sidecar) {
  const explicit = Number(sidecar?.turnEventAt);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const legacy = Number(sidecar?.updatedAt);
  return Number.isFinite(legacy) && legacy > 0 ? legacy : 0;
}

/** Prevent a slow earlier hook process from replacing a lifecycle event that finished later. */
export function shouldWriteStatusCandidate(candidate, onDisk) {
  if (!onDisk) return true;
  return eventTime(candidate) >= eventTime(onDisk);
}
