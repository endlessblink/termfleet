import { useEffect, useState } from "react";
import { Robot, Plus } from "@phosphor-icons/react";
import { useWorkspaceStore } from "../stores/workspace";
import { listBots, openBotInAgents, type BotListItem } from "../lib/botsDirectory";

// "Waiting for you" (Noam 2026-10-20: "this must be reachable on the computer too"): the
// agents service writes one list of everything waiting on him, from every bot and terminal.
interface WaitingItem { key: string; kind: "try" | "approve" | "answer"; source: "bot" | "terminal"; who: string; what: string; todo: string; go: string }
const WAITING_COLOUR: Record<WaitingItem["kind"], string> = { try: "#8cc79a", approve: "#d97757", answer: "#d97757" };
const WAITING_TAG: Record<WaitingItem["kind"], string> = { try: "Try", approve: "Approve", answer: "Answer" };

const hasTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

/**
 * TF-096: the side list's Bots section. Bots are the managers that run outside
 * the terminals; a tap opens that bot's chat in the Agents view. It replaces the
 * old "Bots & automation" folder group at the top (those folders now show as
 * "Bot projects").
 */
export function BotsSidebarSection() {
  const setWorkspaceMode = useWorkspaceStore((state) => state.setWorkspaceMode);
  const [bots, setBots] = useState<BotListItem[]>([]);
  const [waiting, setWaiting] = useState<WaitingItem[]>([]);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const setActivePane = useWorkspaceStore((state) => state.setActivePane);
  const workspaceMode = useWorkspaceStore((state) => state.workspaceUiState.workspaceMode);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let alive = true;
    const load = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        const raw = await invoke<string | null>("agent_status_read_sidecar", { fileName: "waiting-for-you.json" });
        const items = raw ? (JSON.parse(raw).items as WaitingItem[]) : [];
        if (alive) setWaiting(Array.isArray(items) ? items : []);
      } catch { /* the list comes back on the next look */ }
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) return;
    let alive = true;
    const load = async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const next = await listBots(invoke);
      if (alive) setBots(next);
    };
    load();
    const timer = window.setInterval(load, 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  const open = (id: string | null) => {
    openBotInAgents(id);
    setWorkspaceMode("agents");
  };

  // A tap goes there: a bot opens its chat; a terminal is brought to the front.
  const goTo = (item: WaitingItem) => {
    if (item.go.startsWith("#bot:")) return open(item.go.slice(5));
    const m = /^#terminal-([0-9a-f-]{36})-(.+)$/.exec(item.go);
    if (!m) return;
    if (workspaceMode === "agents") setWorkspaceMode("split");
    setActiveTab(m[1]);
    setActivePane(m[1], m[2]);
  };

  return (
    <section data-testid="sidebar-bots-section" style={{ display: "grid", gap: 2, marginTop: 7 }}>
      {waiting.length > 0 && (
        <div data-testid="sidebar-waiting" style={{ display: "grid", gap: 2, marginBottom: 8 }}>
          <div style={{ height: 28, display: "flex", alignItems: "center", gap: 6, padding: "0 6px", color: "var(--text-primary)", fontSize: 12, fontWeight: 500 }}>
            <span style={{ flex: 1 }}>Waiting for you</span>
            <span style={{ minWidth: 18, height: 18, padding: "0 6px", borderRadius: 9, background: "#d97757", color: "#141312", fontSize: 11, fontWeight: 500, display: "inline-grid", placeItems: "center" }}>{waiting.length}</span>
          </div>
          {waiting.map((item) => (
            <button
              key={item.key}
              type="button"
              data-testid="sidebar-waiting-row"
              title={`${item.who}: ${item.what}\n${item.kind === "try" ? "Try: " : ""}${item.todo}`}
              onClick={() => goTo(item)}
              style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", columnGap: 8, alignItems: "start", textAlign: "start", padding: "6px 8px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 12, cursor: "pointer" }}
            >
              <span style={{ marginTop: 1, padding: "1px 6px", borderRadius: 6, background: WAITING_COLOUR[item.kind], color: "#141312", fontSize: 10.5, fontWeight: 500 }}>{WAITING_TAG[item.kind]}</span>
              <span style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 1, lineHeight: 1.35 }}>
                <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.who}</span>
                <span dir="auto" style={{ color: "var(--text-tertiary)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.what}</span>
                <span dir="auto" style={{ color: "var(--text-secondary)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.kind === "try" ? `Try: ${item.todo}` : item.todo}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div style={{ height: 28, display: "flex", alignItems: "center", gap: 6, padding: "0 6px", color: "var(--text-secondary)", fontSize: 12, fontWeight: 500 }}>
        <Robot size={13} />
        <span style={{ flex: 1 }}>Bots</span>
        <span style={{ color: "var(--text-tertiary)", fontSize: 11, fontWeight: 400 }}>{bots.length}</span>
      </div>
      {bots.map((bot) => (
        <button
          key={bot.id}
          type="button"
          data-testid="sidebar-bot-row"
          title={bot.job || bot.name}
          onClick={() => open(bot.id)}
          style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr)", textAlign: "start", padding: "5px 8px 5px 26px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text-primary)", font: "inherit", fontSize: 13, cursor: "pointer" }}
        >
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bot.name}</span>
          {bot.job && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-tertiary)", fontSize: 11 }}>{bot.job}</span>}
        </button>
      ))}
      <button
        type="button"
        data-testid="sidebar-new-bot"
        onClick={() => open(null)}
        style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", border: "none", borderRadius: 6, background: "transparent", color: "var(--text-secondary)", font: "inherit", fontSize: 12, cursor: "pointer" }}
      >
        <Plus size={12} /> {bots.length ? "New bot" : "Make your first bot"}
      </button>
    </section>
  );
}
