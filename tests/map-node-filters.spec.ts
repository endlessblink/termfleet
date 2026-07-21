import { expect, test } from "@playwright/test";
import { nodeMatchesMapFilter } from "../src/lib/mapNodeFilters";

const node = { id: "node-1", type: "terminal", terminalPtyId: "pty-1" } as never;

function tab(status: string, terminalVisibleText?: string) {
  return {
    id: "tab-1",
    activePaneId: "pane-1",
    terminals: [{
      id: "pty-1",
      paneId: "pane-1",
      status: "running",
      statusSummary: { status },
      terminalVisibleText,
    }],
  } as never;
}

test("map Active and Waiting filters use the same lifecycle as pane badges", () => {
  expect(nodeMatchesMapFilter(node, tab("working"), "active")).toBe(true);
  expect(nodeMatchesMapFilter(node, tab("working"), "waiting")).toBe(false);
  expect(nodeMatchesMapFilter(node, tab("waiting"), "active")).toBe(false);
  expect(nodeMatchesMapFilter(node, tab("waiting"), "waiting")).toBe(true);
  expect(nodeMatchesMapFilter(node, tab("idle"), "active")).toBe(false);
});

test("an on-screen unanswered question increments Waiting instead of Active", () => {
  const question = [
    "Question 1/1 (1 unanswered)",
    "Which behavior should be used?",
    "enter to submit answer",
  ].join("\n");
  expect(nodeMatchesMapFilter(node, tab("working", question), "waiting")).toBe(true);
  expect(nodeMatchesMapFilter(node, tab("working", question), "active")).toBe(false);
});
