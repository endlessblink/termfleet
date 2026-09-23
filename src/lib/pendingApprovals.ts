import type { CanvasNode, Group, Tab, AgentProvider } from "./types";
import { linkedTerminalForMapNode, tabForMapNode } from "./mapNodeFilters";
import { paneBadgeAttention } from "./sessionStatus";
import { pathTail, projectForTab } from "./projectDisplay";

export type PendingApprovalCategory =
  | "permission"
  | "plan"
  | "decision"
  | "question"
  | "input";

export interface PendingApprovalItem {
  nodeId: string;
  node: CanvasNode;
  terminalId?: string;
  tabId?: string;
  tabTitle?: string;
  projectName: string;
  projectEmoji?: string;
  provider?: AgentProvider;
  category: PendingApprovalCategory;
  categoryLabel: string;
  headline: string;
  detail?: string;
  targetSummary?: string;
  updatedAt?: number;
}

function cleanLine(value?: string | null): string {
  return String(value ?? "").replace(/\r/g, "").trim();
}

/**
 * Extracts specific tool or action context when a prompt asks "Do you want to proceed?"
 * or "Would you like to run the following command?"
 */
function extractProceedContext(text: string): { headline: string; detail?: string } {
  const lines = text.split("\n").map(cleanLine).filter(Boolean);

  // Codex asks first and prints command/reason under the question
  const codexQuestion = /\bWould you like to (?:run the following command|make the following edits|[^?\n]{3,80})\?/i;
  let codexIdx = -1;
  lines.forEach((l, index) => {
    if (codexQuestion.test(l)) codexIdx = index;
  });
  if (codexIdx >= 0) {
    const following = lines.slice(codexIdx + 1, codexIdx + 12);
    const command = following.find((l) => /^\$\s+/.test(l));
    const reason = following.find((l) => /^Reason:\s+/i.test(l));
    const cleanCmd = command?.replace(/^\$\s+/, "").trim();
    const cleanReason = reason?.replace(/^Reason:\s*/i, "").trim();
    return {
      headline: /edits/i.test(lines[codexIdx]) ? "Apply Edits" : "Command Approval",
      detail: cleanReason && cleanCmd ? `${cleanReason} ($ ${cleanCmd})` : cleanCmd || cleanReason || lines[codexIdx],
    };
  }

  const proceedIdx = lines.findIndex((l) =>
    /\b(?:Do|Would) you (?:want|like) (?:to|me to) (?:run\b|execute\b|proceed\b)/i.test(l)
  );

  // Look at lines directly before the proceed question (Claude tool use format)
  const preceding = proceedIdx > 0 ? lines.slice(Math.max(0, proceedIdx - 6), proceedIdx) : lines.slice(-6);

  // Claude / Codex tool calls: e.g. Claude wants to search the web for: ...
  const wantsLine = preceding.find((l) => /\bwants to\b/i.test(l));
  if (wantsLine) {
    return {
      headline: "Permission Request",
      detail: wantsLine,
    };
  }

  // Tool signature: e.g. Web Search("..."), Bash("...")
  const toolCallLine = preceding.find((l) =>
    /^[A-Za-z0-9_ -]+\([^)]*\)/.test(l) || /^Tool use\b/i.test(l)
  );
  if (toolCallLine) {
    const formatted = toolCallLine.replace(/^Tool use\s*/i, "").trim();
    return {
      headline: "Tool Permission",
      detail: formatted || toolCallLine,
    };
  }

  // Explicit Confirm: line
  const confirmLine = preceding.find((l) => /^Confirm:\s+/i.test(l));
  if (confirmLine) {
    return {
      headline: "Action Confirmation",
      detail: confirmLine.replace(/^Confirm:\s*/i, "").trim(),
    };
  }

  return {
    headline: "Permission to Proceed",
    detail: "Agent requested operator approval before continuing.",
  };
}

