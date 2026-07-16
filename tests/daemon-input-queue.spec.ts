import { expect, test } from "@playwright/test";
import { createDaemonInputQueue, DAEMON_INPUT_EVENT } from "../src/lib/daemonInputQueue";

type SentInput = { event: string; id: string; data: string; seqIds: number[] };

function harness() {
  const sent: SentInput[] = [];
  const queue = createDaemonInputQueue({
    getId: () => "terminal-test",
    source: "test",
    sendEvent: async (event, payload) => {
      sent.push({ event, ...payload });
    },
  });
  return { queue, sent };
}

test("delivers ordinary keyboard input on the next microtask without timer clamping", async () => {
  const { queue, sent } = harness();

  queue.queue("a", 1);
  expect(sent).toEqual([]);
  await Promise.resolve();

  expect(sent).toEqual([
    { event: DAEMON_INPUT_EVENT, id: "terminal-test", data: "a", seqIds: [1] },
  ]);
});

test("coalesces input queued in the same JavaScript turn", async () => {
  const { queue, sent } = harness();

  queue.queue("a", 2);
  queue.queue("b", 3);
  await Promise.resolve();

  expect(sent).toEqual([
    { event: DAEMON_INPUT_EVENT, id: "terminal-test", data: "ab", seqIds: [2, 3] },
  ]);
});

test("disposal cancels a scheduled batch", async () => {
  const { queue, sent } = harness();

  queue.queue("a", 4);
  queue.dispose();
  await Promise.resolve();

  expect(sent).toEqual([]);
});
