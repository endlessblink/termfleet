import { expect, test } from "@playwright/test";
import { parseTerminalChecklist } from "../src/lib/terminalChecklist";

test("extracts a codex 'Updated Plan' checkbox block (the Image #8 case)", () => {
  const output = [
    "• Updated Plan",
    "  └ ☐ Tune selected terminal default size",
    "    ☐ Keep manual resize persistent",
    "    ☑ Rerun map and canvas regressions",
    "",
    "• Working (41s • esc to interrupt)",
  ].join("\n");
  const items = parseTerminalChecklist(output);
  expect(items).toEqual([
    { content: "Tune selected terminal default size", status: "pending" },
    { content: "Keep manual resize persistent", status: "pending" },
    { content: "Rerun map and canvas regressions", status: "completed" },
  ]);
});

test("extracts markdown checkbox lists too", () => {
  const items = parseTerminalChecklist("- [x] Wire the daemon\n- [ ] Add reconnection guard");
  expect(items).toEqual([
    { content: "Wire the daemon", status: "completed" },
    { content: "Add reconnection guard", status: "pending" },
  ]);
});

test("prefers the LAST plan block, not a stale earlier one", () => {
  const output = [
    "☐ old plan item one",
    "☐ old plan item two",
    "...lots of work happened...",
    "Updated Plan",
    "☐ new item A",
    "☐ new item B",
  ].join("\n");
  expect(parseTerminalChecklist(output).map((i) => i.content)).toEqual(["new item A", "new item B"]);
});

test("returns [] when there is no checklist (no false positives from prose)", () => {
  expect(parseTerminalChecklist("Just some normal output\nRunning tests\n1 passed")).toEqual([]);
  expect(parseTerminalChecklist("☐ a lone checkbox in prose")).toEqual([]); // needs >= 2 items
  expect(parseTerminalChecklist(undefined)).toEqual([]);
});

test("rejects prompt chrome inside a checkbox line", () => {
  const items = parseTerminalChecklist("☐ Improve documentation in @filename\n☐ Add the regression test");
  expect(items).toEqual([{ content: "Add the regression test", status: "pending" }]);
});
