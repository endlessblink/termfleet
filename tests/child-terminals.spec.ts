import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  childLinkSegments,
  childStartupCommand,
  MAX_CHILDREN_PER_PARENT,
  requestIdOf,
  parseChildRequest,
  parseRuntimePaneId,
  planChildLaunch,
} from "../src/lib/childTerminals";
import type { CanvasNode } from "../src/lib/types";

// FEATURE-64: a parent agent's request becomes a visible child terminal only when
// it is well-formed, names a pane that is open right now, and is not a repeat.
const tabId = "11111111-1111-4111-8111-111111111111";
const paneId = "22222222-2222-4222-8222-222222222222";
const parentPaneId = `terminal-${tabId}-${paneId}`;
const now = 1_800_000_000_000;
const good = {
  version: 1,
  requestId: "req-0001-abcd",
  parentPaneId,
  provider: "claude",
  task: "Write tests for the export dialog",
  createdAt: now - 1000,
};
const size = { width: 600, height: 400 };
const parentNode = {
  id: `terminal-map-${tabId}`,
  type: "terminal",
  title: "parent",
  x: 100,
  y: 100,
  width: 600,
  height: 400,
  terminalTabId: tabId,
} as CanvasNode;
const parentTab = { id: tabId, groupId: null, initialCwd: "/work" };

test("the pane id every terminal carries names its tab and pane", () => {
  expect(parseRuntimePaneId(parentPaneId)).toEqual({ tabId, paneId });
  expect(parseRuntimePaneId("terminal-abc")).toBeNull();
  expect(parseRuntimePaneId(undefined)).toBeNull();
});

test("a well-formed request is accepted", () => {
  const parsed = parseChildRequest(JSON.stringify(good), now);
  expect(parsed.ok).toBe(true);
});

test("malformed, stale, or unsafe requests are refused with a reason", () => {
  const cases: Array<[Record<string, unknown> | string, string]> = [
    ["{not json", "not-json"],
    [{ ...good, version: 2 }, "unsupported-version"],
    [{ ...good, requestId: "../../etc" }, "bad-request-id"],
    [{ ...good, parentPaneId: "pane-1" }, "bad-parent-pane-id"],
    [{ ...good, provider: "bash -c rm" }, "unsupported-provider"],
    [{ ...good, task: "   " }, "missing-task"],
    [{ ...good, task: "x".repeat(2001) }, "task-too-long"],
    [{ ...good, cwd: "relative/dir" }, "bad-cwd"],
    [{ ...good, createdAt: now - 10 * 60_000 }, "expired"],
  ];
  for (const [value, reason] of cases) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    expect(parseChildRequest(raw, now), reason).toEqual({ ok: false, reason });
  }
});

test("a request from a pane that is not open is refused", () => {
  const parsed = parseChildRequest(JSON.stringify(good), now);
  if (!parsed.ok) throw new Error("fixture");
  expect(planChildLaunch({ request: parsed.request, tabs: [], nodes: [], size })).toEqual({
    ok: false,
    reason: "unknown-parent",
  });
});

test("the child card goes beside its parent and covers nothing", () => {
  const parsed = parseChildRequest(JSON.stringify(good), now);
  if (!parsed.ok) throw new Error("fixture");
  const plan = planChildLaunch({ request: parsed.request, tabs: [parentTab], nodes: [parentNode], size });
  if (!plan.ok) throw new Error(plan.reason);
  expect(plan.link).toEqual({ parentPaneId, parentTabId: tabId, requestId: good.requestId });
  expect(plan.placement.y).toBe(parentNode.y);
  expect(plan.placement.x).toBeGreaterThan(parentNode.x + parentNode.width);
});

test("the same request never launches twice, and a parent has a child limit", () => {
  const parsed = parseChildRequest(JSON.stringify(good), now);
  if (!parsed.ok) throw new Error("fixture");
  const child = (requestId: string) => ({
    id: requestId,
    groupId: null,
    childOf: { parentPaneId, parentTabId: tabId, requestId },
  });
  expect(
    planChildLaunch({
      request: parsed.request,
      tabs: [parentTab, child(good.requestId)] as never,
      nodes: [parentNode],
      size,
    }),
  ).toEqual({ ok: false, reason: "duplicate-request" });
  const many = Array.from({ length: MAX_CHILDREN_PER_PARENT }, (_, index) => child(`other-${index}`));
  expect(
    planChildLaunch({ request: parsed.request, tabs: [parentTab, ...many] as never, nodes: [parentNode], size }),
  ).toEqual({ ok: false, reason: "too-many-children" });
});

