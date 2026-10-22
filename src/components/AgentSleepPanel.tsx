// What a sleeping agent terminal shows instead of its screen, and the per-terminal
// "Keep awake" switch. Rules and wording: src/lib/agentSleep.ts, termcontrol/bridge/sleep.mjs.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearSleepRecord,
  readKeepAwake,
  readSleepRecord,
  sleptForText,
  touchViewing,
  writeKeepAwake,
  type SleepRecord,
} from "../lib/agentSleep";
import "./AgentSleepPanel.css";

export type AgentSleepState = "unknown" | "asleep" | "awake";

const POLL_MS = 3000;
const VIEWING_MS = 30_000;

/**
 * Whether this terminal is asleep. Starts "unknown" so a sleeping card is never reattached
 * (which would wake it) before the first look. `inFront` = Noam is looking at it right now.
 */
export function useAgentSleep(sessionId: string, enabled: boolean, inFront: boolean) {
  const [state, setState] = useState<AgentSleepState>(enabled ? "unknown" : "awake");
  const [record, setRecord] = useState<SleepRecord | null>(null);
  const [keepAwake, setKeepAwake] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setState("awake");
      return;
    }
    let stopped = false;
    const look = async () => {
      const found = await readSleepRecord(sessionId);
      if (stopped) return;
      setRecord(found);
      setState(found ? "asleep" : "awake");
    };
    void look();
    const timer = setInterval(() => void look(), POLL_MS);
    void readKeepAwake(sessionId).then((on) => {
      if (!stopped) setKeepAwake(on);
    });
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [enabled, sessionId]);

  useEffect(() => {
    if (!enabled || !inFront || state !== "awake") return;
    const beat = () => {
      if (document.visibilityState === "visible" && document.hasFocus()) void touchViewing(sessionId);
    };
    beat();
    const timer = setInterval(beat, VIEWING_MS);
    window.addEventListener("focus", beat);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", beat);
    };
  }, [enabled, inFront, sessionId, state]);

  const markAsleep = useCallback((found: SleepRecord) => {
    setRecord(found);
    setState("asleep");
  }, []);

  const wake = useCallback(async () => {
    // Mounting the terminal again is the wake: the terminal service resumes the conversation.
    await clearSleepRecord(sessionId);
    void touchViewing(sessionId);
    setRecord(null);
    setState("awake");
  }, [sessionId]);

  const toggleKeepAwake = useCallback(async () => {
    setKeepAwake(await writeKeepAwake(sessionId, !keepAwake));
  }, [keepAwake, sessionId]);

  return { state, record, keepAwake, markAsleep, wake, toggleKeepAwake };
}

export function AgentSleepPanel({
  record,
  pending,
  onWake,
}: {
  record: SleepRecord | null;
  pending: boolean;
  onWake: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const freedMb = record?.freedBytes ? Math.round(record.freedBytes / 1048576) : null;
  if (pending) return <div className="terminal-container agent-sleep-panel agent-sleep-panel--pending" />;
  return (
    <div
      ref={ref}
      className="terminal-container agent-sleep-panel"
      data-agent-sleep="asleep"
      role="button"
      tabIndex={0}
      aria-label="Sleeping terminal. Click or type to wake it."
      onClick={(event) => {
        event.stopPropagation();
        onWake();
      }}
      onKeyDown={(event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        event.preventDefault();
        onWake();
      }}
    >
      <div className="agent-sleep-panel__body">
        <span className="agent-sleep-panel__badge">Sleeping</span>
        <span className="agent-sleep-panel__line">{sleptForText(record?.sleptAt)}{freedMb ? ` · freed ${freedMb} MB` : ""}</span>
        <span className="agent-sleep-panel__line">The conversation is kept. Click or type to wake it.</span>
      </div>
    </div>
  );
}

export function KeepAwakeToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`agent-keep-awake${on ? " agent-keep-awake--on" : ""}`}
      aria-pressed={on}
      title={on ? "Kept awake: this terminal never sleeps. Click to let it sleep when idle." : "Keep awake: never put this terminal to sleep when idle"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {on ? "Kept awake" : "Keep awake"}
    </button>
  );
}
