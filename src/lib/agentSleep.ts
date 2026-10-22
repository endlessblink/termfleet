// Sleep for idle agent terminals (Noam 2026-10-22: 'שהם לא יגנבו הרבה זיכרון במצב idle').
// The Agents service puts an idle agent to sleep: it writes sleeping/<pane id>.json, then the
// terminal's programs end. While that mark exists the card shows Sleeping instead of the
// terminal and does NOT reattach (reattaching is what wakes it: the terminal service resumes
// the same conversation). Waking from the PC = removing the mark, which mounts the terminal.
// See termcontrol/bridge/sleep.mjs for the rules that decide when a terminal may sleep.
import { invoke } from "@tauri-apps/api/core";

export type SleepRecord = {
  paneId: string;
  provider?: string | null;
  sessionId?: string | null;
  cwd?: string | null;
  title?: string | null;
  sleptAt?: number | null;
  freedBytes?: number | null;
};

let rootPromise: Promise<string> | null = null;
function dataRoot(): Promise<string> {
  rootPromise ??= invoke<string>("fs_home_dir").then(
    (home) => `${home.replace(/\/$/, "")}/.local/share/terminal-workspace`,
  );
  return rootPromise;
}

const safe = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_");

export function parseSleepRecord(raw: string): SleepRecord | null {
  try {
    const value = JSON.parse(raw);
    return value && typeof value.paneId === "string" ? (value as SleepRecord) : null;
  } catch {
    return null;
  }
}

/** The sleep mark for this terminal, or null when it is awake (or files cannot be read). */
export async function readSleepRecord(id: string): Promise<SleepRecord | null> {
  try {
    const raw = await invoke<string>("fs_read_file", { path: `${await dataRoot()}/sleeping/${safe(id)}.json` });
    return parseSleepRecord(raw);
  } catch {
    return null;
  }
}

export async function clearSleepRecord(id: string): Promise<void> {
  try {
    await invoke("fs_delete", { path: `${await dataRoot()}/sleeping/${safe(id)}.json` });
  } catch {
    // Already gone: someone else woke it.
  }
}

async function ensureDir(path: string) {
  try {
    await invoke("fs_create", { path, isDir: true });
  } catch {
    // Exists already.
  }
}

/** Tell the Agents service this terminal is in front of Noam right now, so it never sleeps. */
export async function touchViewing(id: string): Promise<void> {
  try {
    const dir = `${await dataRoot()}/agent-sleep/viewing`;
    await ensureDir(`${await dataRoot()}/agent-sleep`);
    await ensureDir(dir);
    await invoke("fs_write_file", { path: `${dir}/${safe(id)}`, contents: String(Date.now()) });
  } catch {
    // Best effort; the idle time alone still protects a terminal in use.
  }
}

export async function readKeepAwake(id: string): Promise<boolean> {
  try {
    await invoke<string>("fs_read_file", { path: `${await dataRoot()}/agent-sleep/keep-awake/${safe(id)}` });
    return true;
  } catch {
    return false;
  }
}

export async function writeKeepAwake(id: string, on: boolean): Promise<boolean> {
  const dir = `${await dataRoot()}/agent-sleep/keep-awake`;
  try {
    if (on) {
      await ensureDir(`${await dataRoot()}/agent-sleep`);
      await ensureDir(dir);
      await invoke("fs_write_file", { path: `${dir}/${safe(id)}`, contents: "" });
    } else {
      await invoke("fs_delete", { path: `${dir}/${safe(id)}` });
    }
  } catch {
    // Reported by reading it back.
  }
  return readKeepAwake(id);
}

export function sleptForText(sleptAt: number | null | undefined, now = Date.now()): string {
  if (!sleptAt) return "Sleeping";
  const minutes = Math.max(0, Math.floor((now - sleptAt) / 60_000));
  if (minutes < 1) return "Sleeping since just now";
  if (minutes < 60) return `Sleeping for ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `Sleeping for ${hours} h` : `Sleeping for ${Math.floor(hours / 24)} days`;
}
