// The agent list and chat, built into TermFleet. It is the same page the phone
// uses, so both always look and behave alike. It signs itself in (this machine
// only) and needs no address to type.
const AGENTS_URL = "http://127.0.0.1:7810/embed";

export function AgentsView() {
  return (
    <section className="agents-view" aria-label="Agents" style={{ width: "100%", height: "100%", background: "var(--surface-raised)" }}>
      <h1 className="sr-only">Agents</h1>
      <iframe
        title="Agents"
        src={AGENTS_URL}
        style={{ width: "100%", height: "100%", border: 0, display: "block", background: "transparent" }}
        allow="clipboard-read; clipboard-write"
      />
    </section>
  );
}
