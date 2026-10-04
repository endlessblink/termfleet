/** Independent, content-free liveness. A slow snapshot must not delay this timer. */
export function startCockpitHeartbeat(
  write: () => Promise<unknown>,
  schedule: (tick: () => void, interval: number) => unknown,
  cancel: (timer: unknown) => void,
): () => void {
  let pending = false;
  let stopped = false;
  const tick = () => {
    if (pending || stopped) return;
    pending = true;
    // Keep at most one IO request in flight, including when a writer stalls.
    void Promise.resolve().then(write).catch(() => undefined).finally(() => {
      pending = false;
    });
  };
  const timer = schedule(tick, 10_000);
  tick();
  return () => { stopped = true; cancel(timer); };
}
