export const CLOSE_PERSISTENCE_TIMEOUT_MS = 1500;

/** A stalled best-effort disk mirror must never hold the native window open. */
export async function waitForClosePersistence(
  flush: () => Promise<unknown>,
  timeoutMs = CLOSE_PERSISTENCE_TIMEOUT_MS,
): Promise<"flushed" | "timed-out" | "failed"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      flush().then(() => "flushed" as const, () => "failed" as const),
      new Promise<"timed-out">((resolve) => {
        timer = setTimeout(() => resolve("timed-out"), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
