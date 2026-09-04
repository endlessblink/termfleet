import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, CirclePlay, Flag, RotateCcw, Sparkles, Timer, Trophy, UsersRound, X } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace";
import {
  activeQuestMission, collectGamificationFacts, EMPTY_GAMIFICATION_RECORD, findMissionTarget, GAMIFICATION_CHANGED_EVENT, loadGamificationRecord, nextAvailableQuest,
  retireCompletedQuest, saveGamificationRecord, summarizeGamification, syncGamificationRecord, type GamificationAchievement, type GamificationMission, type GamificationSummary,
} from "../lib/gamification";

const muted = { color: "var(--text-secondary)", fontSize: 11 };
const line = { borderTop: "1px solid var(--border-subtle)" };
const questAccent = { color: "var(--accent-info)" };
const rewardAccent = { color: "var(--accent-warning)" };
export const OPEN_WORKSTREAM_QUEST_EVENT = "termfleet:open-workstream-quest";
const formatMissionProgress = (mission: GamificationMission) => mission.id === "parallel-work"
  ? `${Math.floor(mission.progress / 60)}:${String(mission.progress % 60).padStart(2, "0")} / ${Math.floor(mission.target / 60)}:${String(mission.target % 60).padStart(2, "0")}`
  : `${mission.progress}/${mission.target}`;

