import { invoke } from "@tauri-apps/api/core";
import { lastAssistantReply, paneChatFromSidecars } from "./lastReply";

export type CopyLastReplyOutcome = "copied" | "no-chat" | "no-reply" | "failed";

/** Copy the pane's newest agent reply (whole, from its saved chat) to the clipboard. */
export async function copyPaneLastReply(paneId: string): Promise<CopyLastReplyOutcome> {
  try {
    const sidecars = await invoke<string[]>("agent_status_list_sidecars");
    const chat = paneChatFromSidecars(paneId, sidecars);
    if (!chat) return "no-chat";
    const providers = chat.provider ? [chat.provider] : ["claude", "codex"];
    for (const provider of providers) {
      const record = await invoke<string | null>("session_transcript_reply_read", {
        provider,
        sessionId: chat.sessionId,
      });
      const reply = record ? lastAssistantReply(provider, record) : undefined;
      if (!reply) continue;
      await invoke("clipboard_write_text", { text: reply, corrId: `last-reply-${Date.now()}` });
      return "copied";
    }
    return "no-reply";
  } catch (error) {
    console.error("copy last reply failed", error);
    return "failed";
  }
}
