// "Approve all" (operator request 2026-09-23, always ask first). The dangerous failure
// is typing "y"/"1" into a pane whose question is gone — straight into a chat box.
import { test, expect } from "@playwright/test";
import {
  approvalKey,
  approvalPromptOnScreen,
  approvalRisk,
  approveAll,
  approveOne,
  isApprovable,
  type ApproveDeps,
} from "../src/lib/approveAll";
import type { PendingApprovalItem } from "../src/lib/pendingApprovals";

const CODEX_PROMPT = [
  "• Running scp -q src/server.js root@84.46.253.137:/opt/bot/src/",
  "Would you like to run the following command?",
  "Reason: May I stage the tested files on the VPS?",
  "$ scp -q src/server.js root@84.46.253.137:/opt/bot/src/",
  "› 1. Yes, proceed (y)",
  "  3. No, and tell Codex what to do differently (esc)",
  "Press enter to confirm or esc to cancel",
].join("\n");

const CLAUDE_PROMPT = [
  "Bash command",
  "  npm test",
  "Do you want to proceed?",
  "❯ 1. Yes",
  "  2. Yes, and don't ask again for npm test commands",
  "  3. No, and tell Claude what to do differently (esc)",
  "Esc to cancel · Tab to amend",
].join("\n");

const item = (overrides: Partial<PendingApprovalItem> = {}): PendingApprovalItem =>
  ({
    nodeId: "node-1",
    node: {} as PendingApprovalItem["node"],
    terminalId: "terminal-tab-pane",
    projectName: "bots+automation",
    category: "permission",
    categoryLabel: "Tool Permission",
    headline: "Command Approval",
    detail: "npm test",
    ...overrides,
  }) as PendingApprovalItem;

function fakeDeps(screens: Array<string | null>) {
  const writes: Array<[string, string]> = [];
  let reads = 0;
  const deps: ApproveDeps = {
    readScreen: async () => screens[Math.min(reads++, screens.length - 1)],
    write: async (id, data) => {
      writes.push([id, data]);
    },
    wait: async () => undefined,
  };
  return { deps, writes };
}

test("recognises each agent's approval prompt and the key that says yes", () => {
  expect(approvalPromptOnScreen(CODEX_PROMPT)).toBe("codex-command");
  expect(approvalKey("codex-command")).toBe("y");
  expect(approvalPromptOnScreen(CLAUDE_PROMPT)).toBe("claude-permission");
  expect(approvalKey("claude-permission")).toBe("1");
});

test("an answered or scrolled-away prompt is not an open prompt", () => {
  expect(approvalPromptOnScreen(`${CODEX_PROMPT}\n• Ran scp\n• Working (4s • esc to interrupt)`)).toBeNull();
  expect(approvalPromptOnScreen("› Ask Codex to do anything")).toBeNull();
  expect(approvalPromptOnScreen("Would you like to run the following command?")).toBeNull(); // no footer
});

test("approves: re-reads the live screen, sends the right key once", async () => {
  const { deps, writes } = fakeDeps([CODEX_PROMPT, "• Working (1s • esc to interrupt)"]);
  const result = await approveOne(item(), deps);
  expect(result.ok).toBe(true);
  expect(writes).toEqual([["terminal-tab-pane", "y"]]);
});

test("NEVER types when the question is already gone (would land in the chat box)", async () => {
  const { deps, writes } = fakeDeps(["› Ask Codex to do anything"]);
  const result = await approveOne(item(), deps);
  expect(result.ok).toBe(false);
  expect(writes).toEqual([]);
});

test("never types into a terminal that is not open on screen", async () => {
  const { deps, writes } = fakeDeps([null]);
  expect((await approveOne(item(), deps)).ok).toBe(false);
  expect(writes).toEqual([]);
});

test("plans, choices and questions are never auto-answered", async () => {
  const { deps, writes } = fakeDeps([CLAUDE_PROMPT]);
  const plan = item({ category: "plan", headline: "Implement Plan" });
  expect(isApprovable(plan)).toBe(false);
  expect((await approveOne(plan, deps)).ok).toBe(false);
  expect(writes).toEqual([]);
});

test("reports a prompt that did not take the answer instead of claiming success", async () => {
  const { deps } = fakeDeps([CLAUDE_PROMPT, CLAUDE_PROMPT]);
  const result = await approveOne(item(), deps);
  expect(result.ok).toBe(false);
});

test("approves several one after another", async () => {
  const { deps, writes } = fakeDeps([CODEX_PROMPT, "done", CODEX_PROMPT, "done"]);
  const results = await approveAll([item({ nodeId: "a" }), item({ nodeId: "b" })], deps);
  expect(results.map((result) => result.ok)).toEqual([true, true]);
  expect(writes).toHaveLength(2);
});

test("risky requests are named in plain words", () => {
  expect(approvalRisk({ headline: "Command Approval", detail: "scp -q a root@84.46.253.137:/opt" })).toBe("touches a server");
  expect(approvalRisk({ headline: "x", detail: "rm -rf dist" })).toBe("deletes files");
  expect(approvalRisk({ headline: "x", detail: "git push origin main" })).toBe("changes git history or the remote");
  expect(approvalRisk({ headline: "x", detail: "npm test" })).toBeNull();
});
