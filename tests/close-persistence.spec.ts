import { expect, test } from "@playwright/test";

import {
  CLOSE_PERSISTENCE_TIMEOUT_MS,
  waitForClosePersistence,
} from "../src/lib/closePersistence";

test("does not hold native close open behind a stalled disk mirror", async () => {
  const startedAt = Date.now();
  const result = await waitForClosePersistence(() => new Promise<void>(() => {}), 25);

  expect(result).toBe("timed-out");
  expect(Date.now() - startedAt).toBeLessThan(250);
  expect(CLOSE_PERSISTENCE_TIMEOUT_MS).toBeGreaterThan(0);
});

test("reports a completed disk mirror before the close timeout", async () => {
  await expect(waitForClosePersistence(async () => undefined, 25)).resolves.toBe("flushed");
});
