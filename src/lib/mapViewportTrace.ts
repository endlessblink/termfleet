export interface MapViewport {
  x: number;
  y: number;
  zoom: number;
}

export type MapViewportTrigger =
  | "startup-offscreen-rescue"
  | "project-reveal"
  | "center-node"
  | "fit-active"
  | "reset-view"
  | "fit-all"
  | "wheel-zoom"
  | "toolbar-zoom-in"
  | "toolbar-zoom-out"
  | "manual-pan"
  | "sidebar-focus"
  | "header-focus"
  | "board-open"
  | "workspace-action";

export function createMapViewportTrace(
  writeLine: (line: string) => void,
  now: () => number = Date.now,
) {
  return (
    trigger: MapViewportTrigger,
    from: MapViewport,
    to: MapViewport,
  ): boolean => {
    if (from.x === to.x && from.y === to.y && from.zoom === to.zoom) return false;
    if (![from.x, from.y, from.zoom, to.x, to.y, to.zoom].every(Number.isFinite)) {
      return false;
    }
    try {
      writeLine(JSON.stringify({ t: now(), kind: "map-viewport-change", trigger, from, to }));
      return true;
    } catch {
      return false;
    }
  };
}
