// Files dragged from the file manager onto a chat box in the Agents view (Noam
// 2026-10-23: "want to drag these here"). The desktop engine hides dropped files from
// the page (only the first address leaks, as text), so the app catches the drop itself,
// where every file's place on the PC is known, and tells the chat page where it landed.
import { getCurrentWebview } from "@tauri-apps/api/webview";

export const AGENTS_ORIGIN = "http://127.0.0.1:7810";

export type FileDropPayload =
  | { type: "enter"; paths: string[]; position: { x: number; y: number } }
  | { type: "over"; position: { x: number; y: number } }
  | { type: "drop"; paths: string[]; position: { x: number; y: number } }
  | { type: "leave" };

export type ForwardedDrop = { termfleetDrop: FileDropPayload["type"]; x: number; y: number; paths: string[] };

/** The drop as the chat page sees it: a point inside the frame, plus the files. */
export function dropMessage(payload: FileDropPayload, frame: { left: number; top: number }, pixelRatio: number): ForwardedDrop {
  const ratio = pixelRatio > 0 ? pixelRatio : 1;
  const at = "position" in payload ? payload.position : { x: -1, y: -1 };
  return {
    termfleetDrop: payload.type,
    x: at.x / ratio - frame.left,
    y: at.y / ratio - frame.top,
    paths: "paths" in payload ? payload.paths.slice(0, 10) : [],
  };
}

/** Passes the app's file drops to the chat page in the frame; returns a stop function. */
export function forwardFileDrops(frame: () => HTMLIFrameElement | null): () => void {
  let stop: (() => void) | null = null;
  let stopped = false;
  let webview: ReturnType<typeof getCurrentWebview>;
  try {
    webview = getCurrentWebview();
  } catch {
    return () => {}; // browser preview: no desktop app around the page
  }
  webview
    .onDragDropEvent((event) => {
      const target = frame();
      if (!target?.contentWindow) return;
      const rect = target.getBoundingClientRect();
      target.contentWindow.postMessage(dropMessage(event.payload as FileDropPayload, rect, window.devicePixelRatio), AGENTS_ORIGIN);
    })
    .then((unlisten) => {
      if (stopped) unlisten();
      else stop = unlisten;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    stop?.();
  };
}
