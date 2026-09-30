// "Copy last reply": the agent's newest complete message, read from its own saved
// session record, so a reply taller than the pane (or scrolled away inside a
// fullscreen TUI) can still be copied whole.

function textOf(content: unknown, blockType: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: string }).type === blockType)
    .map((block) => String((block as { text?: unknown }).text ?? ""))
    .join("\n");
}

/** Last assistant text in a Claude session record (JSONL). */
function lastClaudeReply(text: string): string | undefined {
  let last: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: { content?: unknown } };
      if (entry.type !== "assistant") continue;
      const reply = textOf(entry.message?.content, "text").trim();
      if (reply) last = reply;
    } catch {
      // A tail read starts mid-line; skip the partial first record.
    }
  }
  return last;
}

/** Last assistant message in a Codex rollout (JSONL). */
function lastCodexReply(text: string): string | undefined {
  let last: string | undefined;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        payload?: { type?: string; role?: string; content?: unknown; message?: unknown };
      };
      const payload = entry.payload;
      if (!payload) continue;
      let reply = "";
      if (entry.type === "response_item" && payload.type === "message" && payload.role === "assistant") {
        reply = textOf(payload.content, "output_text");
      } else if (entry.type === "event_msg" && payload.type === "agent_message") {
        reply = typeof payload.message === "string" ? payload.message : "";
      }
      if (reply.trim()) last = reply.trim();
    } catch {
      // Partial first line of a tail read.
    }
  }
  return last;
}

export function lastAssistantReply(provider: string | undefined, record: string): string | undefined {
  if (provider === "codex") return lastCodexReply(record);
  if (provider === "claude") return lastClaudeReply(record);
  return lastClaudeReply(record) ?? lastCodexReply(record);
}

/** The newest status sidecar for this pane, among the raw pane-*.json contents. */
export function paneChatFromSidecars(
  paneId: string,
  sidecars: readonly string[],
): { provider?: string; sessionId: string } | undefined {
  let best: { provider?: string; sessionId: string; updatedAt: number } | undefined;
  for (const raw of sidecars) {
    try {
      const record = JSON.parse(raw) as {
        paneId?: string;
        provider?: string;
        sessionId?: string;
        updatedAt?: number;
      };
      if (record.paneId !== paneId || !record.sessionId) continue;
      const updatedAt = Number(record.updatedAt) || 0;
      if (!best || updatedAt > best.updatedAt) {
        best = { provider: record.provider, sessionId: record.sessionId, updatedAt };
      }
    } catch {
      // Skip a sidecar caught mid-write.
    }
  }
  return best ? { provider: best.provider, sessionId: best.sessionId } : undefined;
}
