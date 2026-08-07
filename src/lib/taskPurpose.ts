const PURPOSE_VERB =
  /^(?:Adding|Allowing|Building|Changing|Cleaning|Creating|Enabling|Fixing|Improving|Making|Moving|Preventing|Redesigning|Removing|Repairing|Replacing|Restoring|Supporting|Updating|Upgrading)\b/i;
const DISCOVERY_VERB =
  /^(?:Checking|Finding|Inspecting|Mapping|Reading|Reproducing|Researching|Reviewing|Tracing)\b/i;
const VERIFICATION_VERB =
  /^(?:Building|Installing|Launching|Running|Testing|Verifying|Writing tests?)\b/i;
const GENERIC_WORDS = new Set([
  "app",
  "application",
  "bug",
  "changes",
  "code",
  "development",
  "everything",
  "failure",
  "issue",
  "problem",
  "task",
  "things",
  "workflow",
]);
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "from",
  "if",
  "in",
  "is",
  "into",
  "of",
  "on",
  "the",
  "to",
  "with",
]);

function purposeScore(value: string): number {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length < 20 || text.length > 120) return Number.NEGATIVE_INFINITY;

  const words = text
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu)
    ?.slice(1)
    .filter((word) => !STOP_WORDS.has(word)) ?? [];
  const meaningful = new Set(
    words.filter((word) => !GENERIC_WORDS.has(word)),
  ).size;

  let score = Math.min(meaningful * 2, 10);
  if (PURPOSE_VERB.test(text)) score += 18;
  if (DISCOVERY_VERB.test(text)) score -= 10;
  if (VERIFICATION_VERB.test(text)) score -= 12;
  if (/\b(?:across|end to end|every|so that|without)\b/i.test(text)) score += 4;
  if (/\bif\b/i.test(text)) score -= 12;
  if (PURPOSE_VERB.test(text) && meaningful === 0) score -= 18;
  return score;
}

/**
 * Pick the agent's clearest structured statement of purpose without rewriting it.
 * Discovery and verification steps stay activity; outcome-bearing steps lead.
 */
export function selectPlanPurpose(
  values: Array<string | null | undefined>,
): string | undefined {
  let best: { text: string; score: number } | undefined;
  for (const value of values) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    const score = purposeScore(text);
    if (score < 4 || (best && score <= best.score)) continue;
    best = { text, score };
  }
  return best?.text;
}
