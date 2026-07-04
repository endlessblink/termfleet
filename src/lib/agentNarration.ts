// Agent narration extraction: turn the agent's OWN last narration bullet from the
// visible terminal grid ("● I'm using the sure confidence gate now…" Claude /
// "• I'm installing the updated scripts…" Codex) into the header's current-step
// text. This is the best material a pane without a real task list has — the
// agent's literal statement of what it is doing — and it was previously discarded
// as noise. Pure text processing; no model calls.
//
// The condenser section below is a browser-safe PORT of
// `scripts/termfleet-claude-status-hook.mjs` (narrationToNow + its regexes). The
// hook module imports node:fs at top level so it cannot be imported here; parity
// is pinned by tests/agent-narration.spec.ts (same pattern as agentStatusSidecar).
import { qualityCheckNowLabel } from "./terminalHeaderQuality";

function cleanField(value: unknown, max = 200): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// ---- condenser (ported; keep byte-identical in logic to the hook) ----

const LEAD_IN =
  /^(?:ok(?:ay)?|now|next|so|alright|first|then|finally|let me|let's|i'?ll|i am going to|i'?m going to|i'?m going|i will|i need to|i'?m|i have|i've)\b[\s,]*/i;

const STATUS_CONCLUSION =
  /^(?:all\s+(?:\d+\s+)?(?:tests?\s+)?pass(?:ed|es)?|done|fixed|fix(?:ed)?\s*[.!]|committed|pushed|\d+\s+passed|\d+\/\d+\s+pass|tests?\s+pass(?:ed|es)?|that'?s\s+it|perfect|great|success(?:ful)?|complete[d]?|finished|ready|ok(?:ay)?)\b[\s.!,:-]*$/i;

const REPORT_LINE =
  /^(?:committed|pushed|merged|reverted|stashed|tagged|deployed|published|released)\b/i;

const WORK_VERB =
  /\b(?:add|adding|fix|fixing|wir(?:e|ing)|implement(?:ing)?|show(?:ing)?|mak(?:e|ing)|updat(?:e|ing)|build(?:ing)?|refactor(?:ing)?|writ(?:e|ing)|read(?:ing)?|captur(?:e|ing)|render(?:ing)?|creat(?:e|ing)|remov(?:e|ing)|chang(?:e|ing)|improv(?:e|ing)|investigat(?:e|ing)|debug(?:ging)?|prefer(?:ring)?|promot(?:e|ing)|design(?:ing)?|migrat(?:e|ing)|test(?:ing)?|verif(?:y|ying)|repair(?:ing)?|hook(?:ing)?\s+up|set\s*up|wir(?:e|ing)\s+up)\b/i;

function stripLeadIns(sentence: string) {
  let clean = sentence;
  for (let i = 0; i < 4 && LEAD_IN.test(clean); i += 1) {
    clean = clean.replace(LEAD_IN, "").trim();
  }
  if (clean) clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  return clean;
}

/** Condense agent narration into one short plain-language "now" line (hook parity). */
export function narrationToNow(text: unknown): string {
  const clean = String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[*_#>]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const sentences = (clean.match(/[^.!?]+[.!?]?/g) ?? [clean])
    .map((sentence) => sentence.trim())
    .filter(
      (sentence) =>
        sentence &&
        !STATUS_CONCLUSION.test(sentence) &&
        !REPORT_LINE.test(sentence),
    );
  if (sentences.length === 0) return "";
  const substantive = (sentence: string) =>
    sentence.replace(/[^\p{L}\p{N}]+/gu, "").length >= 18;
  const intents = sentences.filter(
    (sentence) => LEAD_IN.test(sentence) && substantive(sentence),
  );
  const chosen =
    intents[0] ??
    sentences.find(
      (sentence) => WORK_VERB.test(sentence) && substantive(sentence),
    ) ??
    sentences.find(substantive);
  if (!chosen) return "";
  return cleanField(stripLeadIns(chosen), 90);
}

// ---- visible-grid extraction (new) ----

/**
 * The pane is actively working RIGHT NOW: a live run marker ("Working (12s …",
 * "esc to interrupt") or an animated spinner line ("✻ Embellishing… (2m)").
 * Single definition shared by the header callers so the signal can't drift.
 */
export function visibleTextShowsActiveWork(text?: string | null): boolean {
  const value = String(text ?? "");
  if (!value) return false;
  return (
    /\bWorking\s*\(|esc to interrupt\b/i.test(value) ||
    /^[✶✻✢✽·*]\s*\p{L}+(?:…|\.\.\.)/mu.test(value)
  );
}

const TOOL_CHROME_CONTENT =
  /^(?:[A-Z][\w-]*\s*\()|^(?:Bash|Read(?:ing)?|Write|Edit(?:ed)?|Update[d]?|Create[d]?|MultiEdit|Grep|Glob|Search(?:ed)?|Explored?|Ran|List(?:ed)?|Fetch(?:ed)?|Task(?:Create|Update|List|Get)?|Skill|TodoWrite|Web(?:Fetch|Search)|LSP)\b\s*[(:…]/;

const CONTINUATION_STOP =
  /^(?:[⎿└├╰╭│┌┐┘─━]|[●•]\s|[✶✻✢✽·*]\s*\p{L}+(?:…|\.\.\.)|\s*[›❯»]|⏵|\[|.*\besc to interrupt\b|.*\bWorking\s*\(|.*\bcontext left\b|.*\btokens\b)/u;

function isProse(content: string): boolean {
  if (TOOL_CHROME_CONTENT.test(content)) return false;
  const words = content.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (content.replace(/[^\p{L}\p{N}]+/gu, "").length < 18) return false;
  if (!/[a-z]/.test(content)) return false;
  if (/\($/.test(content.trim())) return false;
  return true;
}

/**
 * Find the agent's LAST narration bullet in the visible grid text, joined with its
 * wrapped continuation lines. Returns undefined when the newest bullet is stale —
 * i.e. a submitted prompt line appears BELOW it (that bullet belongs to a finished
 * turn, and a finished step must not masquerade as the current one).
 */
export function extractLastNarrationBullet(visibleText?: string | null): string | undefined {
  const lines = String(visibleText ?? "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    // A submitted prompt below any bullet we might find → everything above is a
    // previous turn. (An empty composer "› " has no content and doesn't count.)
    if (/^[›❯]\s+\S/.test(line)) return undefined;
    const match = line.match(/^[●•]\s+(.+)$/);
    if (!match) continue;
    let content = match[1].trim();
    // Join wrapped continuation lines (the terminal wraps narration mid-sentence).
    for (let next = index + 1; next < lines.length && next <= index + 3; next += 1) {
      const continuation = lines[next].trim();
      if (!continuation || CONTINUATION_STOP.test(continuation)) break;
      content = `${content} ${continuation}`;
      if (content.length > 400) break;
    }
    if (!isProse(content)) continue;
    return content.slice(0, 400);
  }
  return undefined;
}

/**
 * The agent's current step, ready for the header: only while the pane is actively
 * working, only from a positionally-current narration bullet, condensed to one
 * plain line, and only if it passes the now-line quality gate. Anything else →
 * undefined, and the header keeps its existing (neutral) behavior.
 */
export function currentNarrationStep(visibleText?: string | null): string | undefined {
  if (!visibleTextShowsActiveWork(visibleText)) return undefined;
  const bullet = extractLastNarrationBullet(visibleText);
  if (!bullet) return undefined;
  let condensed = narrationToNow(bullet).replace(/[.!?]+$/, "").trim();
  if (!condensed) return undefined;
  // The condenser caps at 90 chars but the now-line gate rejects >80: trim a long
  // sentence to its FIRST clause ("Installing the updated scripts …, then I'll
  // verify …" → keep the installing clause), else cut at a word boundary.
  if (condensed.length > 80) {
    const clause = condensed.split(/,\s+(?:then|and|so|but|while)\b/i)[0].trim();
    condensed =
      clause.length >= 24 && clause.length <= 80
        ? clause
        : `${condensed.slice(0, 77).replace(/\s+\S*$/, "").trim()}…`;
  }
  if (!qualityCheckNowLabel(condensed).ok) return undefined;
  return condensed;
}
