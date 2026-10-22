import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { AGENT_SHARE_CHOICES, agentCpuShare, shareChoiceFor, terminalPriority, urgentMenuText } from "../lib/cpuPriority";

/** "Make urgent" row for a terminal's right-click menu on the map. */
export function UrgentMenuItem({ paneId, onDone }: { paneId: string | null; onDone: () => void }) {
  const [urgent, setUrgent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<number | null>(null);

  useEffect(() => {
    void agentCpuShare().then(setShare);
  }, []);

  useEffect(() => {
    if (!paneId) return;
    let live = true;
    setLoading(true);
    void terminalPriority("status", paneId).then((reply) => {
      if (!live) return;
      setUrgent(reply.urgent);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [paneId]);

  if (!paneId) return null;
  const text = urgentMenuText({ urgent, loading });
  return (
    <>
      <button
        type="button"
        role="menuitem"
        className="workspace-launch-config-item"
        data-testid="canvas-terminal-urgent"
        aria-pressed={urgent}
        disabled={loading}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "9px",
          border: "none",
          borderRadius: "var(--radius-md)",
          background: urgent ? "color-mix(in srgb, var(--accent-warning) 16%, transparent)" : "transparent",
          color: "var(--text-primary)",
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          cursor: loading ? "default" : "pointer",
          textAlign: "left",
        }}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          setLoading(true);
          void terminalPriority(urgent ? "off" : "on", paneId).then((reply) => {
            setLoading(false);
            if (!reply.ok) {
              setError(reply.error);
              return;
            }
            setUrgent(reply.urgent);
            onDone();
          });
        }}
      >
        <Zap size={15} strokeWidth={1.8} color={urgent ? "var(--accent-warning)" : undefined} />
        <span style={{ display: "grid", gap: 2 }}>
          <span>{text.title}</span>
          <span style={{ color: error ? "var(--accent-danger)" : "var(--text-tertiary)", fontSize: 11 }}>
            {error ?? text.hint}
          </span>
        </span>
      </button>
      <div
        data-testid="canvas-agent-share"
        style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 9px 6px", fontFamily: "var(--font-ui)", fontSize: 11 }}
      >
        <span style={{ color: "var(--text-tertiary)", marginRight: 4 }} title="How much CPU every agent terminal gets when your own apps are busy">
          Agents when busy
        </span>
        {AGENT_SHARE_CHOICES.map((choice) => {
          const chosen = share !== null && shareChoiceFor(share) === choice.weight;
          return (
            <button
              key={choice.weight}
              type="button"
              aria-pressed={chosen}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                padding: "2px 7px",
                background: chosen ? "color-mix(in srgb, var(--accent-info) 18%, transparent)" : "transparent",
                color: chosen ? "var(--text-primary)" : "var(--text-secondary)",
                fontFamily: "var(--font-ui)",
                fontSize: 11,
                cursor: "pointer",
              }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                void agentCpuShare(choice.weight).then((next) => next !== null && setShare(next));
              }}
            >
              {choice.label}
            </button>
          );
        })}
      </div>
      <div style={{ borderTop: "1px solid var(--border-subtle)", margin: "4px 4px 2px" }} />
    </>
  );
}
