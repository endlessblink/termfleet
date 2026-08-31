import { expect, test } from "@playwright/test";
import {
  effectiveTerminalPaneId,
  statusSidecarPaneId,
} from "../src/lib/terminalPaneIdentity";

test("restored panes use the attached daemon id for agent detection", () => {
  expect(effectiveTerminalPaneId({
    livePtyId: null,
    attachToPtyId: "opaque-daemon-pane",
    runtimeSessionId: "terminal-recovered-tab-recovered-pane",
  })).toBe("opaque-daemon-pane");
});

test("live reattachments take precedence over the original runtime id", () => {
  expect(effectiveTerminalPaneId({
    livePtyId: "live-daemon-pane",
    attachToPtyId: "saved-daemon-pane",
    runtimeSessionId: "terminal-tab-pane",
  })).toBe("live-daemon-pane");
});

test("status lookups keep the stable runtime id across daemon reattachments", () => {
  expect(statusSidecarPaneId({
    livePtyId: "live-daemon-pane",
    attachToPtyId: "saved-daemon-pane",
    runtimeSessionId: "terminal-tab-pane",
})).toBe("terminal-tab-pane");
});

test("status lookups use the original daemon pane for synthetic cold-restore ids", () => {
  expect(statusSidecarPaneId({
    livePtyId: "original-pane",
    runtimeSessionId: "terminal-recovered-tab-123-recovered-pane-456",
  })).toBe("original-pane");
});
