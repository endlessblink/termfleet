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
  // The tool-permission prompt — the most common way a pane is blocked on the operator.
  // It was missing, so a pane sitting on "Do you want to proceed?" showed Idle (or
  // "Status unavailable" once its record aged out) and the Waiting filter counted zero
  // while the prompt was on screen (operator report 2026-07-28). Paired with the prompt's
  // own footer so an answered prompt scrolled up in history cannot keep the pane amber.
  add("waiting", pairedMarkerIndex(
    tail,
    /\b(?:Do|Would) you (?:want|like) (?:to|me to) proceed\?/gi,
    /\b(?:esc to cancel|tab to amend|enter to (?:select|confirm))\b/i,
  ));

  // Codex's approval prompts ("Would you like to run the following command?",
  // "…make the following edits?") word it differently from Claude and log nothing
  // anywhere else — the screen is the only signal. Operator report 2026-09-23: a
  // flow-state pane sat on this prompt while its badge said Idle (TF-044).
  add("waiting", pairedMarkerIndex(
    tail,
    /\bWould you like to (?:run the following command|make the following edits|[^?\n]{3,80})\?/gi,
    /\bPress enter to confirm or esc to cancel\b/i,
  ));

  add("waiting", pairedMarkerIndex(
    tail,
    /\bWhich .* (?:while you choose|choose)\b/gi,
    /\b(?:enter to|select|confirm)\b/i,
  ));

  add("waiting", lastMatchIndex(
    tail,
    /\b\[\s*[!.]\s*\]\s*Action Required\b/gi,
  ));

  add("running", lastMatchIndex(
    tail,
    /(?:Working|Crafting|Thundering|Thinking)\s*(?:…|\.\.\.)?\s*\(\s*\d+\s*[smh]/gi,
  ));

  // The live spinner footer both Claude ("✻ Pondering… (12s · esc to interrupt)")
  // and Codex ("Working (12s • esc to interrupt)") draw ONLY while a turn runs. Claude
  // rotates the verb, so key on the footer, not the word.
  add("running", lastMatchIndex(
    tail,
    /\(\s*\d+\s*[smh][^)\n]{0,120}\besc to interrupt\b/gi,
  ));

  add("idle", lastMatchIndex(
    tail,
    /(?:Worked|Cooked|Baked)\s+for\s+\d+\s*[smh]/gi,
  ));
  add("idle", lastMatchIndex(
    tail,
    /\bConversation interrupted\b/gi,
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

export function isTerminalWaitingForOperator(
  terminal?: {
    terminalVisibleText?: string | null;
    terminalOutput?: string | null;
    taskLine?: { text?: string | null; rejected?: string | null } | null;
    nowLine?: { text?: string | null } | null;
    currentActivity?: string | null;
    statusSummary?: {
      status?: string | null;
      now?: string | null;
      task?: string | null;
      recent?: Array<{ text?: string | null }> | null;
    } | null;
  } | null,
  workstream?: {
    status?: string | null;
    phase?: string | null;
    readiness?: string | null;
    currentActivity?: string | null;
    statusSummary?: {
      status?: string | null;
      now?: string | null;
      task?: string | null;
      recent?: Array<{ text?: string | null }> | null;
    } | null;
  } | null,
): boolean {
  if (!terminal && !workstream) return false;

  const screenText = terminal?.terminalVisibleText ?? "";
  const outputTail = terminal?.terminalOutput ? terminal.terminalOutput.slice(-3000) : "";
  const combinedTail = (screenText || outputTail).replace(/\r/g, "\n");

  if (terminalNeedsOperatorAnswer(combinedTail)) return true;

  // Screen questions / CLI prompts
  if (
    /\b(?:Implement this plan\?|How do you want to proceed\?|What do you want to do\?|Questions?\s+\d+\/\d+\s+\([1-9]\d*\s+unanswered\))\b/i.test(combinedTail) ||
    /\b(?:Do|Would) you (?:want|like) (?:to|me to) (?:run\b|execute\b|proceed\b)/i.test(combinedTail) ||
    /\b(?:\(y\/n\)|\(yes\/no\)|\[y\/N\]|\[Y\/n\])\s*[:?]?\s*$/im.test(combinedTail) ||
    /\b\[\s*[!.]\s*\]\s*Action Required\b/i.test(combinedTail)
  ) {
    const attention = terminalScreenAttention(combinedTail);
    if (attention === "waiting" || attention === null) return true;
  }

  const statusSummary = terminal?.statusSummary ?? workstream?.statusSummary;
  const status = statusSummary?.status ?? workstream?.status;

  if (status === "waiting" || status === "blocked") return true;
  if (workstream?.phase === "needs-input" || workstream?.readiness === "auth-required") return true;

  const nowText = statusSummary?.now ?? terminal?.nowLine?.text ?? terminal?.currentActivity ?? workstream?.currentActivity ?? "";
  if (/\b(?:waiting for (?:your )?(?:input|answer|operator|approval|decision|choice|selection|confirmation)|using AskUserQuestion|askuserquestion|action required|goal stalled)\b/i.test(nowText)) {
    return true;
  }

  const taskLine = terminal?.taskLine?.text ?? "";
  const taskText = statusSummary?.task ?? "";
  if (
    /\b(?:Which .* (?:while you choose|choose)|(?:Do|Would) you (?:want|like) (?:to|me to) (?:run\b|execute\b|proceed\b)|Implement this plan|Reviewing approval request|Waiting for your answer|Waiting for your input|Waiting for operator selection|approval required|action required|waiting for confirmation|needs? confirmation|Goal stalled)\b/i.test(taskLine) ||
    /\b(?:Which .* (?:while you choose|choose)|(?:Do|Would) you (?:want|like) (?:to|me to) (?:run\b|execute\b|proceed\b)|Implement this plan|Reviewing approval request|Waiting for your answer|Waiting for your input|Waiting for operator selection|approval required|action required|waiting for confirmation|needs? confirmation|Goal stalled)\b/i.test(taskText)
  ) {
    return true;
  }

  if (Array.isArray(statusSummary?.recent) && status !== "working") {
    const recent = statusSummary.recent;
    const latest = recent[recent.length - 1]?.text ?? "";
    const secondLatest = recent[recent.length - 2]?.text ?? "";
    if (/\b(?:waiting for (?:your )?(?:input|answer|operator|approval|decision|choice|selection)|AskUserQuestion|action required|goal stalled)\b/i.test(latest || secondLatest)) {
      return true;
    }
  }

  if (/\b(?:manual_action_required|action required)\b/i.test(terminal?.taskLine?.rejected ?? "")) {
    return true;
  }

  return false;
}
