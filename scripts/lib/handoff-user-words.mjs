// TF-076: a handoff is written by the dying agent, which forgets or paraphrases what
// Noam typed near the handover. The spawn command therefore appends his last messages,
// copied verbatim from the vendor's own session record, so they always reach the successor.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const WORDS_BEGIN = "<!-- termfleet:user-words:begin -->";
export const WORDS_END = "<!-- termfleet:user-words:end -->";
const MAX_CHARS = 2_000;

/** Typed-by-a-human text only: harness-injected blocks start with "<" or "[SYSTEM". */
function typed(text) {
  const t = String(text ?? "").trim();
  if (!t || t.startsWith("<") || t.startsWith("[SYSTEM") || t.startsWith("Caveat:")) return "";
  return t;
}

export function claudeUserMessages(transcriptText) {
  const out = [];
  for (const line of transcriptText.split("\n")) {
    // Messages typed while the agent is busy are stored as attachments, not as user turns.
    if (!line.includes('"user"') && !line.includes('"queued_command"')) continue;
    try {
      const d = JSON.parse(line);
      const queued = d.attachment;
      if (queued?.type === "queued_command" && queued.origin?.kind === "human") {
        const t = typed(queued.prompt);
        if (t) out.push({ at: queued.timestamp ?? d.timestamp, text: t });
        continue;
      }
      if (d.type !== "user" || d.isMeta || d.isSidechain) continue;
      const c = d.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text").map((b) => b.text).join("\n") : "";
      const t = typed(text);
      if (t) out.push({ at: d.timestamp, text: t });
    } catch {
      /* partial line */
    }
  }
  return out;
}

export function codexUserMessages(rolloutText) {
  const out = [];
  for (const line of rolloutText.split("\n")) {
    if (!line.includes('"user_message"')) continue;
    try {
      const d = JSON.parse(line);
      if (d.payload?.type !== "user_message") continue;
      const t = typed(d.payload.message);
      if (t) out.push({ at: d.timestamp, text: t });
    } catch {
      /* partial line */
    }
  }
  return out;
}

/** The block to append: the last `limit` messages, verbatim (long ones cut, marked). */
export function renderUserWords(messages, limit = 12) {
  const last = messages.slice(-limit);
  if (last.length === 0) return "";
  const items = last.map((m, i) => {
    const body = m.text.length > MAX_CHARS ? `${m.text.slice(0, MAX_CHARS)} […cut]` : m.text;
    return `${i + 1}. ${m.at ?? ""}\n${body.split("\n").map((l) => `   > ${l}`).join("\n")}`;
  });
  return (
    `${WORDS_BEGIN}\n## Noam's last messages, verbatim (added automatically by termfleet-child; the last one is the newest)\n` +
    `Treat these as instructions/corrections that may not appear above. Do not skip any.\n\n${items.join("\n\n")}\n${WORDS_END}\n`
  );
}

/** Add (or refresh) the block in the handoff file. Returns the number of messages written. */
export function appendUserWords(file, messages, limit = 12) {
  const block = renderUserWords(messages, limit);
  if (!block) return 0;
  let text = readFileSync(file, "utf8");
  const start = text.indexOf(WORDS_BEGIN);
  const end = text.indexOf(WORDS_END);
  if (start >= 0 && end > start) text = text.slice(0, start) + text.slice(end + WORDS_END.length).replace(/^\n/, "");
  writeFileSync(file, `${text.replace(/\s*$/, "\n")}\n${block}`);
  return Math.min(limit, messages.length);
}

/** Locate the caller's own session record, or undefined. */
export function findTranscript({ provider, sessionId, home = homedir() }) {
  if (!sessionId || !/^[0-9a-f-]{8,}$/i.test(sessionId)) return undefined;
  try {
    if (provider === "claude") {
      const root = join(home, ".claude", "projects");
      for (const dir of readdirSync(root)) {
        const f = join(root, dir, `${sessionId}.jsonl`);
        if (existsSync(f)) return f;
      }
    } else if (provider === "codex") {
      const root = join(home, ".codex", "sessions");
      for (const y of readdirSync(root))
        for (const m of readdirSync(join(root, y)))
          for (const d of readdirSync(join(root, y, m))) {
            const hit = readdirSync(join(root, y, m, d)).find((n) => n.startsWith("rollout-") && n.endsWith(`-${sessionId}.jsonl`));
            if (hit) return join(root, y, m, d, hit);
          }
    }
  } catch {
    /* no record */
  }
  return undefined;
}

export function userMessagesFor({ provider, sessionId, home }) {
  const file = findTranscript({ provider, sessionId, home });
  if (!file) return [];
  const text = readFileSync(file, "utf8");
  return provider === "codex" ? codexUserMessages(text) : claudeUserMessages(text);
}
