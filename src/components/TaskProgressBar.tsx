import type { TaskLineupItem } from "../lib/types";
import { taskLineupProgress } from "../lib/taskLineup";

export function TaskProgressBar({
  items,
  compact = false,
  testId = "task-progress",
}: {
  items: TaskLineupItem[];
  compact?: boolean;
  testId?: string;
}) {
  const progress = taskLineupProgress(items);
  if (progress.total === 0) {
    return (
      <span data-testid={`${testId}-unavailable`} style={{ color: "var(--text-tertiary)" }}>
        Progress unavailable
      </span>
    );
  }

  const label = `${progress.completed} of ${progress.total} tasks complete`;
  return (
    <div
      data-testid={testId}
      aria-label={label}
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "1fr auto" : "1fr auto",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
      }}
    >
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percent}
        aria-label={label}
        style={{
          height: compact ? 4 : 5,
          overflow: "hidden",
          borderRadius: 999,
          background: "var(--surface-raised)",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 999,
            background: progress.percent === 100 ? "var(--state-done)" : "var(--state-running)",
            transform: `scaleX(${progress.percent / 100})`,
            transformOrigin: "left center",
            transition: "transform var(--dur-med) var(--ease-out)",
          }}
        />
      </div>
      <span style={{ color: "var(--text-tertiary)", fontSize: 11, whiteSpace: "nowrap" }}>
        {progress.percent}%
      </span>
    </div>
  );
}
