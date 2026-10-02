import { useEffect, useRef, useState } from "react";
import { paneBadgeAttention } from "../lib/sessionStatus";
import { useWorkspaceStore } from "../stores/workspace";

// Polite live region for screen readers: announces when a session starts
// "Waiting for you" (design step 3.2). Visually hidden; it never moves focus.
export function AttentionLiveRegion() {
  const tabs = useWorkspaceStore((state) => state.tabs);
  const [message, setMessage] = useState("");
  const waitingRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const waiting = new Map<string, string>();
    for (const tab of tabs) {
      for (const terminal of tab.terminals) {
        if (paneBadgeAttention(terminal, terminal.statusSummary?.status) === "waiting") {
          waiting.set(`${tab.id}:${terminal.paneId}`, tab.title);
        }
      }
    }
    const previous = waitingRef.current;
    waitingRef.current = new Set(waiting.keys());
    if (previous === null) return; // first pass: do not announce what was already waiting
    const fresh = [...waiting].filter(([id]) => !previous.has(id)).map(([, title]) => title);
    if (fresh.length > 0) setMessage(`${fresh.join(", ")} ${fresh.length === 1 ? "is" : "are"} waiting for you`);
  }, [tabs]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="attention-live-region">
      {message}
    </div>
  );
}
