import { expect, test } from "@playwright/test";
import { resetAttachStatusForTests, statusForAttach } from "../src/lib/ptyAttachStatus";

// A fresh install showed "pty reconnected · 1 reconnected" for a terminal that had
// never been away: the map card and the split pane both attach to the new session,
// and the second attach comes back "reused".
test("a terminal this run created never reads as reconnected", () => {
  resetAttachStatusForTests();
  expect(statusForAttach("pty-new", false)).toBe("running");
  expect(statusForAttach("pty-new", true)).toBe("running");
});

test("a terminal that outlived the last run reads as reconnected", () => {
  resetAttachStatusForTests();
  expect(statusForAttach("pty-from-before", true)).toBe("reconnected");
  expect(statusForAttach("pty-from-before", true)).toBe("reconnected");
});
