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
  if (!t || t.startsWith("<") || t.startsWith("[SYSTEM") || t.startsWith("Caveat:") || t.startsWith("[Request interrupted")) return "";
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
  const add = (at, raw) => {
    const t = typed(raw);
    // Codex's own review/guardian prompts and injected instruction files are not Noam's words.
    if (!t || t.startsWith("The following is") || t.startsWith("# AGENTS.md") || out.at(-1)?.text === t) return;
    out.push({ at, text: t });
  };
  for (const line of rolloutText.split("\n")) {
    if (!line.includes('"user_message"') && !line.includes('"role":"user"')) continue;
    try {
      const d = JSON.parse(line);
      const pl = d.payload;
      if (d.type === "event_msg" && pl?.type === "user_message") add(d.timestamp, pl.message);
      else if (d.type === "response_item" && pl?.type === "message" && pl.role === "user")
        add(d.timestamp, (pl.content ?? []).filter((b) => b?.type === "input_text").map((b) => b.text).join("\n"));
    } catch {
      /* partial line */
    }
  }
  return out;
}

/** Total size of the quoted words; the newest messages win, the opening request is always kept. */
const BUDGET_CHARS = 24_000;

/** The block to append: the opening request, then the newest messages that fit, verbatim (long ones cut, marked). */
export function renderUserWords(messages) {
  if (messages.length === 0) return "";
  const cut = (m) => (m.text.length > MAX_CHARS ? { ...m, text: `${m.text.slice(0, MAX_CHARS)} […cut]` } : m);
  const kept = [cut(messages[0])];
  let used = kept[0].text.length;
  const tail = [];
  for (let i = messages.length - 1; i >= 1; i -= 1) {
    const m = cut(messages[i]);
    if (used + m.text.length > BUDGET_CHARS) break;
    used += m.text.length;
    tail.unshift(m);
  }
  const skipped = messages.length - 1 - tail.length;
  const items = [...kept, ...tail].map((m, i) => `${i + 1}. ${m.at ?? ""}\n${m.text.split("\n").map((l) => `   > ${l}`).join("\n")}`);
  if (skipped > 0) items.splice(1, 0, `   (${skipped} older messages in between are not quoted; the original session record has them)`);
  return (
    `${WORDS_BEGIN}\n## Noam's messages, verbatim (added automatically by termfleet-child: his opening request, then the newest; the last one is the newest)\n` +
    `Treat these as instructions/corrections that may not appear above. Do not skip any. The NEWEST message is usually the task you must carry out FIRST, before any side investigation, unless the handoff above says it is already done.\n\n${items.join("\n\n")}\n${WORDS_END}\n`
  );
}

/** Add (or refresh) the block in the handoff file. Returns the number of messages written. */
export function appendUserWords(file, messages) {
  const block = renderUserWords(messages);
  if (!block) return 0;
  let text = readFileSync(file, "utf8");
  const start = text.indexOf(WORDS_BEGIN);
  const end = text.indexOf(WORDS_END);
  if (start >= 0 && end > start) text = text.slice(0, start) + text.slice(end + WORDS_END.length).replace(/^\n/, "");
  writeFileSync(file, `${text.replace(/\s*$/, "\n")}\n${block}`);
  return messages.length;
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
