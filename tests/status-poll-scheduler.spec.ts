import { expect, test } from "@playwright/test";
import { runBoundedTasks } from "../src/lib/statusPollScheduler";

test("runs 100 status reads with bounded concurrency instead of serially", async () => {
  let active = 0;
  let peak = 0;
  const started: number[] = [];

  const results = await runBoundedTasks(
    Array.from({ length: 100 }, (_, index) => index),
    8,
    async (index) => {
      active += 1;
      peak = Math.max(peak, active);
      started.push(index);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return index * 2;
    },
  );

  expect(peak).toBe(8);
  expect(started).toHaveLength(100);
  expect(results).toEqual(Array.from({ length: 100 }, (_, index) => index * 2));
});
