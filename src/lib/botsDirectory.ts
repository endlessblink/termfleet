// TF-096 bots: managers that run outside the terminals (the agents app's bridge
// keeps them). The desktop side list reads the same files so it shows the same
// bots, and opens one in the Agents view.

export interface BotListItem {
  id: string;
  name: string;
  job: string;
}

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface DirEntry { name: string; path: string; is_dir?: boolean; isDir?: boolean }

export async function listBots(invoke: Invoke): Promise<BotListItem[]> {
  let home = "";
  try { home = await invoke<string>("fs_home_dir"); } catch { return []; }
  const root = `${home.replace(/\/+$/, "")}/.config/termcontrol/bots`;
  let entries: DirEntry[] = [];
  try { entries = await invoke<DirEntry[]>("fs_list_dir", { path: root }); } catch { return []; }
  const bots: BotListItem[] = [];
  for (const entry of entries) {
    if (!/^[0-9a-f]{12}$/.test(entry.name)) continue;
    try {
      const raw = await invoke<string>("fs_read_file", { path: `${root}/${entry.name}/bot.json` });
      const bot = JSON.parse(raw) as Partial<BotListItem>;
      if (typeof bot.name === "string" && bot.name.trim()) bots.push({ id: entry.name, name: bot.name, job: typeof bot.job === "string" ? bot.job : "" });
    } catch { /* a half-written bot is skipped until it is complete */ }
  }
  return bots.sort((a, b) => a.name.localeCompare(b.name));
}

// The Agents view opens this bot next time it shows (or now, if it is open).
let pendingBot: string | null = null;
export const OPEN_BOT_EVENT = "termfleet:open-bot";

export function openBotInAgents(id: string | null) {
  pendingBot = id;
  window.dispatchEvent(new CustomEvent(OPEN_BOT_EVENT, { detail: id }));
}

export function takePendingBot(): string | null {
  const id = pendingBot;
  pendingBot = null;
  return id;
}

// The map's "Clean up idle terminals" opens the cleanup list in the Agents view
// (Noam 2026-10-22). A fresh token each time so a second click opens it again.
export const OPEN_CLEANUP_EVENT = "termfleet:open-cleanup";
let pendingCleanup: string | null = null;
export function openCleanupInAgents() {
  pendingCleanup = `cleanup-${Date.now()}`;
  window.dispatchEvent(new CustomEvent(OPEN_CLEANUP_EVENT, { detail: pendingCleanup }));
}
export function takePendingCleanup(): string | null {
  const token = pendingCleanup;
  pendingCleanup = null;
  return token;
}
