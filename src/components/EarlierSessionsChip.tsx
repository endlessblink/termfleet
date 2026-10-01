import { useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useWorkspaceStore } from "../stores/workspace";
import { HELPER_TERMINAL_COLOR } from "../lib/childTerminals";
import type { EarlierSession } from "../lib/types";

// A handover keeps ONE card per piece of work: the newest session owns the card
// and older sessions wait here, quietly, until the operator clears them.

function ago(at: number, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

const styles: Record<string, CSSProperties> = {
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 20,
    padding: "0 8px",
    borderRadius: 10,
    border: "none",
    background: "var(--surface-raised)",
    color: "var(--text-secondary)",
    font: "inherit",
    fontSize: 11,
    fontWeight: 400,
    cursor: "pointer",
  },
  chipOpen: { background: "var(--surface-selected)", color: "var(--text-primary)" },
  panel: {
    position: "fixed",
    zIndex: 2000,
    width: 288,
    padding: 6,
    borderRadius: 10,
    background: "var(--surface-raised)",
    boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    fontFamily: "var(--font-ui)",
  },
  heading: { padding: "6px 8px 4px", fontSize: 11, fontWeight: 500, color: "var(--text-muted)" },
  row: { display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8 },
  rowText: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 },
  rowTitle: {
    fontSize: 12,
    fontWeight: 400,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowMeta: { fontSize: 11, fontWeight: 300, color: "var(--text-muted)" },
  clear: {
    border: "none",
    borderRadius: 6,
    padding: "3px 8px",
    background: "transparent",
    color: "var(--text-secondary)",
    font: "inherit",
    fontSize: 11,
    fontWeight: 400,
    cursor: "pointer",
  },
  footer: { display: "flex", justifyContent: "flex-end", padding: "4px 4px 2px" },
};

export function EarlierSessionsChip({ tabId, sessions }: { tabId: string; sessions: readonly EarlierSession[] }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const clearOne = useWorkspaceStore((state) => state.clearEarlierSession);
  const clearAll = useWorkspaceStore((state) => state.clearAllEarlierSessions);
  if (sessions.length === 0) return null;
  const rect = open ? anchor.current?.getBoundingClientRect() : undefined;
  // The map stage is CSS-scaled, so the list is drawn on the body, not inside the card.
  const stop = (event: { stopPropagation: () => void }) => event.stopPropagation();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        data-testid="canvas-terminal-earlier-sessions"
        title="Earlier sessions of this work. Their agents have handed over and stopped."
        style={{ ...styles.chip, ...(open ? styles.chipOpen : null) }}
        onMouseDown={stop}
        onPointerDown={stop}
        onClick={(event) => {
          stop(event);
          setOpen((value) => !value);
        }}
      >
        <span aria-hidden="true" style={{ color: HELPER_TERMINAL_COLOR }}>
          ↻
        </span>
        {sessions.length} earlier
      </button>
      {open && rect
        ? createPortal(
            <div
              data-testid="earlier-sessions-panel"
              style={{ ...styles.panel, left: Math.max(8, rect.left), top: rect.bottom + 6 }}
              onMouseDown={stop}
              onPointerDown={stop}
              onWheel={stop}
            >
              <div style={styles.heading}>Earlier sessions</div>
              {sessions.map((session, index) => {
                const key = `${session.endedAt}-${index}`;
                return (
                  <div
                    key={key}
                    style={{ ...styles.row, background: hover === key ? "var(--surface-hover)" : "transparent" }}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                  >
                    <div style={styles.rowText}>
                      <span style={styles.rowTitle}>{session.title}</span>
                      <span style={styles.rowMeta}>Handed over {ago(session.endedAt)}</span>
                    </div>
                    <button type="button" style={styles.clear} onClick={() => void clearOne(tabId, index)}>
                      Clear
                    </button>
                  </div>
                );
              })}
              <div style={styles.footer}>
                <button
                  type="button"
                  style={styles.clear}
                  onClick={() => {
                    void clearAll(tabId);
                    setOpen(false);
                  }}
                >
                  Clear all
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
