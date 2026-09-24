// "Reconnected" means a terminal outlived the previous app run and this run
// attached to it again. A terminal this run created is simply running, even when
// a second view (map card + split pane) attaches to it and the daemon reports
// the session as reused. Without this a fresh install greeted the operator with
// "pty reconnected · 1 reconnected" for a terminal that had never been away.
const createdThisRun = new Set<string>();

export function statusForAttach(ptyId: string, reused: boolean): "running" | "reconnected" {
  if (!reused) {
    createdThisRun.add(ptyId);
    return "running";
  }
  return createdThisRun.has(ptyId) ? "running" : "reconnected";
}

/** Test seam: forget which terminals this run created. */
export function resetAttachStatusForTests(): void {
  createdThisRun.clear();
}
