import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore } from "../stores/workspace";
import {
  emptyBoard,
  loadBoard,
  saveBoard,
  type BoardDocument,
} from "../lib/boardStore";

// A drawing board that lives on the operations map next to the terminal nodes.
//
// Two things make it behave on a pan/zoom surface:
//
// 1. Level of detail. Below `liveZoom` the board renders a cached still image
//    of the last saved scene, exactly like a terminal node falls back to its
//    cheap character preview. The editor bundle is only imported once a board
//    is actually close enough to draw on.
// 2. Zoom compensation. The map scales its contents with a CSS transform, but
//    a drawing tool reads the pointer straight off the screen. So the live
//    board is laid out at `size * mapZoom` and then counter-scaled by
//    `1 / mapZoom`, which makes one CSS pixel inside the editor equal one
//    screen pixel at any map zoom. The map's zoom is handed to the editor's own
//    zoom instead, so strokes still grow with the rest of the map and the pen
//    lands under the cursor.

const SAVE_DEBOUNCE_MS = 600;

type MenuComponent = React.ComponentType<{ children?: React.ReactNode }>;

type ExcalidrawModule = {
  Excalidraw: React.ComponentType<Record<string, unknown>>;
  exportToSvg: (opts: Record<string, unknown>) => Promise<SVGSVGElement>;
  // Supplying our own menu replaces the stock one, which is mostly links,
  // sign-in and collaboration — none of which belong on a local board.
  MainMenu: MenuComponent & {
    Item: React.ComponentType<Record<string, unknown>>;
    Separator: React.ComponentType;
    DefaultItems: {
      SaveAsImage: React.ComponentType;
      ClearCanvas: React.ComponentType;
      ChangeCanvasBackground: React.ComponentType;
    };
  };
};

type ExcalidrawApi = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  updateScene: (scene: Record<string, unknown>) => void;
  // Recomputes the editor's idea of where it sits on screen. It only does this
  // by itself when its own box changes size.
  refresh: () => void;
};

let modulePromise: Promise<ExcalidrawModule> | null = null;

function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      // Self-hosted fonts: this app has no network access at runtime, so the
      // editor must not reach for its CDN. See public/excalidraw/fonts.
      (
        window as unknown as { EXCALIDRAW_ASSET_PATH?: string }
      ).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
      await import("@excalidraw/excalidraw/index.css");
      // Our skin has to land after the editor's own stylesheet.
      await import("../styles/board.css");
      const mod =
        (await import("@excalidraw/excalidraw")) as unknown as ExcalidrawModule;
      return mod;
    })();
  }
  return modulePromise;
}

async function renderThumbnail(
  mod: ExcalidrawModule,
  elements: readonly unknown[],
  files: Record<string, unknown>,
): Promise<string | undefined> {
  if (!elements.length) return undefined;
  try {
    const svg = await mod.exportToSvg({
      elements,
      files,
      appState: { exportBackground: false, exportWithDarkMode: true },
      skipInliningFonts: true,
    });
    const markup = new XMLSerializer().serializeToString(svg);
    if (markup.length > 400_000) return undefined;
    return `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`;
  } catch {
    return undefined;
  }
}

interface BoardNodeProps {
  boardId: string;
  title: string;
  zoom: number;
  liveZoom: number;
  onActivate: () => void;
}

