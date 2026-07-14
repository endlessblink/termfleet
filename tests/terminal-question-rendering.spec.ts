import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const HEADER = 17;
const CELL = 14;
const FG = 0xf1f1f1ff;
const MUTED = 0x9da3aaff;
const BG = 0x000000ff;
const MODE_CURSOR_VISIBLE = 1 << 1;
const MODE_MOUSE_REPORT = 1 << 5;

function encodeGridFrame(params: {
  cols: number;
  rows: number;
  lines: string[];
  mode?: number;
}): ArrayBuffer {
  const dirty = Array.from({ length: params.rows }, (_, row) => {
    const text = params.lines[row] ?? "";
    const muted = row === 3 || row === 5;
    const cells = Array.from({ length: params.cols }, (_, col) => ({
      ch: text.codePointAt(col) ?? 0,
      fg: muted ? MUTED : FG,
      bg: BG,
      style: 0,
    }));
    return { index: row, cells };
  });
  let size = HEADER;
  for (const row of dirty) size += 4 + row.cells.length * CELL;
  const view = new DataView(new ArrayBuffer(size));
  view.setUint8(0, 2);
  view.setUint16(1, params.cols, true);
  view.setUint16(3, params.rows, true);
  view.setUint16(5, 0, true);
  view.setUint16(7, 0, true);
  view.setUint16(9, Math.min(params.rows - 1, params.lines.length), true);
  view.setUint32(11, params.mode ?? MODE_CURSOR_VISIBLE, true);
  view.setUint16(15, dirty.length, true);
  let offset = HEADER;
  for (const row of dirty) {
    view.setUint16(offset, row.index, true);
    view.setUint16(offset + 2, row.cells.length, true);
    offset += 4;
    for (const cell of row.cells) {
      view.setUint32(offset, cell.ch, true);
      view.setUint32(offset + 4, cell.fg, true);
      view.setUint32(offset + 8, cell.bg, true);
      view.setUint16(offset + 12, cell.style, true);
      offset += CELL;
    }
  }
  return view.buffer;
}

const questionLines = [
  "Auth",
  "How should the extension authenticate to your arthouse backend?",
  "› 1. Static API token you paste in (Recommended)",
  "     Arthouse Settings generates a long-lived bearer token; you paste it once.",
  "› 2. Reuse arthouse login session",
  "     Extension background page calls the arthouse API with your existing session.",
  "  3. Type something.",
];

