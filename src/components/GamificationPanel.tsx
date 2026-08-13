import { useEffect, useRef, useState } from "react";
import { Award, Check, ChevronDown, CirclePlay, RotateCcw, Trophy, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import {
  collectGamificationFacts, EMPTY_GAMIFICATION_RECORD, findMissionTarget, initializeGamificationRecord, loadGamificationRecord, mergeGamificationRecord,
  saveGamificationRecord, summarizeGamification, type GamificationMission, type GamificationSummary,
} from "../lib/gamification";

const muted = { color: "var(--text-secondary)", fontSize: 11 };
const line = { borderTop: "1px solid var(--border-subtle)" };
const formatMissionProgress = (mission: GamificationMission) => mission.id === "parallel-work"
  ? `${Math.floor(mission.progress / 60)}:${String(mission.progress % 60).padStart(2, "0")} / ${Math.floor(mission.target / 60)}:${String(mission.target % 60).padStart(2, "0")}`
  : `${mission.progress}/${mission.target}`;

export function GamificationPanel() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const [open, setOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [summary, setSummary] = useState<GamificationSummary>(() => summarizeGamification(loadGamificationRecord(window.localStorage)));
  const previousSummaryRef = useRef(summary);
  const initialSyncRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const unfinished = summary.missions.filter((mission) => !mission.complete);
  const primaryMission = unfinished.find((mission) => mission.id === selectedMission)
    ?? unfinished.find((mission) => mission.id === "parallel-work")
    ?? unfinished[0];
  const focusMission = (mission: GamificationMission) => {
    const target = findMissionTarget(tabs, mission.id);
    if (!target) return;
    setActiveTab(target.tabId);
    setActivePane(target.tabId, target.paneId);
    setOpen(false);
  };

  const resetProgress = () => {
    const facts = collectGamificationFacts(tabs);
    const current = loadGamificationRecord(window.localStorage);
    saveGamificationRecord(window.localStorage, {
      ...EMPTY_GAMIFICATION_RECORD,
      ignoredEventIds: [...new Set([...current.events.map((event) => event.id), ...facts.events.map((event) => event.id)])],
      baselineActiveWorkstreams: facts.activeWorkstreams,
      initializedAt: Date.now(),
      updatedAt: Date.now(),
    });
    const empty = summarizeGamification(loadGamificationRecord(window.localStorage));
    previousSummaryRef.current = empty;
    setSummary(empty); setResetArmed(false); setSelectedMission(null);
  };

  useEffect(() => {
    const now = Date.now();
    const facts = collectGamificationFacts(tabs);
    const current = initializeGamificationRecord(loadGamificationRecord(window.localStorage), facts, now);
    const next = mergeGamificationRecord(current, facts, now);
    const nextSummary = summarizeGamification(next);
    const isInitialSync = !initialSyncRef.current;
    initialSyncRef.current = true;
    previousSummaryRef.current = nextSummary;
    saveGamificationRecord(window.localStorage, next);
    setSummary(nextSummary);
    if (isInitialSync) return;
  }, [tabs]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-gamification-root]")) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", onPointerDown); document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); document.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  const badgeCount = summary.achievements.filter((achievement) => achievement.unlocked).length;
  const nextBadge = summary.achievements.find((achievement) => !achievement.unlocked);

  return <div data-gamification-root style={{ position: "relative", flexShrink: 0 }}>
    <button ref={triggerRef} type="button" data-testid="gamification-trigger" aria-expanded={open} aria-haspopup="dialog" aria-label={`Progress level ${summary.level}, ${summary.points} points`} style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px", borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 11 }} onClick={() => setOpen((value) => !value)}><Trophy size={14} color="var(--accent-warning)" /><span>Lv {summary.level}</span><span style={muted}>{summary.points} pts</span><ChevronDown size={12} /></button>
    {open && <section role="dialog" aria-label="Progress and achievements" data-testid="gamification-panel" style={{ position: "fixed", top: 42, right: 18, width: 320, maxWidth: "calc(100vw - 24px)", padding: 14, borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "var(--surface-raised)", boxShadow: "var(--shadow-menu)", zIndex: 70, animation: "gamification-panel-in 280ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><div style={{ color: "var(--accent-live)", fontSize: 10, textTransform: "uppercase" }}>Fleet Rank</div><h2 style={{ margin: "4px 0 0", color: "var(--text-primary)", fontSize: 17, fontWeight: 500 }}>Rank {summary.level} · {summary.points} Ops</h2><p style={{ ...muted, margin: "5px 0 0" }}>Real terminal work only. Nothing is awarded on launch.</p></div><button type="button" aria-label="Close progress panel" style={{ border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }} onClick={() => setOpen(false)}><X size={15} /></button></header>
      <div style={{ ...line, marginTop: 14, paddingTop: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 500 }}>Workstream quest</span><span style={muted}>{summary.nextLevelPoints === null ? "Max rank" : `${summary.nextLevelPoints - summary.points} Ops to next rank`}</span></div>
        {primaryMission ? <div style={{ marginTop: 9, padding: 12, background: "color-mix(in srgb, var(--accent-info) 10%, var(--surface-selected))" }}><strong style={{ display: "block", color: "var(--text-primary)", fontSize: 14 }}>{primaryMission.title}</strong><span style={{ ...muted, display: "block", marginTop: 4 }}>{primaryMission.detail}</span><div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 11 }}><span style={{ color: "var(--accent-info)", fontSize: 11 }}>{formatMissionProgress(primaryMission)} complete</span><div style={{ flex: 1, height: 4, overflow: "hidden", borderRadius: 99, background: "var(--surface-hover)" }}><div style={{ width: `${Math.min(100, (primaryMission.progress / primaryMission.target) * 100)}%`, height: "100%", background: "var(--accent-info)", transition: "width 300ms ease" }} /></div></div><span style={{ ...muted, display: "block", marginTop: 8 }}>What counts: {primaryMission.nextAction}</span>{findMissionTarget(tabs, primaryMission.id) ? <button type="button" data-testid={`gamification-focus-${primaryMission.id}`} onClick={() => focusMission(primaryMission)} style={{ marginTop: 10, padding: "6px 9px", border: 0, borderTop: "1px solid var(--border-focus)", background: "var(--surface-hover)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11 }}><CirclePlay size={12} /> Open active workstream</button> : <span style={{ display: "block", marginTop: 10, color: "var(--text-tertiary)", fontSize: 10 }}>This challenge appears when an active workstream is running.</span>}</div> : <div style={{ marginTop: 9, padding: 12, background: "var(--surface-selected)" }}><strong style={{ color: "var(--text-primary)", fontSize: 13 }}>All current challenges complete</strong><span style={{ ...muted, display: "block", marginTop: 4 }}>Keep working in TermFleet to reveal the next one.</span></div>}
      </div>
      <div style={{ ...line, marginTop: 12, paddingTop: 10 }}><div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}><span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 500 }}><Award size={13} color="var(--accent-warning)" /> Latest badge</span><span style={muted}>{badgeCount} earned</span></div>{summary.achievements.filter((achievement) => achievement.unlocked).slice(-1).map((achievement) => <div key={achievement.id} data-testid="gamification-latest-win" style={{ display: "flex", gap: 8, marginTop: 8, padding: "8px 0", color: "var(--text-primary)", fontSize: 11 }}><Check size={14} color="var(--accent-warning)" /><span><strong>{achievement.title}</strong><span style={{ ...muted, display: "block", marginTop: 2 }}>{achievement.evidence}</span></span></div>)}{nextBadge && <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border-subtle)" }}><span style={muted}>Next badge</span><strong style={{ display: "block", marginTop: 3, color: "var(--text-primary)", fontSize: 11 }}>{nextBadge.title}</strong></div>}</div>
      <div style={{ ...line, marginTop: 12, paddingTop: 10 }}>{!resetArmed ? <button type="button" data-testid="gamification-reset" onClick={() => setResetArmed(true)} style={{ display: "inline-flex", gap: 5, alignItems: "center", border: 0, padding: 0, background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", font: "inherit", fontSize: 10 }}><RotateCcw size={11} /> Start a new run</button> : <div role="group" aria-label="Confirm progress reset"><strong style={{ display: "block", color: "var(--text-primary)", fontSize: 11 }}>Start a new run?</strong><span style={{ ...muted, display: "block", margin: "4px 0 7px" }}>Only this local score resets. Your workspace stays unchanged.</span><button type="button" data-testid="gamification-reset-confirm" onClick={resetProgress} style={{ marginRight: 8, padding: "5px 8px", borderTop: "1px solid var(--border-focus)", borderRadius: "var(--radius-xs)", background: "var(--surface-selected)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11 }}>Start fresh</button><button type="button" onClick={() => setResetArmed(false)} style={{ padding: "5px 8px", borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-xs)", background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11 }}>Cancel</button></div>}</div>
    </section>}
  </div>;
}
