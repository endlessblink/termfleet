// Regression suite for the Running/Waiting/Idle badge — one test per root cause found
// during the 2026-07-14/15 debugging marathon. If any of these fail, one of the badge
// lies (flashing, stale-Running, cross-view contradiction, click-to-update) is back.
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { reconcileSessionStatus, paneBadgeAttention } from "../src/lib/sessionStatus";
import { summaryFromSidecar } from "../src/lib/agentStatusSidecar";
import { selectStatusPollTargets } from "../src/lib/statusPollTargets";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

// ---------------------------------------------------------------------------
// 1. The badge must be a PURE EVENT translation — no clock, no scrollback.
//    (A time-based staleness rule flashed Running↔Idle as panes crossed the
//    threshold; scrollback markers flipped the badge when the user scrolled.)
// ---------------------------------------------------------------------------

test("sessionStatus has no clock or scrollback inputs (pure event state)", () => {
  const src = read("src/lib/sessionStatus.ts");
  expect(src).not.toMatch(/Date\.now\(/);
  expect(src).not.toMatch(/lastActivityAt|WORKING_STALE_MS|atRest|activelyRunning/);
  expect(src).not.toMatch(/terminalLooksActivelyWorking|terminalLooksAtRest|visibleText/);
});

test("same reported status always yields the same badge (cannot flash)", () => {
  for (let i = 0; i < 10; i++) {
    expect(reconcileSessionStatus({ summaryStatus: "working" }).attention).toBe("running");
    expect(reconcileSessionStatus({ summaryStatus: "waiting" }).attention).toBe("waiting");
    expect(reconcileSessionStatus({ summaryStatus: "idle" }).attention).toBe("idle");
  }
});

// ---------------------------------------------------------------------------
// 2. Every view must render the badge via the ONE shared computation on the
//    SAME store field — never a separately-stored value that can be dropped
//    (the stored badgeAttention field vanished when another writer replaced
//    the terminal object → flicker), and never a per-view recomputation from
//    different inputs (the "Running here, Idle there" contradiction).
// ---------------------------------------------------------------------------

test("all three views use paneBadgeAttention and never read a stored badge field", () => {
  for (const file of [
    "src/components/MagicCanvas.tsx",
    "src/components/SplitPane.tsx",
    "src/components/WorkbenchSidebar.tsx",
  ]) {
    const src = read(file);
    expect(src, `${file} must use the shared badge computation`).toMatch(/paneBadgeAttention\(/);
    expect(src, `${file} must not read a stored badge field`).not.toMatch(/\.badgeAttention\b/);
  }
});

test("paneBadgeAttention translates the pane's stored status directly", () => {
  expect(paneBadgeAttention({ statusSummary: { status: "working" } })).toBe("running");
  expect(paneBadgeAttention({ statusSummary: { status: "waiting" } })).toBe("waiting");
  expect(paneBadgeAttention({ statusSummary: { status: "done" } })).toBe("idle");
  expect(paneBadgeAttention(null)).toBe("idle");
  // Agent-lane fallback status is honored only when the pane has no stored status.
  expect(paneBadgeAttention(null, "working")).toBe("running");
  expect(paneBadgeAttention({ statusSummary: { status: "idle" } }, "working")).toBe("idle");
});

// ---------------------------------------------------------------------------
// 3. The hooks must write the explicit turn lifecycle, and the sidecar summary
//    must treat it as authoritative — this is what ends stale-Running: a Stop
//    event flips a pane to idle even when its in-progress todo was never
//    marked complete.
// ---------------------------------------------------------------------------

function runClaudeHook(dataDir: string, payload: Record<string, unknown>) {
  const res = spawnSync("node", [join(repo, "scripts/termfleet-claude-status-hook.mjs")], {
    input: JSON.stringify(payload),
    env: { ...process.env, XDG_DATA_HOME: dataDir, TERMFLEET_PANE_ID: "terminal-regress-1" },
    encoding: "utf8",
    timeout: 15_000,
  });
  expect(res.status).toBe(0);
}

test("Claude hook turn lifecycle: prompt→working, Stop→idle, Notification→waiting", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "tf-badge-regress-"));
  try {
    const sidecarDir = join(dataDir, "terminal-workspace", "agent-status");
    const readSidecar = () => {
      const file = readdirSync(sidecarDir).find((f) => f.startsWith("pane-"));
      expect(file).toBeTruthy();
      return JSON.parse(readFileSync(join(sidecarDir, String(file)), "utf8"));
    };
    runClaudeHook(dataDir, {
      hook_event_name: "UserPromptSubmit",
      prompt: "fix the login flow regression",
      cwd: "/tmp/regress",
      session_id: "s-regress",
    });
    expect(readSidecar().turn).toBe("working");
    runClaudeHook(dataDir, {
      hook_event_name: "Stop",
      transcript_path: "/nonexistent-transcript",
      cwd: "/tmp/regress",
      session_id: "s-regress",
    });
    expect(readSidecar().turn).toBe("idle");
    runClaudeHook(dataDir, {
      hook_event_name: "Notification",
      cwd: "/tmp/regress",
      session_id: "s-regress",
    });
    expect(readSidecar().turn).toBe("waiting");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("sidecar turn=idle beats an in-progress todo (stale-Running root cause)", () => {
  const fallback = {
    task: "x", path: "p", now: "n", status: "working", updatedAt: 0,
  } as never;
  const summary = summaryFromSidecar(
    {
      updatedAt: 123,
      turn: "idle",
      todos: [{ content: "still open", status: "in_progress", activeForm: "Still open" }],
    } as never,
    fallback,
  );
  expect(summary.status).toBe("idle");
  expect(paneBadgeAttention({ statusSummary: summary })).toBe("idle");
});

// ---------------------------------------------------------------------------
// 4. Background/finished panes must stay polled — the "I must click the
//    terminal to see its state" bug was panes with poll priority 0 whose
//    status was frozen forever.
// ---------------------------------------------------------------------------

test("background and finished panes remain poll targets", () => {
  const term = (id: string, status: string) => ({ id, paneId: id, status }) as never;
  const tab = (id: string, terminals: unknown[]) => ({ id, terminals }) as never;
  const targets = selectStatusPollTargets(
    [
      tab("active", [term("a1", "running")]),
      tab("bg-finished", [term("b1", "exited")]),
      tab("bg-live", [term("b2", "running")]),
    ] as never,
    "active",
    1_000_000,
  );
  const ids = targets.map((t) => t.terminal.id);
  expect(ids).toEqual(expect.arrayContaining(["a1", "b1", "b2"]));
});
