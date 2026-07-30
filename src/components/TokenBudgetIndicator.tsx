import { Gauge } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AgentBudgetSignal } from "../lib/agentBudget";

export function TokenBudgetIndicator({
  signal,
  testId = "terminal-token-budget",
  detailsAlign = "right",
  onOpenModelPicker,
}: {
  signal: AgentBudgetSignal;
  testId?: string;
  detailsAlign?: "left" | "right";
  onOpenModelPicker?: () => Promise<void> | void;
}) {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [detailsPosition, setDetailsPosition] = useState({ left: 8, top: 8 });
  const [pickerStatus, setPickerStatus] = useState<
    "idle" | "opening" | "opened" | "failed"
  >("idle");
  const rootRef = useRef<HTMLSpanElement>(null);
  const detailsRef = useRef<HTMLDivElement>(null);
  const hoverCloseTimer = useRef<number | null>(null);
  const detailsVisible = pinned || hovered;
  const color =
    signal.level === "critical"
      ? "var(--accent-danger)"
      : signal.level === "elevated"
        ? "var(--accent-warning)"
        : "var(--text-secondary)";

  useEffect(() => {
    if (!pinned) return;

    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !rootRef.current?.contains(target) &&
        !detailsRef.current?.contains(target)
      ) {
        setPinned(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [pinned]);

  useLayoutEffect(() => {
    if (!detailsVisible) return;

    const positionDetails = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const details = detailsRef.current;
      if (!anchor || !details) return;
      const gap = 7;
      const viewportPadding = 8;
      const detailsBox = details.getBoundingClientRect();
      const preferredLeft =
        detailsAlign === "left" ? anchor.left : anchor.right - detailsBox.width;
      const left = Math.min(
        window.innerWidth - detailsBox.width - viewportPadding,
        Math.max(viewportPadding, preferredLeft),
      );
      const below = anchor.bottom + gap;
      const top =
        below + detailsBox.height <= window.innerHeight - viewportPadding
          ? below
          : Math.max(viewportPadding, anchor.top - detailsBox.height - gap);
      setDetailsPosition({ left, top });
    };

    positionDetails();
    window.addEventListener("resize", positionDetails);
    window.addEventListener("scroll", positionDetails, true);
    return () => {
      window.removeEventListener("resize", positionDetails);
      window.removeEventListener("scroll", positionDetails, true);
    };
  }, [detailsAlign, detailsVisible]);

  useEffect(
    () => () => {
      if (hoverCloseTimer.current !== null)
        window.clearTimeout(hoverCloseTimer.current);
    },
    [],
  );

  const keepHovered = () => {
    if (hoverCloseTimer.current !== null)
      window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = null;
    setHovered(true);
  };
  const scheduleHoverClose = () => {
    if (hoverCloseTimer.current !== null)
      window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => setHovered(false), 120);
  };

  return (
    <span
      ref={rootRef}
      title=""
      onMouseEnter={keepHovered}
      onMouseLeave={scheduleHoverClose}
      onFocusCapture={keepHovered}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setHovered(false);
      }}
      style={{
        position: "relative",
        display: "inline-flex",
        minWidth: 0,
      }}
    >
      <button
        type="button"
        data-testid={testId}
        data-budget-level={signal.level}
        aria-expanded={detailsVisible}
        aria-controls={`${testId}-details`}
        onClick={(event) => {
          event.stopPropagation();
          setPinned((current) => !current);
        }}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          minWidth: 0,
          height: 22,
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          padding: "0 7px",
          borderRadius: 5,
          border: `1px solid color-mix(in srgb, ${color} ${signal.level === "normal" ? 28 : 58}%, transparent)`,
          background:
            signal.level === "normal"
              ? "var(--surface-base)"
              : `color-mix(in srgb, ${color} ${signal.level === "critical" ? 22 : 14}%, var(--surface-base))`,
          boxShadow:
            signal.level === "critical" ? `inset 3px 0 0 ${color}` : "none",
          color,
          fontFamily: "var(--font-ui)",
          fontSize: 10,
          fontWeight: 500,
          whiteSpace: "nowrap",
          cursor: "pointer",
        }}
      >
        <Gauge size={12} strokeWidth={2} />
        {signal.level !== "normal" && <span>Token budget</span>}
        <span>{signal.modelLabel}</span>
        {signal.reasoningLabel && <span>{signal.reasoningLabel}</span>}
        <span>{signal.contextPercent}%</span>
      </button>
      {detailsVisible &&
        createPortal(
          <div
            ref={detailsRef}
            id={`${testId}-details`}
          role="dialog"
          aria-label="Model recommendation details"
            data-testid="token-budget-details"
            title=""
            onMouseEnter={keepHovered}
            onMouseLeave={scheduleHoverClose}
            onPointerDown={(event) => event.stopPropagation()}
            style={{
              position: "fixed",
              left: detailsPosition.left,
              top: detailsPosition.top,
              zIndex: 1000,
              width: "min(320px, calc(100vw - 16px))",
              display: "grid",
              gap: 7,
              padding: "10px 12px",
              border: `1px solid color-mix(in srgb, ${color} 46%, transparent)`,
              borderRadius: 7,
              background: "var(--surface-raised)",
              boxShadow:
                "0 10px 24px color-mix(in srgb, var(--surface-base) 70%, transparent)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-ui)",
              fontSize: 12,
              lineHeight: 1.35,
              whiteSpace: "normal",
              textAlign: "left",
            }}
          >
          <span style={{ color, fontWeight: 500 }}>
              {signal.modelLabel}
              {signal.reasoningLabel
                ? ` · ${signal.reasoningLabel} reasoning`
                : ""}
              {` · ${signal.contextPercent}% context`}
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              {signal.detail}
            </span>
            <span>
            Recommendation:{" "}
            <strong style={{ fontWeight: 500 }}>{signal.recommendation}</strong>
            </span>
            <span style={{ color: "var(--text-secondary)" }}>
              <strong
                style={{ color: "var(--text-primary)", fontWeight: 500 }}
              >
                Confidence: {signal.confidence}
              </strong>
              {` · ${signal.why}`}
            </span>
          <span style={{ color: "var(--text-secondary)" }}>
            Tradeoff: {signal.tradeoff}
          </span>
          {onOpenModelPicker && (
            <button
              type="button"
              onClick={async (event) => {
                event.stopPropagation();
                setPickerStatus("opening");
                try {
                  await onOpenModelPicker();
                  setPickerStatus("opened");
                } catch {
                  setPickerStatus("failed");
                }
              }}
              disabled={pickerStatus === "opening"}
              style={{
                justifySelf: "start",
                minHeight: 28,
                padding: "0 10px",
                border: `1px solid color-mix(in srgb, ${color} 52%, transparent)`,
                borderRadius: 5,
                background: `color-mix(in srgb, ${color} 14%, var(--surface-base))`,
                color,
                fontFamily: "var(--font-ui)",
                fontSize: 11,
                fontWeight: 500,
                cursor: pickerStatus === "opening" ? "wait" : "pointer",
              }}
            >
              {pickerStatus === "opening"
                ? "Opening…"
                : pickerStatus === "opened"
                  ? "Model picker opened"
                  : pickerStatus === "failed"
                    ? "Could not open picker"
                    : "Open model picker"}
            </button>
          )}
          <span style={{ color: "var(--text-secondary)", fontSize: 10 }}>
              Hover to inspect · Click to keep open · Esc to close
            </span>
          </div>,
          document.body,
        )}
    </span>
  );
}
