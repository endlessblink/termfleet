import { invoke } from "@tauri-apps/api/core";

// Drawing boards live on disk as plain `.excalidraw` JSON next to the rest of
// the workspace state. Plain JSON on a known path is deliberate: an agent
// running in one of the terminals can write the same file, and the panel picks
// the change up on its next load.
export interface BoardDocument {
  type: "excalidraw";
  version: number;
  source: string;
  elements: unknown[];
  appState: Record<string, unknown>;
  files?: Record<string, unknown>;
  // Cached still image of the last saved scene. The map renders this when it is
  // zoomed too far out to run the live editor, so the heavy editor bundle never
  // loads for a board you are only flying past.
  thumbnail?: string;
}

const BOARD_SOURCE = "termfleet";
const BROWSER_KEY_PREFIX = "termfleet.board.";

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function emptyBoard(): BoardDocument {
  return {
    type: "excalidraw",
    version: 2,
    source: BOARD_SOURCE,
    elements: [],
    appState: {},
  };
}

function sanitizeBoardId(boardId: string) {
  return boardId.replace(/[^A-Za-z0-9._-]/g, "-");
}

let boardsDirPromise: Promise<string> | null = null;

async function boardsDir(): Promise<string> {
  if (!boardsDirPromise) {
    boardsDirPromise = (async () => {
      const home = await invoke<string>("fs_home_dir");
      const dir = `${home}/.local/share/terminal-workspace/boards`;
      // fs_create with is_dir creates parents and is a no-op when it exists.
      await invoke("fs_create", { path: dir, isDir: true }).catch(
        () => undefined,
      );
      return dir;
    })();
  }
  return boardsDirPromise;
}

export async function boardFilePath(boardId: string): Promise<string> {
  return `${await boardsDir()}/${sanitizeBoardId(boardId)}.excalidraw`;
}

function parseBoard(raw: string | null | undefined): BoardDocument | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<BoardDocument>;
    if (!parsed || !Array.isArray(parsed.elements)) return null;
    return {
      ...emptyBoard(),
      ...parsed,
      elements: parsed.elements,
      appState: (parsed.appState as Record<string, unknown>) ?? {},
    };
  } catch {
    return null;
  }
}

export async function loadBoard(boardId: string): Promise<BoardDocument> {
  if (!isTauriRuntime()) {
    const raw = window.localStorage.getItem(`${BROWSER_KEY_PREFIX}${boardId}`);
    return parseBoard(raw) ?? emptyBoard();
  }
  try {
    const raw = await invoke<string>("fs_read_file", {
      path: await boardFilePath(boardId),
    });
    return parseBoard(raw) ?? emptyBoard();
  } catch {
    // Missing file just means the board has never been drawn on.
    return emptyBoard();
  }
}

export async function saveBoard(
  boardId: string,
  document: BoardDocument,
): Promise<void> {
  const contents = JSON.stringify(document);
  if (!isTauriRuntime()) {
    try {
      window.localStorage.setItem(`${BROWSER_KEY_PREFIX}${boardId}`, contents);
    } catch {
      // Browser preview only; a full quota is not worth surfacing.
    }
    return;
  }
  await invoke("fs_write_file", {
    path: await boardFilePath(boardId),
    contents,
  });
}
