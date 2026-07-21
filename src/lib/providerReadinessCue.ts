export type ProviderReadinessCue = "auth-required" | "provider-ready" | "interrupted";

export function providerReadinessCue(output: string): ProviderReadinessCue | null {
  const text = String(output ?? "").toLowerCase();
  const cues: Array<{ index: number; cue: ProviderReadinessCue }> = [];
  const add = (cue: ProviderReadinessCue, pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      cues.push({ index: match.index ?? 0, cue });
    }
  };

  add("auth-required", /\b(?:not authenticated|authentication required|api key required|oauth required|login required|sign in required|please (?:log|sign) in)\b/g);
  add("provider-ready", /\b(?:provider session ready|session started|authenticated successfully|logged in successfully|welcome[^\n]{0,80}session ready)\b/g);
  add("interrupted", /\b(?:cancelled|canceled|interrupted|aborted)\b/g);

  return cues.sort((left, right) => right.index - left.index)[0]?.cue ?? null;
}
