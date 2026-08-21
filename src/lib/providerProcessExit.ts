export type ProviderProcessExit = {
  code: number;
  source: "provider" | "hook";
};

/**
 * Detect provider failures printed inside the shell-owned PTY. The PTY itself
 * remains alive after a provider child exits, so use its output as a separate
 * lifecycle signal instead of waiting for the PTY exit callback.
 */
export function inferProviderProcessExit(
  output: string,
): ProviderProcessExit | null {
  const providerMatches = [
    ...output.matchAll(
      /\b(?:process|provider|command)\s+exited\s+with\s+(?:code|status)\s+(-?\d+)\b/gi,
    ),
  ];
  const hookMatches = [
    ...output.matchAll(
      /\bhook\s+exited\s+with\s+(?:code|status)\s+(-?\d+)\b/gi,
    ),
  ];
  const provider = providerMatches[providerMatches.length - 1]
    ? { match: providerMatches[providerMatches.length - 1], source: "provider" as const }
    : null;
  const hook = hookMatches[hookMatches.length - 1]
    ? { match: hookMatches[hookMatches.length - 1], source: "hook" as const }
    : null;
  // A hook failure is the more specific provider failure when both summaries
  // are present in the same shell transcript.
  const selected = hook ?? provider;
  if (!selected) return null;
  const code = Number(selected.match[1]);
  if (!Number.isInteger(code)) return null;
  return {
    code,
    source: selected.source,
  };
}
