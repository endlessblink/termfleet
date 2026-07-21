export type TerminalScreenAttention = "running" | "waiting" | "idle";

interface ScreenMarker {
  attention: TerminalScreenAttention;
  index: number;
}

function lastMatchIndex(value: string, pattern: RegExp): number {
  const matches = [...value.matchAll(pattern)];
  return matches[matches.length - 1]?.index ?? -1;
}

function pairedMarkerIndex(value: string, startPattern: RegExp, endPattern: RegExp): number {
  const start = lastMatchIndex(value, startPattern);
  if (start < 0) return -1;
  const end = value.slice(start).search(endPattern);
  return end < 0 ? -1 : start + end;
}

/**
 * Classify only exact lifecycle chrome emitted by the agent TUIs. The marker nearest
 * the live bottom wins, so an old question in visible history cannot keep a completed
 * or interrupted turn stuck on Waiting. Ordinary prose and question marks never count.
 */
export function terminalScreenAttention(value?: string | null): TerminalScreenAttention | null {
  const tail = String(value ?? "").replace(/\r/g, "\n").slice(-4000);
  if (!tail) return null;

  const markers: ScreenMarker[] = [];
  const add = (attention: TerminalScreenAttention, index: number) => {
    if (index >= 0) markers.push({ attention, index });
  };

  add("waiting", pairedMarkerIndex(
    tail,
    /\bImplement this plan\?/gi,
    /\bpress enter to confirm\b/i,
  ));
  add("waiting", pairedMarkerIndex(
    tail,
    /\bHow do you want to proceed\?/gi,
    /\benter to select\b/i,
  ));
  add("waiting", pairedMarkerIndex(
    tail,
    /\bWhat do you want to do\?/gi,
    /\benter to confirm\b/i,
  ));
  add("waiting", pairedMarkerIndex(
    tail,
    /\bQuestions?\s+\d+\/\d+\s+\([1-9]\d*\s+unanswered\)/gi,
    /\benter to submit answer\b/i,
  ));

  add("running", lastMatchIndex(
    tail,
    /(?:Working|Crafting|Thundering|Thinking)\s*(?:…|\.\.\.)?\s*\(\s*\d+\s*[smh]/gi,
  ));

  add("idle", lastMatchIndex(
    tail,
    /(?:Worked|Cooked|Baked)\s+for\s+\d+\s*[smh]/gi,
  ));
  add("idle", lastMatchIndex(
    tail,
    /(?:Request interrupted by user|Interrupted\s*[·:]\s*What should Claude do instead\?)/gi,
  ));

  const latest = markers.sort((left, right) => right.index - left.index)[0];
  return latest?.attention ?? null;
}

export function terminalNeedsOperatorAnswer(value?: string | null): boolean {
  return terminalScreenAttention(value) === "waiting";
}

export function terminalShowsActiveAgentWork(value?: string | null): boolean {
  return terminalScreenAttention(value) === "running";
}
