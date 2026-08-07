const GOAL_VERB =
  /\b(?:add|allow|build|change|check|clean|create|debug|deploy|design|enable|find|fix|generate|handle|implement|improve|install|investigate|make|migrate|move|plan|prevent|publish|refactor|release|remove|repair|replace|research|restart|restore|review|show|support|test|update|upgrade|use|verify|write|can we|can you|how|i need|i want|please|should we|what|why)\b/i;

export function openingGoalFromPrompt(value) {
  const text = String(value ?? "")
    .replace(/\[{1,3}\s*(?:Image|Screenshot|File|Pasted)\s*#?\d*[^\]]*\]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 12 || text.length >= 220) return "";
  if (/^[<$/]/.test(text) || /^(go|continue|done|this|that|it)\b/i.test(text)) {
    return "";
  }
  const words = text.split(/\s+/);
  if (words.length < 4 || !GOAL_VERB.test(text)) return "";
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
  const canKeepPrevious = !startsNewSession && previousGoal;
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