test("the map draws one edge-to-edge line from a parent card to each of its children", () => {
  const childTabId = "33333333-3333-4333-8333-333333333333";
  const childNode = { ...parentNode, id: `terminal-map-${childTabId}`, x: 740, terminalTabId: childTabId } as CanvasNode;
  const tabs = [
    { id: tabId },
    { id: childTabId, childOf: { parentPaneId, parentTabId: tabId, requestId: "req-0001-abcd" } },
    { id: "orphan", childOf: { parentPaneId, parentTabId: "gone", requestId: "req-0002-abcd" } },
  ];
  expect(childLinkSegments(tabs as never, [parentNode, childNode])).toEqual([
    { id: childTabId, x1: 700, y1: 300, x2: 740, y2: 300 },
  ]);
});

test("a rejected request still names its id so the waiting command hears back", () => {
  expect(requestIdOf(JSON.stringify({ ...good, provider: "nope" }))).toBe(good.requestId);
  expect(requestIdOf("not json")).toBeNull();
  expect(requestIdOf(JSON.stringify({ requestId: "../../etc" }))).toBeNull();
});

const CLI = join(process.cwd(), "scripts", "termfleet-child.mjs");

function runCli(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const done = new Promise<number>((resolveExit) => child.on("close", (code) => resolveExit(code ?? -1)));
  return { done: async () => ({ code: await done, stdout, stderr }) };
}

test("the spawn command hands a request to the app and prints the app's answer", async () => {
  const dataHome = mkdtempSync(join(tmpdir(), "tf-child-"));
  const dir = join(dataHome, "terminal-workspace", "child-requests");
  const run = runCli(["spawn", "--provider", "claude", "--task", "Write tests", "--cwd", "/work", "--timeout", "10"], {
    XDG_DATA_HOME: dataHome,
    TERMFLEET_PANE_ID: parentPaneId,
  });
  let requestFile: string | undefined;
  for (let i = 0; i < 80 && !requestFile; i += 1) {
    requestFile = existsSync(dir) ? readdirSync(dir).find((name) => name.endsWith(".request.json")) : undefined;
    if (!requestFile) await new Promise((wait) => setTimeout(wait, 50));
  }
  if (!requestFile) throw new Error("no request written");
  const raw = readFileSync(join(dir, requestFile), "utf8");
  const parsed = parseChildRequest(raw);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.request).toMatchObject({ parentPaneId, provider: "claude", task: "Write tests", cwd: "/work" });
  writeFileSync(
    join(dir, `${parsed.request.requestId}.result.json`),
    JSON.stringify({ requestId: parsed.request.requestId, ok: true, childPaneId: "terminal-x-y" }),
  );
  const { code, stdout } = await run.done();
  expect(code).toBe(0);
  expect(JSON.parse(stdout)).toMatchObject({ ok: true, childPaneId: "terminal-x-y" });
  expect(readdirSync(dir)).toEqual([requestFile]);
  rmSync(dataHome, { recursive: true, force: true });
});

test("a request nobody picks up is withdrawn, so no terminal pops up later by surprise", async () => {
  const dataHome = mkdtempSync(join(tmpdir(), "tf-child-"));
  const { code, stderr } = await runCli(["spawn", "--provider", "shell", "--task", "ls", "--timeout", "0.5"], {
    XDG_DATA_HOME: dataHome,
    TERMFLEET_PANE_ID: parentPaneId,
  }).done();
  expect(code).toBe(2);
  expect(stderr).toContain("did not pick up");
  expect(readdirSync(join(dataHome, "terminal-workspace", "child-requests"))).toEqual([]);
  rmSync(dataHome, { recursive: true, force: true });
});

test("the spawn command refuses to run outside a TermFleet terminal", async () => {
  const { code, stderr } = await runCli(["spawn", "--provider", "shell", "--task", "ls"], { TERMFLEET_PANE_ID: "" }).done();
  expect(code).toBe(1);
  expect(stderr).toContain("not running inside a TermFleet terminal");
});

test("a helper starts its agent on the task, then stays a usable terminal", () => {
  expect(childStartupCommand("claude", "Fix the dialog")).toBe(`claude 'Fix the dialog'; exec "\${SHELL:-bash}" -l`);
  expect(childStartupCommand("codex", "it's done")).toBe(`codex 'it'\\''s done'; exec "\${SHELL:-bash}" -l`);
  expect(childStartupCommand("opencode", "x")).toBe(`opencode --prompt 'x'; exec "\${SHELL:-bash}" -l`);
  expect(childStartupCommand("shell", "echo hi")).toBe(`echo hi; exec "\${SHELL:-bash}" -l`);
});
