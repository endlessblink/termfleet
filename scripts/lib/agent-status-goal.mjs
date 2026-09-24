const GOAL_VERB =
  /\b(?:add|allow|build|change|check|clean|create|debug|deploy|design|enable|find|fix|generate|handle|implement|improve|install|investigate|make|migrate|move|plan|prevent|publish|refactor|release|remove|repair|replace|research|restart|restore|review|show|support|test|update|upgrade|use|verify|write|can we|can you|how|i need|i want|please|should we|what|why)\b/i;

export function isDurableGoalText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  // Assistant progress reports are not pane purpose, even when a hook labels them
  // as a plan explanation.  Accepting them makes the Goal row mirror our own report
  // and leaves no durable pane context after the report is rejected downstream.
  if (/\b(?:installed dock|live gate|visual gate|focused (?:visual|header) tests?|checksum|awaiting user approval|all live and visual)\b/i.test(text)) return false;
  if (/\b(?:goal|task)\s+management\b/i.test(text)) return false;
  if (/^(?:make|set|turn|mark|treat)\s+(?:this|that|it)\s+(?:as|a)\s+(?:the\s+)?goal\b/i.test(text)) return false;
  if (/^(?:activate|create|capture|rename)\s+(?:this\s+)?goal\b/i.test(text)) return false;
  if (/^(?:what|why|how|when|where|who|which|should|can|could|would|will|do|does|did|is|are|was|were)\b[\s\S]*\?$/i.test(text)) return false;
  if (/(?:hard fail|low quality|not enough context|not understanding|fully failing|didn['’]?t fix|didn['’]?t work|what you said .* false|for the (?:millionth|hundredth) time)/i.test(text)) return false;
  if (/^task\s+descrip\w*\s+is\s+(?:still\s+)?(?:super\s+)?broken\b/i.test(text)) return false;
  if (/\bworking\s+for\s+hour/i.test(text)) return false;
  if (/nothing\s+to\s+show\s+for\s+it/i.test(text)) return false;
  if (/(\p{L})\1{5,}/u.test(text)) return false;
  if (/\b(?:this|that)\s+is\s+a\s+(?:hard\s+)?fail(?:ure)?\b/i.test(text)) return false;
  if (/^(?:you['’]?re|you are)\s+right\b|^(?:i['’]?m|i am|i['’]?m sorry|i apologize)\b|^honest\s+status\b/i.test(text)) return false;
  if (/\b(?:display boundary|defense[- ]in[- ]depth|meta[- ]feedback|capture path)\b/i.test(text)) return false;
  // A command checklist is progress, not the durable purpose of the pane.
  if (/^(?:works?\.?|run|running|testing|checking|verifying|fixing)\b/i.test(text)) return false;
  if (/\bcommit and push\b.*\b(?:regression tests?|test suite)\b/i.test(text)) return false;
  if (/^(?:how will that help|the timeline is just one issue)\b/i.test(text)) return false;
  return true;
}

const GOAL_MAX = 180;
const DANGLING_END = /\s+(?:a|an|and|as|at|by|for|from|in|into|of|on|or|the|to|with|while|instead)$/i;

/**
 * A long, detailed request is usually the pane's real goal. Keep its first sentence
 * (or, failing that, a clean word-boundary cut) so it fits the Goal row, rather than
 * discarding it and letting a later follow-up become the goal.
 */
export function goalFromLongText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= GOAL_MAX) return text;
  const sentences = text.match(/[^.!?\n]+[.!?]?/g) ?? [text];
  let summary = "";
  for (const sentence of sentences) {
    const next = `${summary} ${sentence.trim()}`.trim();
    if (next.length > GOAL_MAX) break;
    summary = next;
    if (summary.split(/\s+/).length >= 6) break;
  }
  if (!summary) {
    summary = text.slice(0, GOAL_MAX).replace(/\s+\S*$/, "");
  }
  let cleaned = summary.replace(/[,;:\s]+$/, "");
  while (DANGLING_END.test(cleaned)) cleaned = cleaned.replace(DANGLING_END, "");
  return cleaned;
}

const REQUEST_ACTION =
  /\b(?:add|allow|build|change|check|clean|clear|close|commit|connect|convert|create|debug|delete|deploy|design|disable|enable|find|fix|generate|give|handle|implement|improve|install|integrate|investigate|make|merge|migrate|move|open|plan|prevent|publish|pull|push|refactor|release|remove|rename|research|restart|restore|revert|run|scan|show|split|start|stop|support|test|update|upgrade|use|verify|write|why|how|what|can we|can you|i want|i need|we should|should we|let's|lets|please)\b/i;

/**
 * Is this prompt a request that names work, rather than a short reply ("eta", "Next
 * steps", "the gate should be both")? Mirrors `opensAsRequest` in sessionTranscript.ts.
 * A reply must not replace the Task row's request (live report 2026-09-24).
 */
export function isRequestText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length < 12) return false;
  if (/^[<$/]/.test(text) || /^#\s*(?:AGENTS|CLAUDE)\.md instructions\b/i.test(text)) return false;
  const words = text.split(/\s+/);
  if (words.length < 4) return false;
  if (words.length < 8 && /^(?:this|that|it|these|those)\b/i.test(text)) return false;
  if (words.length < 8 && !REQUEST_ACTION.test(text)) return false;
  return true;
}

export function openingGoalFromPrompt(value) {
  const full = String(value ?? "")
    .replace(/\[{1,3}\s*(?:Image|Screenshot|File|Pasted)\s*#?\d*[^\]]*\]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Judge the whole request (its action verb is often in a later sentence), then keep
  // the short form for the Goal row.
  const text = goalFromLongText(full);
  if (text.length < 12 || !isDurableGoalText(text)) return "";
  if (/^[<$/]/.test(text) || /^(go|continue|done|this|that|it)\b/i.test(text)) {
    return "";
  }
  const words = full.split(/\s+/);
  if (words.length < 4 || !GOAL_VERB.test(full)) return "";
  return text;
}

export function durableGoalForPrompt({
  prompt,
  previousGoal,
  previousSource,
  previousSessionId,
  sessionId,
}) {
  const startsNewSession = Boolean(
    sessionId &&
      previousSessionId &&
      String(sessionId) !== String(previousSessionId),
  );
  const openingGoal = openingGoalFromPrompt(prompt);
  const canKeepPrevious = !startsNewSession && isDurableGoalText(previousGoal);
  return {
    startsNewSession,
    mainTask: canKeepPrevious ? previousGoal : openingGoal || undefined,
    mainTaskSource: canKeepPrevious
      ? previousSource
      : openingGoal
        ? "opening-request"
        : undefined,
  };
}
