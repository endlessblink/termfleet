import { useEffect, useState } from "react";
import { OPEN_BOT_EVENT, takePendingBot } from "../lib/botsDirectory";
// The agent list and chat, built into TermFleet. It is the same page the phone
// uses, so both always look and behave alike. It signs itself in (this machine
// only) and needs no address to type.
const AGENTS_URL = "http://127.0.0.1:7810/embed";

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
  return (
    <section className="agents-view" aria-label="Agents" style={{ width: "100%", height: "100%", background: "var(--surface-raised)" }}>
      <h1 className="sr-only">Agents</h1>
      <iframe
        title="Agents"
        src={src}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent" }}
        allow="clipboard-read; clipboard-write; microphone"
      />
    </section>
  );
}
