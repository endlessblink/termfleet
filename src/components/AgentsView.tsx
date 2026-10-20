import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { OPEN_BOT_EVENT, takePendingBot } from "../lib/botsDirectory";
// The agent list and chat, built into TermFleet. It is the same page the phone
// uses, so both always look and behave alike. It signs itself in (this machine
// only) and needs no address to type.
const AGENTS_URL = "http://127.0.0.1:7810/embed";

// After this long without the page, offer to open it again (it keeps loading meanwhile).
const SLOW_LOAD_MS = 45_000;

// TF-096: the side list's Bots section opens a bot's chat here.
function agentsUrl(bot: string | null) {
  return bot ? `${AGENTS_URL}#bot:${bot}` : AGENTS_URL;
}

export function AgentsView() {
  const [src, setSrc] = useState(() => agentsUrl(takePendingBot()));
  useEffect(() => {
    const onOpen = (event: Event) => {
      const id = (event as CustomEvent<string | null>).detail;
      takePendingBot();
      if (id) setSrc(agentsUrl(id));
    };
    window.addEventListener(OPEN_BOT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_BOT_EVENT, onOpen);
  }, []);
  // Ctrl+V is claimed at window level for whichever terminal last held the keyboard
  // (gtk_keys.rs). Leaving a terminal for this view never released it, so every paste
  // here went into that hidden terminal instead of the chat box ("cant paste anything",
  // text and pictures alike). Release the claim on arrival and whenever the chat page
  // takes the keyboard (the window blurs when the iframe gets focus).
  useEffect(() => {
    const release = () => {
      invoke("set_focused_terminal", { id: null }).catch(() => {});
    };
    release();
    window.addEventListener("blur", release);
    return () => window.removeEventListener("blur", release);
  }, []);
  // Right after a restart the page can take a minute or more to arrive, and the empty
  // frame painted plain white (Noam 2026-10-20, a blank Agents view). Keep the frame
  // hidden behind a short note until it has loaded. A slow load is never restarted on
  // its own; after a while a Try again button opens the page afresh.
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (loaded) return;
    setSlow(false);
    const timer = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => window.clearTimeout(timer);
  }, [loaded, attempt]);
  return (
    <section className="agents-view" aria-label="Agents" style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-raised)" }}>
      <h1 className="sr-only">Agents</h1>
      {!loaded && (
        <div role="status" style={{ position: "absolute", inset: 0, display: "grid", placeContent: "center", justifyItems: "center", gap: 12, color: "var(--text-muted, #a8a29e)", font: "400 14px var(--font-ui)" }}>
          {slow ? "The agents are taking long to open." : "Opening the agents…"}
          {slow && (
            <button type="button" onClick={() => setAttempt((n) => n + 1)} style={{ font: "500 13px var(--font-ui)", padding: "6px 14px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" }}>
              Try again
            </button>
          )}
        </div>
      )}
      <iframe
        key={attempt}
        title="Agents"
        src={src}
        onLoad={() => setLoaded(true)}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent", visibility: loaded ? "visible" : "hidden" }}
        allow="clipboard-read; clipboard-write; microphone"
      />
    </section>
  );
}
