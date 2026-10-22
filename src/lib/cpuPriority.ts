// Urgent toggle for one terminal (Noam 2026-10-22: 'אין דרך להגביל את מידת השימוש במעבד לכל
// הסוכנים האלו אלא אם זה משהו דחוף?'). Agent terminals run at a gentle CPU share; Urgent moves
// one terminal to full speed. The work is done by the shared priority helper via Tauri.
import { invoke } from "@tauri-apps/api/core";

export type PriorityReply = { ok: boolean; urgent: boolean; error: string | null };

/** The id a terminal's programs carry (TERMFLEET_PANE_ID = runtimeSessionId). */
export function priorityPaneId(tabId: string | undefined, paneId: string | undefined): string | null {
  return tabId && paneId ? `terminal-${tabId}-${paneId}` : null;
}

export function urgentMenuText({ urgent, loading }: { urgent: boolean; loading: boolean }) {
  if (loading) return { title: "Checking priority…", hint: "Reading this terminal's speed setting" };
  return urgent
    ? { title: "Urgent is on — turn off", hint: "Back to the gentle share; nothing stops" }
    : { title: "Make urgent", hint: "Full speed for this terminal; other agents stay gentle" };
}

export function parsePriorityReply(text: string): PriorityReply {
  try {
    const data = JSON.parse(text) as { ok?: boolean; urgent?: boolean; error?: string };
    const ok = data.ok !== false;
    return { ok, urgent: ok && data.urgent === true, error: ok ? null : data.error || "That did not work." };
  } catch {
    return { ok: false, urgent: false, error: "That did not work." };
  }
}

export async function terminalPriority(action: "status" | "on" | "off", paneId: string): Promise<PriorityReply> {
  try {
    return parsePriorityReply(await invoke<string>("terminal_priority", { action, paneId }));
  } catch (error) {
    return { ok: false, urgent: false, error: String(error || "That did not work.") };
  }
}

/** The three choices for how much CPU every agent terminal gets when the PC is busy. */
export const AGENT_SHARE_CHOICES = [
  { weight: 20, label: "Gentle" },
  { weight: 50, label: "Medium" },
  { weight: 100, label: "Normal" },
] as const;

export function shareChoiceFor(weight: number): number {
  return AGENT_SHARE_CHOICES.reduce((best, choice) =>
    Math.abs(choice.weight - weight) < Math.abs(best - weight) ? choice.weight : best, 20 as number);
}

export async function agentCpuShare(weight?: number): Promise<number | null> {
  try {
    const data = JSON.parse(await invoke<string>("agent_cpu_share", { weight: weight ?? null })) as { agentWeight?: number };
    return typeof data.agentWeight === "number" ? data.agentWeight : null;
  } catch {
    return null;
  }
}
