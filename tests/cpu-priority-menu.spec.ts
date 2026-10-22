import { expect, test } from "@playwright/test";
import { priorityPaneId, urgentMenuText, parsePriorityReply, shareChoiceFor, AGENT_SHARE_CHOICES } from "../src/lib/cpuPriority";

// Noam 2026-10-22: agents yield CPU to his own apps unless something is urgent.
test("the map menu names the terminal by the same id its programs carry", () => {
  expect(priorityPaneId("tab1", "pane9")).toBe("terminal-tab1-pane9");
  expect(priorityPaneId(undefined, "pane9")).toBeNull();
  expect(priorityPaneId("tab1", undefined)).toBeNull();
});

test("the menu item says plainly what it will do", () => {
  expect(urgentMenuText({ urgent: false, loading: false })).toEqual({
    title: "Make urgent",
    hint: "Full speed for this terminal; other agents stay gentle",
  });
  expect(urgentMenuText({ urgent: true, loading: false })).toEqual({
    title: "Urgent is on — turn off",
    hint: "Back to the gentle share; nothing stops",
  });
  expect(urgentMenuText({ urgent: false, loading: true }).title).toBe("Checking priority…");
});

test("a refused change shows the helper's plain reason", () => {
  expect(parsePriorityReply('{"ok":true,"urgent":true}')).toEqual({ ok: true, urgent: true, error: null });
  expect(parsePriorityReply('{"ok":false,"error":"This terminal has no running programs to speed up."}')).toEqual({
    ok: false,
    urgent: false,
    error: "This terminal has no running programs to speed up.",
  });
  expect(parsePriorityReply("garbage").ok).toBe(false);
});

test("the agents' share setting offers Gentle (default), Medium and Normal", () => {
  expect(AGENT_SHARE_CHOICES.map((c) => c.weight)).toEqual([20, 50, 100]);
  expect(shareChoiceFor(20)).toBe(20);
  expect(shareChoiceFor(35)).toBe(20);
  expect(shareChoiceFor(60)).toBe(50);
  expect(shareChoiceFor(90)).toBe(100);
});