export function getPendingApproval(
  node: CanvasNode,
  tab?: Tab,
  liveCwd?: string,
  groups?: Group[],
): PendingApprovalItem | null {
  if (node.type !== "terminal") return null;

  const terminal = linkedTerminalForMapNode(node, tab);
  const workstream = tab?.workstream;
  const badgeAttention = paneBadgeAttention(
    terminal,
    terminal ? undefined : workstream?.statusSummary?.status ?? workstream?.status,
  );

  // Listed exactly when the card's badge reads Waiting — never from leftover words
  // (operator decision, TF-044).
  const isWaiting = badgeAttention === "waiting";
  if (!isWaiting) return null;

  const screenText = terminal?.terminalVisibleText ?? "";
  const outputTail = terminal?.terminalOutput ? terminal.terminalOutput.slice(-3000) : "";
  const combinedTail = (screenText || outputTail).replace(/\r/g, "\n");

  const statusSummary = terminal?.statusSummary ?? workstream?.statusSummary;
  const taskLine = (terminal?.taskLine?.text ?? "").trim();
  const taskText = (statusSummary?.task ?? "").trim();
  const nowText = (statusSummary?.now ?? terminal?.nowLine?.text ?? terminal?.currentActivity ?? workstream?.currentActivity ?? "").trim();
  const recentEvents = Array.isArray(statusSummary?.recent) ? statusSummary.recent : [];
  const latestRecent = (recentEvents[recentEvents.length - 1]?.text ?? "").trim();
  const mainUserAsk = (terminal?.mainUserAsk?.text ?? "").trim();

  // Determine category and details
  let category: PendingApprovalCategory = "input";
  let categoryLabel = "Action Required";
  let headline = "Waiting for your approval";
  let detail: string | undefined = undefined;

  // 1. Plan Implementation Confirmation
  if (/\bImplement this plan\b/i.test(combinedTail || taskLine || taskText || latestRecent)) {
    category = "plan";
    categoryLabel = "Plan Approval";
    headline = "Implement Plan";
    detail = "Agent drafted a plan and needs your sign-off to execute.";
  }
  // 2. Choice / Decision Prompt
  else if (
    /\b(?:How do you want to proceed|What do you want to do|Where to go:|while you choose|choose an option|select an option)\b/i.test(combinedTail || taskLine || taskText) ||
    /\b(?:Which|What) .* (?:while you choose|choose)\b/i.test(taskLine || taskText)
  ) {
    category = "decision";
    categoryLabel = "Decision Required";
    const promptText = taskLine || taskText || combinedTail;
    const cleanQuestion = promptText.replace(/^>\s*/, "").split(/[.?]\s/)[0].trim();
    headline = cleanQuestion.length > 5 && cleanQuestion.length < 50 ? cleanQuestion : "Select Next Step";
    detail = promptText.replace(/^>\s*/, "").trim() || "Multiple options available; choose how the agent should proceed.";
  }
  // 3. Tool / Command Permission
  else if (
    /\b(?:Do|Would) you (?:want|like) (?:to|me to) (?:run\b|execute\b|proceed\b)/i.test(combinedTail) ||
    /\bWould you like to (?:run the following command|make the following edits)\?/i.test(combinedTail) ||
    /\brequires? approval\b/i.test(combinedTail || taskLine || taskText) ||
    /\bapproval required\b/i.test(combinedTail || taskLine || taskText) ||
    statusSummary?.task === "Reviewing approval request" ||
    statusSummary?.now === "Waiting for operator selection" ||
    /\bAction Required\b/i.test(combinedTail || nowText || taskLine)
  ) {
    category = "permission";
    categoryLabel = "Tool Permission";
    if (combinedTail) {
      const context = extractProceedContext(combinedTail);
      headline = context.headline;
      detail = context.detail ?? nowText;
    } else if (taskLine && !/^No task declared/i.test(taskLine)) {
      headline = "Command Approval";
      detail = taskLine;
    } else {
      headline = "Tool Permission";
      detail = nowText || "Waiting for operator selection";
    }
  }
  // 4. Questions unanswered
  else if (
    /\bQuestions?\s+\d+\/\d+\s+\([1-9]\d*\s+unanswered\)/i.test(combinedTail) ||
    /\bAskUserQuestion\b/i.test(nowText || latestRecent) ||
    statusSummary?.task === "Waiting for your answer"
  ) {
    category = "question";
    categoryLabel = "Question";
    headline = "Question Pending";
    detail = mainUserAsk || taskLine || "Agent paused for your answer to continue.";
  }
  // 5. Fallback operator wait
  else {
    category = "input";
    categoryLabel = "Action Required";
    const cleanHeadline = (taskLine && !/^No task declared/i.test(taskLine))
      ? taskLine.replace(/^>\s*/, "").split(/[.?]\s/)[0].trim()
      : taskText || (/\bGoal stalled\b/i.test(nowText || taskLine) ? "Goal Stalled" : "Input Required");
    headline = cleanHeadline.length > 50 ? `${cleanHeadline.slice(0, 47)}…` : cleanHeadline;
    detail =
      nowText ||
      mainUserAsk ||
      "Terminal is awaiting your input at the prompt.";
  }

  const project = projectForTab(tab, groups ?? []);
  const projectName = project ? project.name : (tab?.title || node.title);
  const projectEmoji = project?.emoji ?? tab?.emoji;
  const provider = terminal?.agentProvider ?? workstream?.provider;

  const resolvedCwd = liveCwd ?? terminal?.id ? liveCwd : undefined;
  const targetSummary = pathTail(resolvedCwd ?? node.terminalCwd ?? tab?.initialCwd);

  const updatedAt =
    terminal?.terminalVisibleTextUpdatedAt ??
    terminal?.statusSummaryUpdatedAt ??
    terminal?.activityUpdatedAt ??
    Date.now();

  return {
    nodeId: node.id,
    node,
    terminalId: terminal?.id,
    tabId: tab?.id,
    tabTitle: tab?.title,
    projectName,
    projectEmoji,
    provider,
    category,
    categoryLabel,
    headline,
    detail,
    targetSummary,
    updatedAt,
  };
}

export function getPendingApprovals(
  nodes: CanvasNode[],
  tabs: Tab[],
  liveCwds?: Record<string, string>,
  groups?: Group[],
): PendingApprovalItem[] {
  const results: PendingApprovalItem[] = [];
  const tabMap = new Map<string, Tab>();
  for (const tab of tabs) tabMap.set(tab.id, tab);

  for (const node of nodes) {
    if (node.type !== "terminal") continue;
    const tab = tabForMapNode(node, tabs);
    const liveTermId = linkedTerminalForMapNode(node, tab)?.id ?? node.terminalPtyId;
    const liveCwd = liveTermId && liveCwds ? liveCwds[liveTermId] : undefined;
    const item = getPendingApproval(node, tab, liveCwd, groups);
    if (item) results.push(item);
  }

  return results;
}
