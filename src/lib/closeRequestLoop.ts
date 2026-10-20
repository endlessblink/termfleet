// Picks up close requests and closes the card the same way its X does.
// See closeRequests.ts for who may ask and what is refused.
import { useWorkspaceStore } from "../stores/workspace";
import { planCloseRequest } from "./closeRequests";

const POLL_INTERVAL_MS = 1500;
let started = false;
let ticking = false;
let folder: string | null = null;

function hasTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tick() {
  if (ticking || useWorkspaceStore.getState().hydrating) return;
  ticking = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    folder ??= `${await invoke<string>("fs_home_dir")}/.local/share/terminal-workspace/close-requests`;
    let entries: { name: string; path: string; isDir: boolean }[] = [];
    try {
      entries = await invoke("fs_list_dir", { path: folder });
    } catch {
      return; // no folder yet: nobody has asked
    }
    for (const entry of entries) {
      if (entry.isDir || !entry.name.endsWith(".request.json")) continue;
      let raw = "";
      try {
        raw = await invoke<string>("fs_read_file", { path: entry.path });
      } finally {
        // Taken once: a request is never acted on twice, even if closing fails.
        await invoke("fs_delete", { path: entry.path }).catch(() => {});
      }
      const plan = planCloseRequest(raw, useWorkspaceStore.getState().tabs, Date.now());
      const requestId = plan.ok ? plan.request.requestId : plan.requestId;
      let result: Record<string, unknown>;
      if (!plan.ok) {
        result = { ok: false, reason: plan.reason };
      } else {
        console.info("[termfleet:close-request]", { paneId: plan.request.paneId, by: plan.request.by ?? null });
        try {
          await useWorkspaceStore.getState().closeTerminalSession(plan.tabId, "operator");
          result = { ok: true, title: plan.title, closedAt: Date.now() };
        } catch (error) {
          result = { ok: false, reason: "close-failed", detail: String(error).slice(0, 200) };
        }
      }
      if (requestId) {
        await invoke("fs_write_file", { path: `${folder}/${requestId}.result.json`, contents: JSON.stringify({ requestId, ...result }) }).catch(() => {});
      }
    }
  } catch (error) {
    console.warn("[termfleet:close-request] poll failed:", error);
  } finally {
    ticking = false;
  }
}

export function startCloseRequestLoop() {
  if (started || !hasTauri()) return;
  started = true;
  window.setInterval(() => void tick(), POLL_INTERVAL_MS);
}
