const GOAL_VERB =
  /\b(?:add|allow|build|change|check|clean|create|debug|deploy|design|enable|find|fix|generate|handle|implement|improve|install|investigate|make|migrate|move|plan|prevent|publish|refactor|release|remove|repair|replace|research|restart|restore|review|show|support|test|update|upgrade|use|verify|write|can we|can you|how|i need|i want|please|should we|what|why)\b/i;

 export function isDurableGoalText(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return false;
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
  if (/^(?:how will that help|the timeline is just one issue)\b/i.test(text)) return false;
  return true;
}

export function openingGoalFromPrompt(value) {
  const text = String(value ?? "")
    .replace(/\[{1,3}\s*(?:Image|Screenshot|File|Pasted)\s*#?\d*[^\]]*\]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 12 || text.length >= 220 || !isDurableGoalText(text)) return "";
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
