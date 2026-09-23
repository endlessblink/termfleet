import { CSSProperties, useState, useCallback, useEffect, useRef } from "react";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  HelpCircle,
  ShieldAlert,
  TerminalSquare,
} from "lucide-react";
import type { CanvasNode } from "../lib/types";
import type { PendingApprovalItem } from "../lib/pendingApprovals";
import { AgentProviderIdentity } from "./AgentProviderIdentity";
import { ApproveAllDialog } from "./ApproveAllDialog";
import { isApprovable } from "../lib/approveAll";

const styles: Record<string, CSSProperties> = {
  section: {
    display: "flex",
    flexDirection: "column",
    padding: "10px 10px 12px",
    background: "linear-gradient(180deg, rgba(212, 164, 79, 0.07) 0%, transparent 100%)",
    borderBottom: "1px solid var(--border-subtle)",
    userSelect: "none",
  },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 8,
  },
  titleGroup: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
  },
  beacon: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    background: "var(--accent-warning)",
    boxShadow: "0 0 6px rgba(212, 164, 79, 0.65)",
    flexShrink: 0,
  },
  title: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    padding: "1px 6px",
    borderRadius: "var(--radius-xs)",
    background: "rgba(212, 164, 79, 0.16)",
    color: "var(--accent-warning)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  toggleButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    border: "1px solid transparent",
    borderRadius: "var(--radius-xs)",
    background: "transparent",
    color: "var(--text-secondary)",
    cursor: "pointer",
    outline: "none",
    transition: "background var(--motion-fast), color var(--motion-fast)",
  },
  collapsedSummary: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 8px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    borderLeft: "2px solid var(--accent-warning)",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 400,
    cursor: "pointer",
  },
  emptyCard: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 9px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-raised)",
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 400,
  },
  cardList: {
    display: "flex",
    flexDirection: "column",
    gap: 7,
  },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "9px 11px",
    borderRadius: "var(--radius-sm)",
    background: "var(--surface-raised)",
    borderLeft: "3px solid var(--accent-warning)",
    borderTop: "1px solid transparent",
    borderRight: "1px solid transparent",
    borderBottom: "1px solid transparent",
    cursor: "pointer",
    outline: "none",
    transition: "background var(--motion-fast), transform var(--motion-fast)",
    textAlign: "left",
    boxSizing: "border-box",
  },
  cardTopRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    minWidth: 0,
  },
  projectGroup: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flex: 1,
  },
  projectEmoji: {
    fontSize: 12,
    lineHeight: 1,
    flexShrink: 0,
  },
  projectName: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  categoryChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 3,
    padding: "1px 5px",
    borderRadius: "var(--radius-xs)",
    background: "rgba(212, 164, 79, 0.12)",
    color: "var(--accent-warning)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 500,
    flexShrink: 0,
  },
  askRow: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
  },
  headline: {
    color: "var(--text-primary)",
    fontFamily: "var(--font-ui)",
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: {
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 11,
    fontWeight: 400,
    lineHeight: 1.35,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
    wordBreak: "break-word",
  },
  footerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
    marginTop: 2,
    paddingTop: 5,
    borderTop: "1px solid var(--border-subtle)",
  },
  footerMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    color: "var(--text-tertiary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 400,
  },
  actionButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "2px 7px",
    borderRadius: "var(--radius-xs)",
    background: "var(--surface-base)",
    border: "1px solid transparent",
    color: "var(--text-secondary)",
    fontFamily: "var(--font-ui)",
    fontSize: 10,
    fontWeight: 500,
    cursor: "pointer",
    outline: "none",
    transition: "background var(--motion-fast), color var(--motion-fast)",
    whiteSpace: "nowrap",
  },
};

function categoryIcon(category: PendingApprovalItem["category"]) {
  switch (category) {
    case "permission":
      return <ShieldAlert size={10} strokeWidth={2} />;
    case "plan":
      return <FileText size={10} strokeWidth={2} />;
    case "decision":
      return <TerminalSquare size={10} strokeWidth={2} />;
    case "question":
      return <HelpCircle size={10} strokeWidth={2} />;
    default:
      return <AlertCircle size={10} strokeWidth={2} />;
  }
}

export interface PendingApprovalsSectionProps {
  approvals: PendingApprovalItem[];
  onSelect: (node: CanvasNode) => void;
  defaultCollapsed?: boolean;
}

