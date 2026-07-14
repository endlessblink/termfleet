import { test, expect } from "@playwright/test";
import { selectStatusPollTargets } from "../src/lib/statusPollTargets";

function term(id: string, status: string) {
  return { id, paneId: id, status } as never;
}
function tab(id: string, terminals: unknown[]) {
  return { id, terminals } as never;
}

test("every live pane is a poll target — background/finished panes are NOT skipped", () => {
  const tabs = [
    tab("active", [term("a1", "running")]),
    tab("bgIdle", [term("b1", "exited")]),      // finished background pane
    tab("bgRunning", [term("b2", "running")]),  // background but process alive
    tab("bgReconn", [term("b3", "reconnected")]),
  ];
  const targets = selectStatusPollTargets(tabs as never, "active", 1_000_000);
  const ids = targets.map((t) => t.terminal.id);
  // The whole point: a finished background pane must still be polled so its badge
  // updates without the user clicking it.
  expect(ids).toContain("b1");
  expect(ids).toContain("b2");
  expect(ids).toContain("b3");
  expect(ids).toContain("a1");
});
