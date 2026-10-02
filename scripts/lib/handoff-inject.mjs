// TF-076: a successor that is merely TOLD to read a handoff can skim it, summarize it in one
// line, or start on a side issue. A UserPromptSubmit hook sees its first prompt ("Read <file>.
// It is a handoff from the previous instance...") and injects the file's whole text as context,
// so the handoff is in front of the agent whether or not it obeys.
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

const MAX_BYTES = 150_000;
const HANDOFF_PROMPT = /^\s*Read (\/\S+\.md)\. It is a handoff from the previous instance/;

/** The context to inject for this prompt, or null when it is not a handover prompt. */
export function handoffInjection(prompt) {
  const match = HANDOFF_PROMPT.exec(String(prompt ?? ""));
  if (!match || !isAbsolute(match[1])) return null;
  const file = match[1];
  try {
    if (!existsSync(file) || !statSync(file).isFile()) return null;
    let text = readFileSync(file, "utf8");
    const cut = text.length > MAX_BYTES;
    if (cut) text = `${text.slice(0, MAX_BYTES / 2)}\n[…middle cut by the hook; read ${file} for it…]\n${text.slice(-MAX_BYTES / 2)}`;
    return (
      `HANDOVER INJECTED BY TERMFLEET (full text of ${file}, so nothing is skipped).\n` +
      `Your reply must: (1) quote Noam's newest messages from the end of the handoff, (2) quote the first next step in full, ` +
      `(3) name the ONE thing you will do first. Then do that before any side investigation; a failing test or odd finding on the way is a sub-step of it, not a replacement.\n` +
      `----- BEGIN HANDOFF -----\n${text}\n----- END HANDOFF -----`
    );
  } catch {
    return null;
  }
}
