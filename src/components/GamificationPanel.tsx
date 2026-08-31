import { useEffect, useRef, useState } from "react";
import { ChevronDown, CirclePlay, RotateCcw, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import {
  collectGamificationFacts, EMPTY_GAMIFICATION_RECORD, findMissionTarget, isWorkstreamQuestAccepted, loadGamificationRecord, syncGamificationRecord,
  saveGamificationRecord, summarizeGamification, WORKSTREAM_QUEST_ID, type GamificationMission, type GamificationSummary,
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
  const [acceptedJustNow, setAcceptedJustNow] = useState(false);
  const [record, setRecord] = useState(() => loadGamificationRecord(window.localStorage));
  const [summary, setSummary] = useState<GamificationSummary>(() => summarizeGamification(record));
  const [questAccepted, setQuestAccepted] = useState(() => isWorkstreamQuestAccepted(record));
  const previousSummaryRef = useRef(summary);
  const initialSyncRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const unfinished = summary.missions.filter((mission) => !mission.complete);
  const primaryMission = unfinished.find((mission) => mission.id === selectedMission)
    ?? unfinished.find((mission) => mission.id === "parallel-work")
    ?? unfinished[0];
  const qualifyingTerminalCount = collectGamificationFacts(tabs).activeWorkstreams;
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
    const emptyRecord = loadGamificationRecord(window.localStorage);
    const empty = summarizeGamification(emptyRecord);
    previousSummaryRef.current = empty;
    setRecord(emptyRecord); setQuestAccepted(false); setSummary(empty); setResetArmed(false); setSelectedMission(null);
  };

  const acceptQuest = () => {
    const accepted = { ...record, activeQuestId: WORKSTREAM_QUEST_ID, questAcceptedAt: Date.now(), updatedAt: Date.now() };
    saveGamificationRecord(window.localStorage, accepted);
    setRecord(accepted);
    setQuestAccepted(true);
    setAcceptedJustNow(true);
    setOpen(true);
    window.setTimeout(() => setAcceptedJustNow(false), 1800);
  };

  useEffect(() => {
    const now = Date.now();
    const current = loadGamificationRecord(window.localStorage);
    const nextBase = syncGamificationRecord(current, tabs, now);
    const next = questAccepted && !isWorkstreamQuestAccepted(nextBase)
      ? { ...nextBase, activeQuestId: WORKSTREAM_QUEST_ID, questAcceptedAt: current.questAcceptedAt ?? Date.now() }
      : nextBase;
    const nextSummary = summarizeGamification(next);
    const isInitialSync = !initialSyncRef.current;
    initialSyncRef.current = true;
    previousSummaryRef.current = nextSummary;
    saveGamificationRecord(window.localStorage, next);
    setRecord(next);
    setQuestAccepted(isWorkstreamQuestAccepted(next));
    setSummary(nextSummary);
    if (isInitialSync) return;
  }, [tabs, questAccepted]);

  useEffect(() => {
    if (!questAccepted) return;
    const refresh = () => {
      const current = loadGamificationRecord(window.localStorage);
      const nextBase = syncGamificationRecord(current, tabs, Date.now());
      const next = isWorkstreamQuestAccepted(current)
        ? nextBase
        : { ...nextBase, activeQuestId: WORKSTREAM_QUEST_ID, questAcceptedAt: current.questAcceptedAt ?? Date.now() };
      saveGamificationRecord(window.localStorage, next);
      setRecord(next);
      setQuestAccepted(isWorkstreamQuestAccepted(next));
      setSummary(summarizeGamification(next));
    };
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [tabs, questAccepted]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => { if (!(event.target instanceof Element) || !event.target.closest("[data-gamification-root]")) setOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    // Terminal canvases keep focus while the panel is open. Capture Escape
    // before the terminal input can consume it so the panel always closes.
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return <div data-gamification-root style={{ position: "relative", flexShrink: 0 }}>
    <button ref={triggerRef} type="button" data-testid="gamification-trigger" aria-expanded={open} aria-haspopup="dialog" aria-label="Open Workstream Quest" style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px", borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 11 }} onClick={() => setOpen((value) => !value)}><span style={{ color: "var(--accent-live)", fontWeight: 500 }}>Quest</span><span style={muted}>{primaryMission ? formatMissionProgress(primaryMission).split(" /")[0] : "Ready"}</span><ChevronDown size={12} /></button>
    {open && <section role="dialog" aria-label="Workstream Quest" data-testid="gamification-panel" style={{ position: "fixed", top: 42, right: 18, width: 320, maxWidth: "calc(100vw - 24px)", padding: 16, borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", background: "linear-gradient(145deg, color-mix(in srgb, var(--accent-info) 12%, var(--surface-raised)), color-mix(in srgb, var(--accent-warning) 7%, var(--surface-raised)))", boxShadow: "var(--shadow-menu)", zIndex: 70, animation: "gamification-panel-in 280ms cubic-bezier(0.16, 1, 0.3, 1)" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}><div><div style={{ color: "var(--accent-live)", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" }}>Workstream quest</div><h2 style={{ margin: "6px 0 0", color: "var(--text-primary)", fontSize: 20, lineHeight: 1.05, fontWeight: 500 }}>Hold the line</h2><p style={{ ...muted, margin: "6px 0 0" }}>Keep 3 workstreams active without a break.</p></div><button type="button" aria-label="Close progress panel" style={{ border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }} onClick={() => setOpen(false)}><X size={15} /></button></header>
      {acceptedJustNow ? <div data-testid="gamification-accepted" style={{ marginTop: 14, padding: "9px 10px", borderRadius: "var(--radius-xs)", background: "color-mix(in srgb, var(--accent-live) 16%, var(--surface-hover))", color: "var(--text-primary)", fontSize: 11, fontWeight: 500 }}>Quest accepted <span style={{ display: "block", marginTop: 3, color: "var(--text-secondary)", fontWeight: 400 }}>Your live terminals will light up as they count.</span></div> : null}
      {primaryMission ? <div style={{ marginTop: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><strong style={{ color: "var(--text-primary)", fontSize: 13 }}>{(questAccepted || acceptedJustNow) ? primaryMission.title.replace("Keep 3 workstreams running for ", "Next milestone: ") : "A 10-minute live run"}</strong>{(questAccepted || acceptedJustNow) ? <span style={{ color: "var(--accent-info)", fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{formatMissionProgress(primaryMission)}</span> : null}</div>{(questAccepted || acceptedJustNow) ? <><div data-testid="gamification-active-count" style={{ marginTop: 10, color: qualifyingTerminalCount >= 3 ? "var(--accent-live)" : "var(--text-secondary)", fontSize: 12, fontWeight: 500 }}>{Math.min(qualifyingTerminalCount, 3)}/3 terminals counting</div><div data-testid="gamification-progress-bar" style={{ height: 8, marginTop: 7, overflow: "hidden", borderRadius: 99, background: "color-mix(in srgb, var(--text-primary) 15%, transparent)" }}><div style={{ width: `${Math.min(100, (primaryMission.progress / primaryMission.target) * 100)}%`, height: "100%", borderRadius: 99, background: "var(--accent-info)", transition: "width 300ms ease" }} /></div><p style={{ ...muted, margin: "9px 0 0" }}>The timer runs only at 3/3. A stopped or disconnected terminal resets this run; earned milestones stay earned.</p></> : <p style={{ ...muted, margin: "9px 0 0" }}>Accept this quest to light up the terminals that count and start the timer.</p>}{(questAccepted || acceptedJustNow) ? (findMissionTarget(tabs, primaryMission.id) ? <button type="button" data-testid={`gamification-focus-${primaryMission.id}`} onClick={() => focusMission(primaryMission)} style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 12, padding: "7px 10px", border: 0, borderRadius: "var(--radius-xs)", background: "var(--surface-hover)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11 }}><CirclePlay size={12} /> Focus a workstream</button> : <span style={{ display: "block", marginTop: 12, color: "var(--text-tertiary)", fontSize: 11 }}>Keep three terminals live to begin.</span>) : <button type="button" data-testid="gamification-accept" onClick={acceptQuest} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 14, padding: "8px 11px", border: 0, borderRadius: "var(--radius-xs)", background: "var(--accent-info)", color: "var(--surface-base)", cursor: "pointer", fontWeight: 500, fontSize: 11 }}>Accept quest <ChevronDown size={12} style={{ transform: "rotate(-90deg)" }} /></button>}</div> : <div style={{ marginTop: 16, color: "var(--text-primary)", fontSize: 13 }}>All milestones complete. Start a new run when you are ready.</div>}
      <div style={{ ...line, marginTop: 16, paddingTop: 11, display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ ...muted, fontSize: 10 }}>Next: 30 minutes, then 3 hours</span>{!resetArmed ? <button type="button" data-testid="gamification-reset" onClick={() => setResetArmed(true)} style={{ display: "inline-flex", gap: 5, alignItems: "center", border: 0, padding: 0, background: "transparent", color: "var(--text-tertiary)", cursor: "pointer", font: "inherit", fontSize: 10 }}><RotateCcw size={11} /> Reset</button> : <div role="group" aria-label="Confirm progress reset"><button type="button" data-testid="gamification-reset-confirm" onClick={resetProgress} style={{ marginRight: 8, padding: "5px 8px", border: 0, borderRadius: "var(--radius-xs)", background: "var(--surface-selected)", color: "var(--text-primary)", cursor: "pointer", fontSize: 11 }}>Confirm reset</button><button type="button" onClick={() => setResetArmed(false)} style={{ padding: "5px 8px", border: 0, background: "transparent", color: "var(--text-secondary)", cursor: "pointer", fontSize: 11 }}>Cancel</button></div>}</div>
    </section>}
  </div>;
}
