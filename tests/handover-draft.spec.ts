import { expect, test } from "@playwright/test";
import { extractInputDraft, inputBoxIsUp, pasteWithoutSubmitting } from "../src/lib/handoverDraft";

// A handover while the operator is typing must carry the unsent text to the new card.
const rule = "─".repeat(60);
const screen = (box: string[]) =>
  ["* Worked for 2m 27s · done 18:04", "", rule, ...box, rule, "  [OMC] | session:12m | ctx:52%", "  ⏵⏵ auto mode on"].join("\n");

test("the unsent text in the input box is read from the screen", () => {
  expect(extractInputDraft(screen(["❯ there was something you missed - "]))).toBe("there was something you missed -");
});

test("a long draft that wraps onto a second line is read as one piece of text", () => {
  expect(extractInputDraft(screen(["❯ having everything here and moving to the", "  new dropoffed terminal"]))).toBe(
    "having everything here and moving to the new dropoffed terminal",
  );
});

test("an empty box and Claude's grey hint text count as no draft", () => {
  expect(extractInputDraft(screen(["❯ "]))).toBe("");
  expect(extractInputDraft(screen(['❯ Try "fix typecheck errors"']))).toBe("");
  expect(extractInputDraft("no box here at all")).toBe("");
});

test("only the box nearest the bottom counts, not older prompts in the history", () => {
  const text = [rule, "❯ an old message", rule, "answer text", rule, "❯ the real draft", rule, "status"].join("\n");
  expect(extractInputDraft(text)).toBe("the real draft");
});

test("the draft is pasted without being submitted", () => {
  const data = pasteWithoutSubmitting("hello");
  expect(data).toBe("\u001b[200~hello\u001b[201~");
  expect(data).not.toContain("\r");
  expect(data).not.toContain("\n");
});

test("source contract: the draft is read BEFORE the old card is retired and typed unsent into the new one", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/lib/childRequestLoop.ts", "utf8");
  const read = source.indexOf('"grid_screen_text", { id: typing.id }');
  const archive = source.indexOf("after.archivePredecessor(");
  expect(read).toBeGreaterThan(0);
  expect(read).toBeLessThan(archive);
  expect(source).toContain("if (draft) void carryDraft(childPaneId, draft);");
  expect(source).toContain("pasteWithoutSubmitting(draft)");
});

test("the new agent's input box is recognised once it is on screen", () => {
  expect(inputBoxIsUp(screen(["❯ "]))).toBe(true);
  expect(inputBoxIsUp("starting claude…\nloading")).toBe(false);
});
