import { invoke } from "@tauri-apps/api/core";

export async function openCodexModelPicker(
  runtimeSessionId: string,
  fallbackPtyId?: string,
) {
  try {
    await invoke("daemon_write_session", {
      id: runtimeSessionId,
      data: "/model\r",
    });
  } catch (daemonError) {
    if (!fallbackPtyId) throw daemonError;
    await invoke("pty_write", { id: fallbackPtyId, data: "/model\r" });
  }
}
