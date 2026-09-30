export interface TerminalInteractionSample {
  recentInputToDiffMs: number;
  canvasDrawMs: number;
  recentInputToFrameCallbackMs: number;
}

export interface TerminalInteractionAggregate {
  kind: "terminal-interaction-latency";
  count: number;
  recentInputToDiffMs: { p50: number; p95: number; max: number };
  canvasDrawMs: { p50: number; p95: number; max: number };
  recentInputToFrameCallbackMs: { p50: number; p95: number; max: number };
}

const BATCH_SIZE = 20;
const MAX_SAMPLE_MS = 60_000;

type MetricName = keyof TerminalInteractionSample;
const METRICS: MetricName[] = [
  "recentInputToDiffMs",
  "canvasDrawMs",
  "recentInputToFrameCallbackMs",
];

/** Keeps only a fixed batch of timings and writes one content-free aggregate per batch. */
export function createTerminalInteractionLatencyBatcher(
  write: (aggregate: TerminalInteractionAggregate) => void,
  batchSize = BATCH_SIZE,
) {
  const samples: TerminalInteractionSample[] = [];

  return {
    record(sample: TerminalInteractionSample) {
      if (!METRICS.every((key) => Number.isFinite(sample[key]) && sample[key] >= 0)) return;
      samples.push({
        recentInputToDiffMs: Math.min(sample.recentInputToDiffMs, MAX_SAMPLE_MS),
        canvasDrawMs: Math.min(sample.canvasDrawMs, MAX_SAMPLE_MS),
        recentInputToFrameCallbackMs: Math.min(sample.recentInputToFrameCallbackMs, MAX_SAMPLE_MS),
      });
      if (samples.length < Math.max(1, batchSize)) return;

      const aggregate = Object.fromEntries(METRICS.map((key) => {
        const values = samples.map((entry) => entry[key]).sort((a, b) => a - b);
        return [key, {
          p50: Math.round(values[Math.floor((values.length - 1) * 0.5)] * 10) / 10,
          p95: Math.round(values[Math.floor((values.length - 1) * 0.95)] * 10) / 10,
          max: Math.round(values[values.length - 1] * 10) / 10,
        }];
      })) as Pick<TerminalInteractionAggregate, MetricName>;

      write({ kind: "terminal-interaction-latency", count: samples.length, ...aggregate });
      samples.length = 0;
    },
  };
}
