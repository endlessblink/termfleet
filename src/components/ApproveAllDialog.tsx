import { CSSProperties, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button, Checkbox, Dialog } from "../ui";
import type { PendingApprovalItem } from "../lib/pendingApprovals";
import { approveAll, approvalRisk, isApprovable, type ApproveResult } from "../lib/approveAll";

// "Always ask first": every waiting request is listed with what it will do, risky ones
// are marked, and a single click approves the ticked ones (TF-044 follow-up).
const styles: Record<string, CSSProperties> = {
  list: { overflowY: "auto", padding: "0 12px", display: "flex", flexDirection: "column", gap: 6 },
  row: {
    display: "grid",
    gridTemplateColumns: "18px 1fr",
    gap: 8,
    alignItems: "start",
    padding: "8px 10px",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-sidebar)",
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
    color: "var(--state-waiting)",
    fontSize: 11,
    fontWeight: 500,
  },
  muted: { color: "var(--text-secondary)", fontSize: 11, marginTop: 2 },
  note: { color: "var(--text-secondary)", fontSize: 11 },
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

  const title = results
    ? "Approve all — done"
    : `Approve ${approvable.length} waiting request${approvable.length === 1 ? "" : "s"}?`;

  return (
    <Dialog
      title={title}
      width={560}
      data-testid="approve-all-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <span style={styles.note}>
            {results
              ? `${approvedCount} of ${results.length} approved`
              : "Each terminal is re-checked right before answering; nothing is typed if its question is gone."}
          </span>
          {results ? (
            <Button size="lg" onClick={onClose}>
              Close
            </Button>
          ) : (
            <Button
              size="lg"
              variant="warn"
              data-testid="approve-all-confirm"
              data-autofocus
              onClick={run}
              disabled={busy || chosen.size === 0}
            >
              {busy ? "Approving…" : `Approve ${chosen.size}`}
            </Button>
          )}
        </>
      }
    >
      <div style={styles.list}>
        {approvable.map((item) => {
          const risk = approvalRisk(item);
          const result = resultFor(item.nodeId);
          return (
            <label key={item.nodeId} style={styles.row} data-testid="approve-all-row">
              {result ? (
                result.ok ? (
                  <CheckCircle2 size={14} style={{ color: "var(--state-running)", marginTop: 1 }} />
                ) : (
                  <AlertTriangle size={14} style={{ color: "var(--state-waiting)", marginTop: 1 }} />
                )
              ) : (
                <Checkbox
                  checked={chosen.has(item.nodeId)}
                  onChange={() => toggle(item.nodeId)}
                  disabled={busy}
                  aria-label={`Approve ${item.projectName}`}
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
    </Dialog>
  );
}
