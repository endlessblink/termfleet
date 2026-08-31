import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("dock startup restores only the durable saved pane graph", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  const launcher = readFileSync(
    new URL("../scripts/termfleet-desktop-launcher.sh", import.meta.url),
    "utf8",
  );

  expect(app).toContain("await hydrateWorkspace()");
  expect(app).toContain("await reconnectSavedAgentPanes(");

  // Order inside the startup queue, not order of definition in the file: the
  // durable layout must be hydrated before anything tries to reconnect a pane,
  // or recovery runs against tabs that do not exist yet.
  const startupQueue =
    app.match(/reconciliationQueue = reconciliationQueue\.then\(async \(\) => \{[\s\S]*?\n    \}\);/)?.[0] ?? "";
  expect(startupQueue).toContain("await hydrateWorkspace()");
  expect(startupQueue).toContain("await reconnectPendingOwners()");
  expect(startupQueue.indexOf("await hydrateWorkspace()")).toBeLessThan(
    startupQueue.indexOf("await reconnectPendingOwners()"),
  );
  expect(app).not.toContain("recoverSavedAgentPanes");
  expect(launcher).not.toContain("agent-fleet/restore.py");
  expect(launcher).not.toContain("TERMFLEET_EXTERNAL_RESTORE");
});

test("the proven daemon path selects recovery by stable pane id and exact conversation id", () => {
  const terminal = readFileSync(
    new URL("../src/components/Terminal.tsx", import.meta.url),
    "utf8",
  );
  const daemon = readFileSync(
    new URL("../src-tauri/src/pty.rs", import.meta.url),
    "utf8",
  );

  expect(terminal).toContain("`terminal-${tabId}-${paneId}`");
  expect(daemon).toContain("read_pane_sidecar_recovery(&id)");
  expect(daemon).toContain('format!("codex resume {}", shell_quote_arg(session_id))');
  expect(daemon).toContain('format!("claude --resume {}", shell_quote_arg(session_id))');
  expect(daemon).not.toContain("resume --last");
  expect(daemon).not.toContain("claude --continue");
});

test("automatic live reconciliation never creates unsaved recovered tabs", () => {
  const workspace = readFileSync(
    new URL("../src/stores/workspace.ts", import.meta.url),
    "utf8",
  );
  const liveOnly = workspace.slice(
    workspace.indexOf("export async function reconcileLiveWorkspace"),
    workspace.indexOf("export async function createNewTab"),
  );

  expect(liveOnly).not.toContain("tabFromRecoverableSession");
  expect(liveOnly).not.toContain("recovered.push");
});
