// A handover must never throw away what the operator was typing. The unsent text sits
// in the agent's input box on screen (a Claude Code box is a ruled frame holding a
// "❯ ..." line); we read it from the screen just before the old card is retired and
// type it, unsent, into the new agent's box once that box is up.

const RULE = /^[\s]*[─━-]{8,}[\s]*$/;
const PROMPT = /^\s*[❯>]\s?(.*)$/;
/** The grey hint Claude shows in an EMPTY box; it is not something the operator typed. */
const PLACEHOLDER = /^Try\s+["“']/i;

/** The unsent text in the agent's input box on this screen, or "" when there is none. */
export function extractInputDraft(screenText: string): string {
  const lines = screenText.split("\n").map((line) => line.replace(/\s+$/, ""));
  let bottomRule = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (RULE.test(lines[i])) {
      bottomRule = i;
      break;
    }
  }
  if (bottomRule < 1) return "";
  let topRule = -1;
  for (let i = bottomRule - 1; i >= 0; i -= 1) {
    if (RULE.test(lines[i])) {
      topRule = i;
      break;
    }
  }
  if (topRule < 0) return "";
  const box = lines.slice(topRule + 1, bottomRule);
  const first = box.findIndex((line) => PROMPT.test(line));
  if (first < 0) return "";
  const parts = [PROMPT.exec(box[first])?.[1] ?? "", ...box.slice(first + 1).map((line) => line.trim())];
  const text = parts.filter((part) => part.length > 0).join(" ").trim();
  return PLACEHOLDER.test(text) ? "" : text;
}

/** Bracketed paste: the text lands in the box as typed text and is NOT submitted. */
export function pasteWithoutSubmitting(text: string) {
  return `\u001b[200~${text}\u001b[201~`;
}

/** Is the new agent's input box on screen yet? */
export function inputBoxIsUp(screenText: string) {
  const lines = screenText.split("\n");
  let rule = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (RULE.test(lines[i])) {
      rule = i;
      break;
    }
  }
  return rule >= 0 && lines.slice(Math.max(0, rule - 6), rule).some((line) => PROMPT.test(line));
}
