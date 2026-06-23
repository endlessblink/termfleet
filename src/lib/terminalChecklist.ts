// Extract an agent's printed plan/checklist from terminal output (TC-035).
//
// Agents that don't report tasks through the Claude sidecar hook (codex/gpt-5.5, etc.) still
// print their plan as a checkbox list in the terminal, e.g.
//
//   • Updated Plan
//     └ ☐ Tune selected terminal default size
//       ☐ Keep manual resize persistent
//       ☑ Rerun map and canvas regressions
//
// The cockpit should surface that as the TASKS list instead of "NO LIST". This is a
// deterministic parser (no LLM): it finds the LAST contiguous block of checkbox lines and
// returns them with status, so the panel shows what the agent is actually planning.

export type TerminalChecklistStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TerminalChecklistItem {
  content: string;
  status: TerminalChecklistStatus;
}

// Checkbox glyphs → status. Markdown `[ ]`/`[x]` handled separately.
const DONE_MARKS = new Set(["☑", "☒", "◼", "▣", "✔", "✓", "✅", "[x]", "[X]"]);
const PENDING_MARKS = new Set(["☐", "▢", "◻", "◯", "○", "[ ]"]);
const CANCELLED_MARKS = new Set(["✗", "✘", "✕", "☓"]);
const IN_PROGRESS_MARKS = new Set(["▶", "▷", "→", "»"]);

// One checklist line: optional bullet / tree-drawing chars, then a marker, then text.
// Examples matched: "☐ Foo", "  └ ☑ Bar", "- [ ] Baz", "* [x] Qux", "▶ Doing".
const ITEM_RE =
  /^[\s>]*[-*•·]?\s*[└├│┗┣╰╠\s]*\s*(☐|☑|☒|◼|▣|▢|◻|◯|○|✔|✓|✅|✗|✘|✕|☓|▶|▷|→|»|\[[ xX]\])\s+(.+?)\s*$/u;

const MAX_ITEMS = 12;
const MAX_CONTENT = 120;

function statusFor(mark: string): TerminalChecklistStatus {
  if (DONE_MARKS.has(mark)) return "completed";
  if (CANCELLED_MARKS.has(mark)) return "cancelled";
  if (IN_PROGRESS_MARKS.has(mark)) return "in_progress";
  if (PENDING_MARKS.has(mark)) return "pending";
  // markdown
  if (/\[[xX]\]/.test(mark)) return "completed";
  return "pending";
}

function clean(text: string): string | undefined {
  const t = text.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  if (!t) return undefined;
  // Reject obvious prompt chrome / answer options that aren't real plan items.
  if (/@(?:filename|filepath|file|directory|folder|selection)\b/i.test(t)) return undefined;
  if (/^(?:yes|no|esc\b|press enter|continue|switch to)\b/i.test(t)) return undefined;
  return t.slice(0, MAX_CONTENT);
}

/**
 * Parse the most recent checklist block from terminal output. Returns [] when no checkbox
 * list is present. The block is the LAST run of consecutive checkbox lines (small gaps of
 * blank/continuation lines are tolerated) so a stale earlier plan never shadows the current
 * one. At least 2 items are required so a lone glyph in prose isn't mistaken for a plan.
 */
export function parseTerminalChecklist(output: string | undefined): TerminalChecklistItem[] {
  if (!output) return [];
  const lines = output.replace(/\r/g, "\n").split("\n");

  let best: TerminalChecklistItem[] = [];
  let current: TerminalChecklistItem[] = [];
  let currentLines = 0; // checkbox lines seen in this block (incl. chrome-rejected ones)
  let gap = 0;

  const flush = () => {
    // A real plan has >= 2 checkbox LINES (so a lone glyph in prose isn't a "plan"), even if
    // one of those lines is rejected as chrome and contributes no item.
    if (currentLines >= 2 && current.length > 0) best = current;
    current = [];
    currentLines = 0;
    gap = 0;
  };

  for (const raw of lines) {
    const match = raw.match(ITEM_RE);
    if (match) {
      currentLines += 1;
      gap = 0;
      const content = clean(match[2]);
      if (content) current.push({ content, status: statusFor(match[1]) });
      continue;
    }
    if (currentLines > 0) {
      // Tolerate a single blank/continuation line inside a block; break on a real gap.
      if (raw.trim() === "" && gap === 0) {
        gap += 1;
        continue;
      }
      flush();
    }
  }
  flush();

  // De-dup by content (keep last status), cap length.
  const seen = new Map<string, TerminalChecklistStatus>();
  for (const item of best) seen.set(item.content, item.status);
  return [...seen.entries()].slice(0, MAX_ITEMS).map(([content, status]) => ({ content, status }));
}