export function BoardNode({
  boardId,
  title,
  zoom,
  liveZoom,
  onActivate,
}: BoardNodeProps) {
  const live = zoom >= liveZoom;
  const panX = useWorkspaceStore((state) => state.canvasState.viewport.x);
  const panY = useWorkspaceStore((state) => state.canvasState.viewport.y);
  const [mod, setMod] = useState<ExcalidrawModule | null>(null);
  const [document, setDocument] = useState<BoardDocument | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const apiRef = useRef<ExcalidrawApi | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const saveTimerRef = useRef<number | null>(null);
  const appliedMapZoomRef = useRef(zoom);
  const documentRef = useRef<BoardDocument | null>(null);
  const pendingSceneRef = useRef<{
    elements: unknown[];
    files: Record<string, unknown>;
    appState: Record<string, unknown>;
  } | null>(null);

  documentRef.current = document;

  // The saved scene is needed in both modes: live it seeds the editor, idle it
  // supplies the cached still image.
  useEffect(() => {
    let cancelled = false;
    loadBoard(boardId).then((loaded) => {
      if (!cancelled) setDocument(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [boardId]);

  useEffect(() => {
    if (!live || mod) return;
    let cancelled = false;
    loadExcalidraw()
      .then((loaded) => {
        if (!cancelled) setMod(loaded);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [live, mod]);

  // Measured rather than passed in: the card's header height and any future
  // chrome stay the map's business, not the board's.
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setBox({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [live]);

  const flushSave = useCallback(async () => {
    const pending = pendingSceneRef.current;
    const activeModule = mod;
    if (!pending || !activeModule) return;
    const next: BoardDocument = {
      ...(documentRef.current ?? emptyBoard()),
      elements: pending.elements,
      files: pending.files,
      appState: pending.appState,
      thumbnail: await renderThumbnail(
        activeModule,
        pending.elements,
        pending.files,
      ),
    };
    documentRef.current = next;
    setDocument(next);
    await saveBoard(boardId, next).catch(() => undefined);
  }, [boardId, mod]);

  // The scene is captured at change time, never read back at save time. A save
  // can land while the editor is being torn down (the board scrolled off, or
  // the map zoomed out), and a torn-down editor reports an empty scene — which
  // would happily overwrite a real drawing with nothing.
  const scheduleSave = useCallback(
    (
      elements: readonly unknown[],
      appState: Record<string, unknown>,
      files: Record<string, unknown>,
    ) => {
      pendingSceneRef.current = {
        elements: [...elements],
        files: { ...files },
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        },
      };
      if (saveTimerRef.current !== null)
        window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = window.setTimeout(() => {
        saveTimerRef.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  // Save whatever is pending when the board stops being live (zoomed away from,
  // culled off-screen, or the map unmounts).
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        void flushSave();
      }
    },
    [flushSave],
  );

  // Panning the map slides the board across the screen without changing its
  // size, and the editor only recomputes its screen offsets when its own box
  // resizes. Left alone it keeps using the offsets from where the board was
  // when it mounted, so every click lands wrong by however far the map has been
  // panned since. Nudge it whenever the map viewport moves, and on any window
  // resize that could shift the surrounding chrome.
  useEffect(() => {
    apiRef.current?.refresh();
  }, [panX, panY, zoom, box.width, box.height, live]);

  // There are too many ways for a board to slide across the screen without
  // resizing — panning, dragging the card, collapsing a sidebar, moving the
  // window, a neighbouring panel reflowing — to enumerate them all as events.
  // Watching the board's own on-screen position catches every one of them for
  // the cost of a rect read a few times a second.
  useEffect(() => {
    if (!live) return;
    let lastLeft = Number.NaN;
    let lastTop = Number.NaN;
    const check = () => {
      const shell = shellRef.current;
      if (!shell) return;
      const rect = shell.getBoundingClientRect();
      if (
        Math.abs(rect.left - lastLeft) < 0.5 &&
        Math.abs(rect.top - lastTop) < 0.5
      )
        return;
      lastLeft = rect.left;
      lastTop = rect.top;
      apiRef.current?.refresh();
    };
    const timer = window.setInterval(check, 200);
    window.addEventListener("resize", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", check);
    };
  }, [live]);

  // Keep the editor's own zoom locked to the map's, preserving any zooming the
  // user has done inside the board.
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const previous = appliedMapZoomRef.current || 1;
    if (previous === zoom) return;
    const current =
      (api.getAppState().zoom as { value?: number } | undefined)?.value ?? 1;
    appliedMapZoomRef.current = zoom;
    api.updateScene({
      appState: { zoom: { value: (current * zoom) / previous } },
    });
  }, [zoom]);

  // Derived on every render on purpose, not memoised: the editor only reads
  // this when it mounts, and it mounts again every time the board comes back
  // from the zoomed-out preview. A cached copy would re-seed the editor with
  // whatever the board held on first load — and then save that over the real
  // drawing.
  const initialData = (() => {
    if (!document) return null;
    return {
      elements: document.elements,
      appState: {
        // Sharp lines and a plain font by default: the hand-drawn look reads as
        // a toy next to the terminals.
        currentItemRoughness: 0,
        currentItemFontFamily: 2,
        ...document.appState,
        zoom: { value: zoom },
        viewModeEnabled: false,
      },
      files: document.files ?? {},
      scrollToContent: true,
    };
  })();

  if (!live) {
    return (
      <button
        type="button"
        style={styles.previewShell}
        onClick={onActivate}
        title={`${title} — zoom in to draw`}
        data-testid="canvas-board-preview"
      >
        {document?.thumbnail ? (
          <img
            src={document.thumbnail}
            alt={`${title} drawing`}
            style={styles.previewImage}
          />
        ) : (
          <span style={styles.previewEmpty}>Empty board</span>
        )}
        <span style={styles.previewHint}>Zoom in to draw</span>
      </button>
    );
  }

  const Excalidraw = mod?.Excalidraw;
  const MainMenu = mod?.MainMenu;
  const compensated = zoom || 1;
  const ready = Boolean(
    Excalidraw && MainMenu && initialData && box.width > 0 && box.height > 0,
  );

  return (
    <div
      ref={shellRef}
      className="termfleet-board"
      style={styles.liveShell}
      data-testid="canvas-board-live"
      // Belt and braces for every other way a board can move without resizing —
      // dragging the node, collapsing a sidebar, moving the window. The pointer
      // always enters the board before it draws on it, so this is the last
      // chance to correct the editor's screen offsets, and it is cheap.
      onPointerEnter={() => apiRef.current?.refresh()}
      onPointerDown={(event) => {
        event.stopPropagation();
        onActivate();
      }}
      onWheel={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {loadError ? (
        <div style={styles.previewEmpty}>Drawing board failed to load</div>
      ) : !ready || !Excalidraw || !MainMenu ? (
        <div style={styles.previewEmpty}>Loading board…</div>
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: box.width * compensated,
            height: box.height * compensated,
            transform: `scale(${1 / compensated})`,
            transformOrigin: "top left",
          }}
        >
          <Excalidraw
            initialData={initialData}
            theme="dark"
            excalidrawAPI={(api: ExcalidrawApi) => {
              apiRef.current = api;
              appliedMapZoomRef.current = zoom;
            }}
            onChange={(
              elements: readonly unknown[],
              appState: Record<string, unknown>,
              files: Record<string, unknown>,
            ) => scheduleSave(elements, appState, files)}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                // No cloud, no accounts: this board is a local file on the map.
                saveAsImage: true,
                export: false,
              },
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ClearCanvas />
            </MainMenu>
          </Excalidraw>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  previewShell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    height: "100%",
    padding: 12,
    background: "var(--surface-raised, rgba(20,22,28,0.9))",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    overflow: "hidden",
  },
  previewImage: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    pointerEvents: "none",
  },
  previewEmpty: {
    fontSize: 13,
    opacity: 0.6,
  },
  previewHint: {
    fontSize: 11,
    opacity: 0.4,
  },
  liveShell: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
  },
};