test.use({
  viewport: { width: 1274, height: 692 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("AskUserQuestion primary-screen prompts do not trigger map projection resizes", () => {
  const terminalCanvas = readFileSync("src/components/TerminalCanvas.tsx", "utf8");
  const projectionGuard = terminalCanvas.match(/const preservesProjectionSize = \(\) =>[\s\S]*?;\n\n    channel\.onmessage/)?.[0] ?? "";

  expect(projectionGuard).toContain("modesRef.current.altScreen");
  expect(projectionGuard).not.toContain("modesRef.current.mouseReport");
  expect(projectionGuard).not.toContain("modesRef.current.sgrMouse");
  expect(projectionGuard).not.toContain("modesRef.current.alternateScroll");
  expect(terminalCanvas).toMatch(/AskUserQuestion-style primary-screen\s+\/\/ prompts/);
});

test("AskUserQuestion fixture renders stable prompt and option rows on the canvas renderer", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const result = await page.evaluate(async (questionLines) => {
    const { GlyphAtlas, measureCell } = await import("/src/lib/fontAtlas.ts");
    const { DEFAULT_THEME, renderSnapshot, sizeCanvasToGrid } = await import("/src/lib/gridRenderer.ts");

    const cols = 104;
    const rows = 18;
    const fg = "#f1f1f1";
    const muted = "#9da3aa";
    const bg = "#000000";
    const cells = Array.from({ length: rows }, (_, row) => {
      const text = questionLines[row] ?? "";
      return Array.from({ length: cols }, (_, col) => {
        const c = text[col] ?? " ";
        return { c, fg: row === 3 || row === 5 ? muted : fg, bg };
      });
    });
    const snapshot = {
      cols,
      rows,
      displayOffset: 0,
      cursor: { col: 0, line: 7 },
      cursorVisible: false,
      altScreen: false,
      cells,
    };
    const text = snapshot.cells.map((row) => row.map((cell) => cell.c).join("").trimEnd()).join("\n");

    const dpr = 2;
    const metrics = measureCell('"Hack", "JetBrains Mono", monospace', 14, dpr, 1.2);
    const atlas = new GlyphAtlas(metrics);
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const ctx = sizeCanvasToGrid(canvas, atlas, cols, rows, dpr);
    renderSnapshot(ctx, atlas, snapshot, dpr, DEFAULT_THEME);

    const cellH = Math.round(atlas.cellHeight * dpr);
    const rowInk = questionLines.map((_, row) => {
      const y = row * cellH;
      const pixels = ctx.getImageData(0, y, canvas.width, cellH).data;
      let ink = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        if (r > 80 || g > 80 || b > 80) ink += 1;
      }
      return ink;
    });

    const option1Count = (text.match(/Static API token you paste in \(Recommended\)/g) ?? []).length;
    const option2Count = (text.match(/Reuse arthouse login session/g) ?? []).length;
    const lineCount = text.split("\n").filter((line) => line.trim()).length;

    return {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      rowInk,
      lineCount,
      option1Count,
      option2Count,
      hasQuestion: text.includes("How should the extension authenticate to your arthouse backend?"),
    };
  }, questionLines);

  expect(result.canvasWidth).toBeGreaterThan(1200);
  expect(result.canvasHeight).toBeGreaterThan(500);
  expect(result.hasQuestion).toBe(true);
  expect(result.option1Count).toBe(1);
  expect(result.option2Count).toBe(1);
  expect(result.lineCount).toBe(7);
  for (const ink of result.rowInk) {
    expect(ink).toBeGreaterThan(20);
  }
});

test("AskUserQuestion prompt renders through the mounted map TerminalCanvas stream", async ({ page }) => {
  const frame = encodeGridFrame({
    cols: 104,
    rows: 18,
    lines: questionLines,
    mode: MODE_CURSOR_VISIBLE | MODE_MOUSE_REPORT,
  });
  await page.addInitScript((frameBytes) => {
    let callbackId = 1;
    const callbacks = new Map<number, (message: unknown) => void>();
    const frame = new Uint8Array(frameBytes).buffer;
    (window as typeof window & { __TAURI_INTERNALS__?: Record<string, unknown> }).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      callbacks,
      transformCallback(callback: unknown) {
        const id = callbackId++;
        callbacks.set(id, callback as (message: unknown) => void);
        return id;
      },
      unregisterCallback(id: number) {
        callbacks.delete(id);
      },
      async invoke(command: string, args?: Record<string, unknown>) {
        if (command === "daemon_status") return { reachable: true, mode: "mock" };
        if (command === "daemon_ensure_running") return { reachable: true, mode: "mock", message: "mock" };
        if (command === "daemon_ensure_session") return { id: String(args?.id ?? "pty-question"), reused: false, cols: 104, rows: 18 };
        if (command === "grid_attach") return null;
        if (command === "grid_scroll_to_bottom") return null;
        if (command === "daemon_resize_session") return null;
        if (command === "grid_resize") return null;
        if (command === "daemon_write_session") return null;
        if (command === "set_focused_terminal") return null;
        if (command === "daemon_list_session_events") return [];
        if (command === "grid_snapshot") {
          return JSON.stringify({
            cols: 104,
            rows: 18,
            displayOffset: 0,
            cursor: { col: 0, line: 7 },
            cursorVisible: true,
            altScreen: false,
            cells: [],
          });
        }
        if (command === "grid_subscribe_diffs") {
          const channel = args?.onDiff as { id?: number } | undefined;
          if (typeof channel?.id === "number") {
            window.setTimeout(() => callbacks.get(channel.id)?.({ index: 0, message: frame }), 0);
          }
          return null;
        }
        if (command === "fs_read_file") return "";
        return null;
      },
      convertFileSrc(path: string) {
        return path;
      },
    };
  }, Array.from(new Uint8Array(frame)));

  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");

  await page.evaluate(() => {
    type Store = {
      getState: () => { workspaceUiState: Record<string, unknown> };
      setState: (state: Record<string, unknown>) => void;
    };
    const store = (window as typeof window & { __termfleetWorkspaceStore?: Store }).__termfleetWorkspaceStore;
    if (!store) throw new Error("TermFleet test store is unavailable");
    const group = {
      id: "group-arthouse",
      name: "arthouse",
      color: "#d69a2d",
      projectRoot: "/media/endlessblink/data/my-projects/ai-development/content-creation/arthouse",
      lastActiveTabId: "tab-question",
    };
    store.setState({
      workspaceUiState: {
        ...store.getState().workspaceUiState,
        workspaceMode: "canvas",
        primarySidebarCollapsed: true,
        canvasSidebarCollapsed: true,
      },
      groups: [group],
      terminalGroups: [group],
      activeGroupFilter: null,
      projectRoot: group.projectRoot,
      activeTabId: "tab-question",
      activeTerminalId: "pty-question",
      hydrating: false,
      canvasState: {
        selectedNodeId: "node-question",
        selectedNodeIds: ["node-question"],
        viewport: { x: 40, y: 40, zoom: 1 },
        nodes: [{
          id: "node-question",
          type: "terminal",
          title: "Terminal",
          terminalTabId: "tab-question",
          x: 40,
          y: 40,
          width: 980,
          height: 520,
        }],
      },
      tabs: [{
        id: "tab-question",
        title: "Terminal",
        emoji: "[]",
        color: "#d69a2d",
        groupId: group.id,
        initialCwd: group.projectRoot,
        terminals: [{
          id: "pty-question",
          paneId: "pane-question",
          cols: 104,
          rows: 18,
          status: "running",
          taskLineup: [{
            id: "question-task",
            content: "Answering authentication question",
            status: "in_progress",
            source: "todo-write",
            updatedAt: 1000,
          }],
          statusSummary: {
            task: "Asking clarifying questions",
            path: "content-creation/arthouse",
            now: "Using AskUserQuestion",
            status: "working",
            provider: "shell",
            confidence: "high",
            tasksFromTodoWrite: true,
          },
        }],
        splitLayout: { id: "pane-question", type: "terminal" },
        activePaneId: "pane-question",
      }],
    });
  });

  const node = page.getByTestId("canvas-terminal-node").filter({ hasText: "arthouse" });
  await expect(node.getByTestId("canvas-terminal-node-workspace")).toHaveText("arthouse");
  await expect(node.getByTestId("canvas-terminal-node-description")).toHaveText("Answering authentication question");
  await expect(node.getByTestId("canvas-terminal-node-header-title")).toHaveText("Answering authentication question");
  await expect(node.getByTestId("canvas-terminal-node-now")).toHaveText("Using AskUserQuestion");

  const canvas = node.locator("canvas.terminal-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(async () => canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index];
      const g = pixels[index + 1];
      const b = pixels[index + 2];
      if (r > 80 || g > 80 || b > 80) ink += 1;
    }
    return ink;
  })).toBeGreaterThan(1000);

  await node.screenshot({ path: "/tmp/termfleet-ask-user-question-map-terminal.png" });
});