export function GamificationPanel() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const [open, setOpen] = useState(false);
  const [resetArmed, setResetArmed] = useState(false);
  const [record, setRecord] = useState(() => loadGamificationRecord(window.localStorage));
  const [summary, setSummary] = useState<GamificationSummary>(() => summarizeGamification(record));
  const [questAccepted, setQuestAccepted] = useState(() => Boolean(activeQuestMission(record)));
  const [questCelebration, setQuestCelebration] = useState<GamificationAchievement | null>(null);
  const previousSummaryRef = useRef(summary);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const hoverCloseTimeoutRef = useRef<number | null>(null);
  const initialSyncRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const primaryMission = activeQuestMission(record, summary) ?? nextAvailableQuest(summary);
  const isWorkstreamQuest = primaryMission?.id === "parallel-work";
  const questMilestones = [
    { id: "parallel-warmup", label: "10m", title: "Parallel warm-up" },
    { id: "parallel-deep-focus", label: "30m", title: "Deep focus" },
    { id: "parallel-fleet-captain", label: "3h", title: "Fleet captain" },
  ].map((milestone) => ({
    ...milestone,
    earned: summary.achievements.some((achievement) => achievement.id === milestone.id && achievement.unlocked),
  }));
  const qualifyingTerminalCount = collectGamificationFacts(tabs).activeWorkstreams;
  const focusMission = (mission: GamificationMission) => {
    const target = findMissionTarget(tabs, mission.id);
    if (!target) return;
    setActiveTab(target.tabId);
    setActivePane(target.tabId, target.paneId);
    setOpen(false);
  };

  const celebrateQuestCompletion = (previous: GamificationSummary, next: GamificationSummary) => {
    const achievement = next.achievements.find((candidate) => candidate.id.startsWith("parallel-") && candidate.unlocked
      && !previous.achievements.some((old) => old.id === candidate.id && old.unlocked));
    if (!achievement) return;
    setQuestCelebration(achievement);
    setOpen(true);
    if (celebrationTimeoutRef.current !== null) window.clearTimeout(celebrationTimeoutRef.current);
    celebrationTimeoutRef.current = window.setTimeout(() => setQuestCelebration(null), 5500);
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
    setRecord(emptyRecord); setQuestAccepted(false); setSummary(empty); setResetArmed(false);
  };

  const acceptQuest = () => {
    if (!primaryMission) return;
    const accepted = { ...record, activeQuestId: primaryMission.id, questAcceptedAt: Date.now(), updatedAt: Date.now() };
    saveGamificationRecord(window.localStorage, accepted);
    setRecord(accepted);
    setQuestAccepted(true);
    setOpen(true);
  };

  useEffect(() => {
    const now = Date.now();
    const current = loadGamificationRecord(window.localStorage);
    const next = retireCompletedQuest(syncGamificationRecord(current, tabs, now));
    const nextSummary = summarizeGamification(next);
    const isInitialSync = !initialSyncRef.current;
    initialSyncRef.current = true;
    const previousSummary = previousSummaryRef.current;
    previousSummaryRef.current = nextSummary;
    saveGamificationRecord(window.localStorage, next);
    setRecord(next);
    setQuestAccepted(Boolean(activeQuestMission(next, nextSummary)));
    setSummary(nextSummary);
    if (isInitialSync) return;
    celebrateQuestCompletion(previousSummary, nextSummary);
  }, [tabs, questAccepted]);

  useEffect(() => {
    if (!questAccepted) return;
    const refresh = () => {
      const current = loadGamificationRecord(window.localStorage);
      const next = retireCompletedQuest(syncGamificationRecord(current, tabs, Date.now()));
      const previousSummary = previousSummaryRef.current;
      const nextSummary = summarizeGamification(next);
      previousSummaryRef.current = nextSummary;
      saveGamificationRecord(window.localStorage, next);
      setRecord(next);
      setQuestAccepted(Boolean(activeQuestMission(next, nextSummary)));
      setSummary(nextSummary);
      celebrateQuestCompletion(previousSummary, nextSummary);
    };
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, [tabs, questAccepted]);

  useEffect(() => {
    const syncExternalProgress = () => {
      const next = loadGamificationRecord(window.localStorage);
      const previousSummary = previousSummaryRef.current;
      const nextSummary = summarizeGamification(next);
      previousSummaryRef.current = nextSummary;
      setRecord(next);
      setQuestAccepted(Boolean(activeQuestMission(next, nextSummary)));
      setSummary(nextSummary);
      celebrateQuestCompletion(previousSummary, nextSummary);
    };
    window.addEventListener(GAMIFICATION_CHANGED_EVENT, syncExternalProgress);
    window.addEventListener("storage", syncExternalProgress);
    return () => {
      window.removeEventListener(GAMIFICATION_CHANGED_EVENT, syncExternalProgress);
      window.removeEventListener("storage", syncExternalProgress);
    };
  }, []);

  useEffect(() => () => {
    if (celebrationTimeoutRef.current !== null) window.clearTimeout(celebrationTimeoutRef.current);
    if (hoverCloseTimeoutRef.current !== null) window.clearTimeout(hoverCloseTimeoutRef.current);
  }, []);

  const keepQuestOpen = () => {
    if (hoverCloseTimeoutRef.current !== null) window.clearTimeout(hoverCloseTimeoutRef.current);
    setOpen(true);
  };
  const closeQuestAfterHover = () => {
    if (hoverCloseTimeoutRef.current !== null) window.clearTimeout(hoverCloseTimeoutRef.current);
    hoverCloseTimeoutRef.current = window.setTimeout(() => setOpen(false), 180);
  };

  useEffect(() => {
    const openQuest = () => setOpen(true);
    window.addEventListener(OPEN_WORKSTREAM_QUEST_EVENT, openQuest);
    return () => window.removeEventListener(OPEN_WORKSTREAM_QUEST_EVENT, openQuest);
  }, []);

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

  return <div data-gamification-root style={{ position: "relative", flexShrink: 0 }} onPointerEnter={keepQuestOpen} onPointerLeave={closeQuestAfterHover}>
    <button ref={triggerRef} type="button" data-testid="gamification-trigger" aria-expanded={open} aria-haspopup="dialog" aria-label="Open Workstream Quest" style={{ height: 28, display: "inline-flex", alignItems: "center", gap: 7, padding: "0 9px", borderTop: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 11 }} onClick={keepQuestOpen}><span style={{ color: "var(--accent-live)", fontWeight: 500 }}>Quest</span><span style={muted}>{primaryMission ? formatMissionProgress(primaryMission).split(" /")[0] : "Ready"}</span><ChevronDown size={12} /></button>
    {open && <section role="dialog" aria-label="Workstream Quest" data-testid="gamification-panel" className="gamification-quest-panel">
      <header className="gamification-quest-header"><div className="gamification-quest-heading"><span aria-hidden="true" style={questAccent}><Flag size={16} /></span><div><div>Workstream quest</div><h2>{primaryMission?.title ?? "All quests complete"}</h2></div></div><button type="button" aria-label="Close progress panel" onClick={() => setOpen(false)}><X size={15} /></button></header>
      {questCelebration ? <div className="gamification-quest-celebration" data-testid="gamification-quest-complete" aria-live="polite"><span className="gamification-quest-celebration-mark" aria-hidden="true" style={rewardAccent}><Sparkles size={15} /></span><div><strong>Milestone earned</strong><span>{questCelebration.title}</span></div><button type="button" aria-label="Dismiss quest celebration" onClick={() => setQuestCelebration(null)}>Dismiss</button></div> : null}
      {primaryMission && <div className="gamification-quest-progress"><div className="gamification-quest-status-row" data-testid="gamification-quest-status" aria-live="polite">{isWorkstreamQuest ? <span className={qualifyingTerminalCount >= 3 ? "is-counting" : ""}><UsersRound size={15} /> {Math.min(qualifyingTerminalCount, 3)}/3</span> : <span><Flag size={15} /> {primaryMission.progress}/{primaryMission.target}</span>}<span><Timer size={15} /> {formatMissionProgress(primaryMission)}</span></div><div data-testid="gamification-progress-bar" className="gamification-quest-progress-bar"><div style={{ width: `${Math.min(100, (primaryMission.progress / primaryMission.target) * 100)}%` }} /></div>{isWorkstreamQuest ? <div className="gamification-milestone-rail" data-testid="gamification-milestone-rail" aria-label="Quest milestones">{questMilestones.map((milestone, index) => <div key={milestone.id} data-state={milestone.earned ? "earned" : primaryMission.target === [600, 1800, 10800][index] ? "next" : "later"} title={`${milestone.title}: ${milestone.earned ? "earned" : "not yet"}`}><span aria-hidden="true">{milestone.earned ? <Check size={13} /> : index === 2 ? <Trophy size={13} /> : <Timer size={13} />}</span><b>{milestone.label}</b></div>)}</div> : null}</div>}
      {questAccepted ? <div className="gamification-quest-callout" data-testid="gamification-active-count"><span aria-hidden="true">{isWorkstreamQuest && qualifyingTerminalCount >= 3 ? <Sparkles size={14} /> : isWorkstreamQuest ? <UsersRound size={14} /> : <Flag size={14} />}</span>{isWorkstreamQuest ? (qualifyingTerminalCount >= 3 ? "Quest started · timer is counting" : `Quest started · Paused · add ${Math.max(0, 3 - qualifyingTerminalCount)} live terminal${qualifyingTerminalCount === 2 ? "" : "s"}`) : primaryMission?.nextAction}</div> : <button type="button" data-testid="gamification-accept" className="gamification-quest-accept" onClick={acceptQuest}><Flag size={14} /> Start quest</button>}
      {questAccepted && primaryMission && findMissionTarget(tabs, primaryMission.id) ? <button type="button" data-testid={`gamification-focus-${primaryMission.id}`} onClick={() => focusMission(primaryMission)} className="gamification-quest-focus"><CirclePlay size={13} /> Focus a workstream</button> : null}
      {questAccepted && <div style={{ ...line, marginTop: 14, paddingTop: 10, display: "flex", justifyContent: "flex-end" }}>{!resetArmed ? <button type="button" data-testid="gamification-reset" className="gamification-quest-reset" onClick={() => setResetArmed(true)} aria-label="Reset quest progress"><RotateCcw size={12} /> Reset</button> : <div role="group" aria-label="Confirm progress reset"><button type="button" data-testid="gamification-reset-confirm" className="gamification-quest-confirm" onClick={resetProgress}>Reset quest</button><button type="button" onClick={() => setResetArmed(false)} className="gamification-quest-reset">Cancel</button></div>}</div>}
    </section>}
  </div>;
}