export function PendingApprovalsSection({
  approvals,
  onSelect,
  defaultCollapsed = false,
}: PendingApprovalsSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const hasApprovals = approvals.length > 0;
  const approvableCount = approvals.filter(isApprovable).length;
  const [approveAllOpen, setApproveAllOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);

  // Ctrl+Shift+A opens "Approve all" from anywhere, even with a terminal focused
  // (capture phase, so the terminal never receives the keys). Only a visible section
  // answers, so two sidebars can never open two dialogs.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey && event.shiftKey && !event.altKey && event.key.toLowerCase() === "a")) return;
      if (!sectionRef.current || sectionRef.current.offsetParent === null) return;
      event.preventDefault();
      event.stopPropagation();
      setApproveAllOpen(true);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return (
    <section
      ref={sectionRef}
      data-testid="map-pending-approvals-section"
      aria-label="Pending approvals"
      style={styles.section}
    >
      {approveAllOpen && (
        <ApproveAllDialog approvals={approvals} onClose={() => setApproveAllOpen(false)} />
      )}
      <div style={styles.headerRow} data-testid="map-pending-approvals-header">
        <div style={styles.titleGroup}>
          <span
            style={{
              ...styles.beacon,
              background: hasApprovals ? "var(--accent-warning)" : "var(--accent-success)",
              boxShadow: hasApprovals ? "0 0 6px rgba(212, 164, 79, 0.65)" : "none",
              opacity: hasApprovals ? 1 : 0.7,
            }}
            aria-hidden="true"
          />
          <span style={styles.title}>Pending Approval</span>
          <span
            style={{
              ...styles.badge,
              background: hasApprovals ? "rgba(212, 164, 79, 0.16)" : "var(--surface-raised)",
              color: hasApprovals ? "var(--accent-warning)" : "var(--text-tertiary)",
            }}
            data-testid="map-pending-approvals-count"
            title={`${approvals.length} terminal${approvals.length === 1 ? "" : "s"} waiting for approval`}
          >
            {approvals.length}
          </span>
        </div>
        {approvableCount > 0 && (
          <button
            type="button"
            data-testid="map-pending-approvals-approve-all"
            style={{ ...styles.actionButton, color: "var(--accent-warning)", marginLeft: "auto" }}
            onClick={() => setApproveAllOpen(true)}
            title="Review and approve every waiting request (Ctrl+Shift+A)"
          >
            Approve all
          </button>
        )}
        <button
          type="button"
          data-testid="map-pending-approvals-toggle"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand pending approvals" : "Collapse pending approvals"}
          style={styles.toggleButton}
          onClick={toggleCollapsed}
          title={collapsed ? "Show pending approvals" : "Hide pending approvals"}
        >
          {collapsed ? (
            <ChevronRight size={13} strokeWidth={1.8} />
          ) : (
            <ChevronDown size={13} strokeWidth={1.8} />
          )}
        </button>
      </div>

      {collapsed ? (
        <div
          style={styles.collapsedSummary}
          role="button"
          tabIndex={0}
          onClick={toggleCollapsed}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              toggleCollapsed();
            }
          }}
        >
          <span>
            {hasApprovals
              ? `${approvals.length} action${approvals.length === 1 ? "" : "s"} required`
              : "All clear · No actions required"}
          </span>
          <span
            style={{
              color: hasApprovals ? "var(--accent-warning)" : "var(--text-tertiary)",
              fontSize: 10,
              fontWeight: 500,
            }}
          >
            Show
          </span>
        </div>
      ) : !hasApprovals ? (
        <div style={styles.emptyCard} data-testid="map-pending-approvals-empty">
          <CheckCircle2 size={12} style={{ color: "var(--accent-success)", flexShrink: 0 }} />
          <span>All clear · No terminals awaiting approval</span>
        </div>
      ) : (
        <div style={styles.cardList}>
          {approvals.map((item) => {
            const isHovered = hoveredCardId === item.nodeId;
            return (
              <div
                key={item.nodeId}
                data-testid="pending-approval-card"
                role="button"
                tabIndex={0}
                style={{
                  ...styles.card,
                  background: isHovered ? "var(--surface-hover)" : "var(--surface-raised)",
                }}
                onMouseEnter={() => setHoveredCardId(item.nodeId)}
                onMouseLeave={() => setHoveredCardId(null)}
                onClick={() => onSelect(item.node)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(item.node);
                  }
                }}
                title="Click to jump and review approval in terminal"
              >
                <div style={styles.cardTopRow}>
                  <div style={styles.projectGroup}>
                    {item.projectEmoji && (
                      <span style={styles.projectEmoji}>{item.projectEmoji}</span>
                    )}
                    <span style={styles.projectName} dir="auto">
                      {item.projectName}
                    </span>
                  </div>
                  <span style={styles.categoryChip}>
                    {categoryIcon(item.category)}
                    <span>{item.categoryLabel}</span>
                  </span>
                </div>

                <div style={styles.askRow}>
                  <div style={styles.headline} dir="auto">
                    {item.headline}
                  </div>
                  {item.detail && (
                    <div style={styles.detail} dir="auto">
                      {item.detail}
                    </div>
                  )}
                </div>

                <div style={styles.footerRow}>
                  <div style={styles.footerMeta}>
                    {item.provider && (
                      <AgentProviderIdentity provider={item.provider} />
                    )}
                    {item.targetSummary && (
                      <span>{item.targetSummary}</span>
                    )}
                  </div>
                  <button
                    type="button"
                    data-testid="pending-approval-jump"
                    style={{
                      ...styles.actionButton,
                      background: isHovered ? "var(--surface-selected)" : "var(--surface-base)",
                      color: isHovered ? "var(--text-primary)" : "var(--text-secondary)",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(item.node);
                    }}
                  >
                    <span>Review</span>
                    <ArrowUpRight size={10} strokeWidth={2} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
