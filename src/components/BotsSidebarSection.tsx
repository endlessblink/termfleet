import { useEffect, useState } from "react";
import { Robot, Plus } from "@phosphor-icons/react";
import { useWorkspaceStore } from "../stores/workspace";
import { listBots, openBotInAgents, type BotListItem } from "../lib/botsDirectory";

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

  return (
    <section data-testid="sidebar-bots-section" style={{ display: "grid", gap: 2, marginTop: 7 }}>
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
