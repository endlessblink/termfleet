import { useEffect, useRef, useState } from "react";
import { Award, Check, ChevronDown, Trophy, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import {
  collectGamificationFacts,
  loadGamificationRecord,
  mergeGamificationRecord,
  saveGamificationRecord,
  rewardForTransition,
  summarizeGamification,
  type GamificationSummary,
} from "../lib/gamification";

const styles = {
  anchor: { position: "relative" as const, flexShrink: 0 },
  trigger: {
    height: 28, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px",
    border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)",
    background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer",
    fontFamily: "var(--font-ui)", fontSize: 11,
  },
  panel: {
    position: "fixed" as const, top: 42, right: 18, width: 348, maxWidth: "calc(100vw - 24px)",
    padding: 14, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)",
    background: "var(--surface-raised)", boxShadow: "var(--shadow-menu)", zIndex: 70,
    animation: "workbench-popover-in var(--motion-med)",
  },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  eyebrow: { color: "var(--accent-live)", fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase" as const },
  muted: { color: "var(--text-secondary)", fontSize: 11 },
  close: { width: 24, height: 24, display: "grid", placeItems: "center", border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" },
  level: { display: "flex", alignItems: "center", gap: 10, marginTop: 12, padding: "10px 0", borderTop: "1px solid var(--border-subtle)", borderBottom: "1px solid var(--border-subtle)" },
  levelMark: { width: 34, height: 34, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--command-chip-active-bg)", color: "var(--accent-warning)" },
  progressTrack: { height: 5, marginTop: 8, overflow: "hidden", borderRadius: 99, background: "var(--surface-hover)" },
  progressFill: { height: "100%", borderRadius: 99, background: "var(--accent-live)", transition: "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)", transformOrigin: "left" },
  metrics: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 },
  metric: { padding: "8px 9px", background: "var(--surface-base)", borderRadius: "var(--radius-sm)" },
  metricValue: { display: "block", marginTop: 3, color: "var(--text-primary)", fontFamily: "var(--font-mono)", fontSize: 15 },
  section: { marginTop: 14 },
  sectionTitle: { display: "flex", alignItems: "center", gap: 6, marginBottom: 7, color: "var(--text-primary)", fontSize: 12, fontWeight: 500 },
  achievement: { display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border-subtle)" },
  achievementIcon: { width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%", background: "var(--surface-hover)", color: "var(--text-tertiary)" },
  rule: { display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "baseline", gap: 8, padding: "7px 0", borderTop: "1px solid var(--border-subtle)" },
  reset: { marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-subtle)", color: "var(--text-tertiary)", fontSize: 10 },
};

export function GamificationPanel() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const [open, setOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [summary, setSummary] = useState<GamificationSummary>(() => summarizeGamification(loadGamificationRecord(window.localStorage)));
  const [rewardPulse, setRewardPulse] = useState(false);
  const [reward, setReward] = useState<{ title: string; detail: string } | null>(null);
  const previousSummaryRef = useRef(summary);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const resetProgress = () => {
    const facts = collectGamificationFacts(tabs);
    saveGamificationRecord(window.localStorage, {
      version: 1,
      completedTaskIds: [],
      maxConcurrentTerminals: 0,
      ignoredTaskIds: facts.completedTaskIds,
      baselineConcurrentTerminals: facts.activeWorkstreams,
      updatedAt: Date.now(),
    });
    const empty = summarizeGamification(loadGamificationRecord(window.localStorage));
    previousSummaryRef.current = empty;
    setReward(null);
    setRewardPulse(false);
    setSummary(empty);
    setResetArmed(false);
  };

  useEffect(() => {
    const current = loadGamificationRecord(window.localStorage);
    const next = mergeGamificationRecord(current, collectGamificationFacts(tabs), Date.now());
    const nextSummary = summarizeGamification(next);
    const previousSummary = previousSummaryRef.current;
    const reward = rewardForTransition(previousSummary, nextSummary);
    if (reward) {
      setRewardPulse(true);
      setReward(reward);
      const pulseTimeout = window.setTimeout(() => setRewardPulse(false), 900);
      const rewardTimeout = window.setTimeout(() => setReward(null), 2600);
      previousSummaryRef.current = nextSummary;
      saveGamificationRecord(window.localStorage, next);
      setSummary(nextSummary);
      return () => { window.clearTimeout(pulseTimeout); window.clearTimeout(rewardTimeout); };
    }
    previousSummaryRef.current = nextSummary;
    saveGamificationRecord(window.localStorage, next);
    setSummary(nextSummary);
  }, [tabs]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-gamification-root]")) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  return (
    <div data-gamification-root style={styles.anchor}>
      {reward && (
        <div role="status" data-testid="gamification-reward" style={{ position: "fixed", top: 48, right: 18, width: 270, display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "1px solid var(--border-focus)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)", boxShadow: "var(--shadow-menu)", zIndex: 80, animation: "gamification-reward-toast 500ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
          <span style={{ ...styles.levelMark, width: 30, height: 30, flexShrink: 0 }}><Award size={16} /></span>
          <span><strong style={{ display: "block", color: "var(--text-primary)", fontSize: 12 }}>{reward.title}</strong><span style={styles.muted}>{reward.detail}</span></span>
        </div>
      )}
      <button
        ref={triggerRef}
        type="button"
        data-testid="gamification-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Progress level ${summary.level}, ${summary.points} points`}
        style={{ ...styles.trigger, ...(rewardPulse ? { animation: "gamification-reward-pulse 700ms ease-out" } : null) }}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <Trophy size={14} strokeWidth={1.8} color="var(--accent-warning)" />
        <span>Lv {summary.level}</span>
        <span style={styles.muted}>{summary.points} pts</span>
        <ChevronDown size={12} strokeWidth={1.8} />
      </button>
      {open && (
        <section role="dialog" aria-label="Progress and achievements" data-testid="gamification-panel" style={styles.panel}>
          <div style={styles.header}>
            <div><div style={styles.eyebrow}>Your progress</div><h2 style={{ marginTop: 4, color: "var(--text-primary)", fontSize: 17, fontWeight: 500 }}>Keep the work moving</h2></div>
            <button type="button" aria-label="Close progress panel" style={styles.close} onClick={() => setOpen(false)}><X size={15} /></button>
          </div>
          <div style={styles.level}>
            <span style={styles.levelMark}><Trophy size={18} /></span>
            <div style={{ flex: 1 }}><div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-primary)", fontSize: 12 }}><strong>Level {summary.level}</strong><span style={styles.muted}>{summary.points} pts</span></div><div style={styles.progressTrack}><div role="progressbar" aria-label="Progress to next level" aria-valuenow={summary.levelProgressPercent} aria-valuemin={0} aria-valuemax={100} style={{ ...styles.progressFill, transform: `scaleX(${summary.levelProgressPercent / 100})` }} /></div><div style={{ ...styles.muted, marginTop: 5 }}>{summary.nextLevelPoints === null ? "Lifetime track complete" : `${summary.nextLevelPoints - summary.points} points to level ${summary.level + 1}`}</div></div>
          </div>
          <div style={styles.metrics}><div style={styles.metric}><span style={styles.muted}>Goals finished</span><strong style={styles.metricValue}>{summary.completedGoals}</strong></div><div style={styles.metric}><span style={styles.muted}>Peak active workstreams</span><strong style={styles.metricValue}>{summary.maxConcurrentTerminals}</strong></div></div>
          <div style={styles.section}><div style={styles.sectionTitle}><Award size={14} /> Achievements</div>{summary.achievements.map((achievement) => <div key={achievement.id} style={styles.achievement}><span style={{ ...styles.achievementIcon, ...(achievement.unlocked ? { color: "var(--accent-live)", background: "var(--command-chip-active-bg)" } : null) }}>{achievement.unlocked ? <Check size={13} /> : <Award size={13} />}</span><div><div style={{ color: "var(--text-primary)", fontSize: 11 }}>{achievement.title}</div><div style={styles.muted}>{achievement.unlocked ? `Unlocked · ${achievement.description}` : achievement.description}</div></div></div>)}</div>
          <div style={styles.section}><div style={styles.sectionTitle}><Trophy size={14} /> How points work</div><div style={styles.rule}><strong style={{ color: "var(--accent-live)", fontFamily: "var(--font-mono)", fontSize: 12 }}>+25</strong><span style={styles.muted}>Complete a unique tracked goal</span><span style={{ color: "var(--text-primary)", fontSize: 10 }}>per goal</span></div><div style={styles.rule}><strong style={{ color: "var(--accent-live)", fontFamily: "var(--font-mono)", fontSize: 12 }}>+10</strong><span style={styles.muted}>Reach a new peak of active workstreams</span><span style={{ color: "var(--text-primary)", fontSize: 10 }}>per peak</span></div><div style={{ ...styles.muted, marginTop: 8 }}>Example: 2 finished goals and 3 terminals actively carrying work = 80 points.</div></div>
          <div style={styles.reset}>
            {!resetArmed ? (
              <>
                <button type="button" data-testid="gamification-reset" style={{ border: 0, padding: 0, background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", font: "inherit" }} onClick={() => setResetArmed(true)}>Reset my progress</button>
                <div style={{ marginTop: 4 }}>Clears points, levels, and achievements only.</div>
              </>
            ) : (
              <div role="group" aria-label="Confirm progress reset" style={{ display: "grid", gap: 7 }}>
                <strong style={{ color: "var(--text-primary)", fontSize: 11 }}>Reset local progress?</strong>
                <span style={styles.muted}>This resets your points, level, and achievements. Your workspace stays unchanged.</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" data-testid="gamification-reset-confirm" onClick={resetProgress} style={{ border: "1px solid var(--border-focus)", borderRadius: "var(--radius-xs)", padding: "5px 8px", background: "var(--surface-selected)", color: "var(--text-primary)", cursor: "pointer", font: "inherit", fontSize: 11 }}>Confirm reset</button>
                  <button type="button" onClick={() => setResetArmed(false)} style={{ border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)", padding: "5px 8px", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", font: "inherit", fontSize: 11 }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
