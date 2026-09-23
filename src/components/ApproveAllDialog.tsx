import { CSSProperties, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, X } from "lucide-react";
import type { PendingApprovalItem } from "../lib/pendingApprovals";
import { approveAll, approvalRisk, isApprovable, type ApproveResult } from "../lib/approveAll";

// "Always ask first": every waiting request is listed with what it will do, risky ones
// are marked, and a single click approves the ticked ones (TF-044 follow-up).
const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.45)",
  },
  panel: {
    width: "min(560px, calc(100vw - 48px))",
    maxHeight: "min(640px, calc(100vh - 80px))",
    display: "flex",
    flexDirection: "column",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)",
    border: "1px solid var(--border-subtle)",
    boxShadow: "0 18px 48px rgba(0, 0, 0, 0.45)",
    fontFamily: "var(--font-ui)",
    color: "var(--text-primary)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "12px 14px",
    borderBottom: "1px solid var(--border-subtle)",
    fontSize: 13,
    fontWeight: 500,
  },
  list: { overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 },
  row: {
    display: "grid",
    gridTemplateColumns: "18px 1fr",
    gap: 8,
    alignItems: "start",
    padding: "8px 10px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    fontSize: 12,
    fontWeight: 400,
  },
  project: { fontWeight: 500 },
  detail: { color: "var(--text-secondary)", fontSize: 11, marginTop: 2, wordBreak: "break-word" },
  risk: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginTop: 4,
    color: "var(--accent-warning)",
    fontSize: 11,
    fontWeight: 500,
  },
  muted: { color: "var(--text-tertiary)", fontSize: 11, marginTop: 2 },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid var(--border-subtle)",
    fontSize: 11,
    color: "var(--text-secondary)",
  },
  button: {
    padding: "5px 12px",
    borderRadius: "var(--radius-xs)",
    border: "1px solid var(--border-subtle)",
    background: "var(--surface-raised)",
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  primary: {
    background: "var(--accent-warning)",
    borderColor: "var(--accent-warning)",
    color: "#111",
  },
};

export function ApproveAllDialog({
  approvals,
  onClose,
}: {
  approvals: PendingApprovalItem[];
  onClose: () => void;
}) {
  const approvable = useMemo(() => approvals.filter(isApprovable), [approvals]);
  const needsAnswer = useMemo(() => approvals.filter((item) => !isApprovable(item)), [approvals]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(approvable.map((item) => item.nodeId)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApproveResult[] | null>(null);

  useEffect(() => {
    // While the list is open it owns the keyboard: a key must never fall through to the
    // focused terminal (Esc there would CANCEL a Codex approval).
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('[data-testid="approve-all-dialog"]') && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const toggle = (nodeId: string) =>
    setChosen((previous) => {
      const next = new Set(previous);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const run = async () => {
    setBusy(true);
    try {
      setResults(await approveAll(approvable.filter((item) => chosen.has(item.nodeId))));
    } finally {
      setBusy(false);
    }
  };

  const resultFor = (nodeId: string) => results?.find((result) => result.nodeId === nodeId);
  const approvedCount = results?.filter((result) => result.ok).length ?? 0;

  return (
    <div style={styles.backdrop} data-testid="approve-all-dialog" onMouseDown={() => !busy && onClose()}>
      <div style={styles.panel} role="dialog" aria-label="Approve all" onMouseDown={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <span>{results ? "Approve all — done" : `Approve ${approvable.length} waiting request${approvable.length === 1 ? "" : "s"}?`}</span>
          <button type="button" style={{ ...styles.button, padding: 4 }} onClick={onClose} disabled={busy} aria-label="Close">
            <X size={13} />
          </button>
        </div>
        <div style={styles.list}>
          {approvable.map((item) => {
            const risk = approvalRisk(item);
            const result = resultFor(item.nodeId);
            return (
              <label key={item.nodeId} style={styles.row} data-testid="approve-all-row">
                {result ? (
                  result.ok ? (
                    <CheckCircle2 size={14} style={{ color: "var(--accent-success)", marginTop: 1 }} />
                  ) : (
                    <AlertTriangle size={14} style={{ color: "var(--accent-warning)", marginTop: 1 }} />
                  )
                ) : (
                  <input
                    type="checkbox"
                    checked={chosen.has(item.nodeId)}
                    onChange={() => toggle(item.nodeId)}
                    disabled={busy}
                  />
                )}
                <span>
                  <span style={styles.project} dir="auto">
                    {item.projectEmoji ? `${item.projectEmoji} ` : ""}
                    {item.projectName}
                  </span>
                  {" · "}
                  {item.headline}
                  {item.detail && (
                    <div style={styles.detail} dir="auto">
                      {item.detail}
                    </div>
                  )}
                  {risk && !result && (
                    <div style={styles.risk}>
                      <AlertTriangle size={11} /> Careful: {risk}
                    </div>
                  )}
                  {result && (
                    <div style={result.ok ? styles.muted : styles.risk}>
                      {result.ok ? "Approved" : `Not approved: ${result.reason}`}
                    </div>
                  )}
                </span>
              </label>
            );
          })}
          {needsAnswer.map((item) => (
            <div key={item.nodeId} style={{ ...styles.row, opacity: 0.7 }}>
              <span />
              <span>
                <span style={styles.project} dir="auto">
                  {item.projectName}
                </span>
                {" · "}
                {item.headline}
                <div style={styles.muted}>Needs your own answer — open it to choose.</div>
              </span>
            </div>
          ))}
          {approvals.length === 0 && <div style={styles.muted}>Nothing is waiting for approval.</div>}
        </div>
        <div style={styles.footer}>
          <span>
            {results
              ? `${approvedCount} of ${results.length} approved`
              : "Each terminal is re-checked right before answering; nothing is typed if its question is gone."}
          </span>
          {results ? (
            <button type="button" style={styles.button} onClick={onClose}>
              Close
            </button>
          ) : (
            <button
              type="button"
              data-testid="approve-all-confirm"
              autoFocus
              style={{ ...styles.button, ...styles.primary, opacity: busy || chosen.size === 0 ? 0.6 : 1 }}
              onClick={run}
              disabled={busy || chosen.size === 0}
            >
              {busy ? "Approving…" : `Approve ${chosen.size}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
