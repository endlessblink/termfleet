import { expect, test } from "@playwright/test";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

test("sessions panel exposes the reconnect agents control", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: "Sessions", exact: true }).click();

  const reconnect = page.getByTestId("sidebar-reconnect-agents");
  await expect(reconnect).toBeVisible();
  await expect(reconnect).toContainText("Reconnect agents");
  await expect(reconnect).toHaveAttribute(
    "title",
    "Available in the desktop app",
  );
});

test("reconnect button resumes a stopped agent in its original daemon session", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:5177/", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForLoadState("networkidle");

  await page.evaluate(async () => {
    const runtime = window as typeof window & {
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback: () => number;
        unregisterCallback: () => void;
      };
      __reconnectCalls?: Array<{
        cmd: string;
        args?: Record<string, unknown>;
      }>;
    };
    runtime.__reconnectCalls = [];
    runtime.__TAURI_INTERNALS__ = {
      invoke: async (cmd, args) => {
        runtime.__reconnectCalls?.push({ cmd, args });
        if (cmd === "pane_agent_provider") {
          return args?.paneId === "terminal-tab-reconnect-pane-running"
            ? "claude"
            : null;
        }
        if (cmd === "agent_status_read_sidecar") {
          return JSON.stringify({
            provider: "codex",
            sessionId: "019fae67-safe-session",
          });
        }
        if (cmd === "session_transcript_head_read") return "saved transcript";
        return null;
      },
      transformCallback: () => 1,
      unregisterCallback: () => {},
    };

    const { useWorkspaceStore } = await import("/src/stores/workspace.ts");
    useWorkspaceStore.setState((state) => ({
      ...state,
      activeTabId: null,
      tabs: [
        {
          id: "tab-reconnect",
          title: "Stopped agent",
          emoji: "[]",
          color: "#7aa2f7",
          groupId: null,
          terminals: [
            {
              id: "terminal-tab-reconnect-pane-original",
              paneId: "pane-original",
              cols: 80,
              rows: 24,
              status: "exited",
            },
            {
              id: "terminal-tab-reconnect-pane-running",
              paneId: "pane-running",
              cols: 80,
              rows: 24,
              status: "running",
            },
          ],
          splitLayout: {
            id: "split-reconnect",
            type: "split",
            direction: "horizontal",
            ratio: 0.5,
            first: { id: "pane-original", type: "terminal" },
            second: { id: "pane-running", type: "terminal" },
          },
          activePaneId: "pane-original",
        },
      ],
    }));
  });

  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await page.getByTestId("sidebar-reconnect-agents").click();

  await expect(page.getByTestId("sidebar-reconnect-agents-status")).toHaveText(
    "1 resumed · 1 already running",
  );
  await expect
    .poll(() =>
      page.evaluate(() => {
        const runtime = window as typeof window & {
          __reconnectCalls?: Array<{
            cmd: string;
            args?: Record<string, unknown>;
          }>;
        };
        return runtime.__reconnectCalls?.filter(
          ({ cmd }) => cmd === "daemon_write_session",
        );
      }),
    )
    .toEqual([
      {
        cmd: "daemon_write_session",
        args: {
          id: "terminal-tab-reconnect-pane-original",
          data: "exec codex resume 019fae67-safe-session\n",
        },
      },
    ]);
});
