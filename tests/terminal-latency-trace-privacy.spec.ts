import { expect, test } from "@playwright/test";
import { sanitizeTerminalLatencyTraceDetails } from "../src/lib/terminalLatencyTracePrivacy";

test("latency traces keep measurements but never terminal text or typed keys", () => {
  expect(sanitizeTerminalLatencyTraceDetails({
    label: "input",
    data: "secret terminal input",
    dataPreview: "secret terminal input",
    key: "x",
    output: "private terminal output",
    command: "private command",
    bytes: 21,
    seqId: 4,
  })).toEqual({
    label: "input",
    dataLength: 21,
    keyCategory: "printable",
    bytes: 21,
    seqId: 4,
  });
});

test("named-key traces retain only a non-content category", () => {
  expect(sanitizeTerminalLatencyTraceDetails({ key: "Enter", dataPreview: "private" }))
    .toEqual({ keyCategory: "named" });
});
