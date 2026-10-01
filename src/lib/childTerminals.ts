import type { AgentProvider, CanvasNode, Tab } from "./types";
import { findFreeCanvasSpot, type CanvasPosition } from "./canvasArrange";

// FEATURE-64: an agent running in a TermFleet pane asks for a child agent in its
// own visible terminal. The request names the parent by the pane's own
// TERMFLEET_PANE_ID; the app adopts it as a normal agent tab whose map card sits
// next to the parent without moving any other card.

export const CHILD_REQUEST_SCHEMA_VERSION = 1;
/** Helpers share one colour so they stand apart from ordinary terminals. */
export const HELPER_TERMINAL_COLOR = "#4fb6a8";
/** A parent that keeps spawning is a runaway loop, not a plan. */
export const MAX_CHILDREN_PER_PARENT = 8;
export const MAX_CHILD_TASK_LENGTH = 4000;
/** Requests older than this were abandoned by their CLI and must not appear later. */
export const CHILD_REQUEST_MAX_AGE_MS = 5 * 60_000;

const CHILD_PROVIDERS: readonly AgentProvider[] = ["claude", "codex", "opencode", "shell"];
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const RUNTIME_PANE_ID = new RegExp(`^terminal-(${UUID})-(${UUID})$`, "i");

export interface ChildTerminalRequest {
  version: number;
  requestId: string;
  /** Absent for a top-level instance started from outside any TermFleet pane. */
  parentPaneId?: string;
  provider: AgentProvider;
  task: string;
  /** Short card title; the task itself may be a long "read this file" instruction. */
  title?: string;
  cwd?: string;
  createdAt: number;
}

export interface ChildTerminalLink {
  parentPaneId: string;
  parentTabId: string;
  requestId: string;
}

export type ChildRequestParse =
  | { ok: true; request: ChildTerminalRequest }
  | { ok: false; reason: string };

/** The tab and pane a `terminal-<tabId>-<paneId>` runtime session id names. */
export function parseRuntimePaneId(id?: string | null): { tabId: string; paneId: string } | null {
  const match = id?.trim().match(RUNTIME_PANE_ID);
  return match ? { tabId: match[1], paneId: match[2] } : null;
}

export function parseChildRequest(raw: string, nowMs = Date.now()): ChildRequestParse {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "not-json" };
  }
  if (!value || typeof value !== "object") return { ok: false, reason: "not-an-object" };
  const record = value as Record<string, unknown>;
  if (record.version !== CHILD_REQUEST_SCHEMA_VERSION) return { ok: false, reason: "unsupported-version" };
  const requestId = typeof record.requestId === "string" ? record.requestId : "";
  if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) return { ok: false, reason: "bad-request-id" };
  const parentPaneId =
    typeof record.parentPaneId === "string" && record.parentPaneId.trim() ? record.parentPaneId.trim() : undefined;
  if (record.parentPaneId !== undefined && record.parentPaneId !== null && !parentPaneId) {
    return { ok: false, reason: "bad-parent-pane-id" };
  }
  if (parentPaneId && !parseRuntimePaneId(parentPaneId)) return { ok: false, reason: "bad-parent-pane-id" };
  const title =
    typeof record.title === "string" && record.title.trim() ? record.title.trim().slice(0, 120) : undefined;
  const provider = record.provider as AgentProvider;
  if (!CHILD_PROVIDERS.includes(provider)) return { ok: false, reason: "unsupported-provider" };
  const task = typeof record.task === "string" ? record.task.trim() : "";
  if (!task) return { ok: false, reason: "missing-task" };
  if (task.length > MAX_CHILD_TASK_LENGTH) return { ok: false, reason: "task-too-long" };
  let cwd: string | undefined;
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== "string" || !record.cwd.startsWith("/") || record.cwd.includes("\0")) {
      return { ok: false, reason: "bad-cwd" };
    }
    cwd = record.cwd;
  }
  const createdAt = typeof record.createdAt === "number" ? record.createdAt : NaN;
  if (!Number.isFinite(createdAt)) return { ok: false, reason: "bad-created-at" };
  if (nowMs - createdAt > CHILD_REQUEST_MAX_AGE_MS) return { ok: false, reason: "expired" };
  return {
    ok: true,
    request: { version: CHILD_REQUEST_SCHEMA_VERSION, requestId, parentPaneId, provider, task, title, cwd, createdAt },
  };
}

export type ChildLaunchPlan =
  | {
      ok: true;
      link?: ChildTerminalLink;
      parentTab?: Pick<Tab, "id" | "groupId" | "initialCwd">;
      placement: CanvasPosition;
    }
  | { ok: false; reason: "unknown-parent" | "duplicate-request" | "too-many-children" };

/**
 * Decide whether a validated request may launch, and where its card goes. Fails
 * closed: the parent must be a pane that is open in this workspace right now.
 */
export function planChildLaunch(input: {
  request: ChildTerminalRequest;
  tabs: readonly Pick<Tab, "id" | "groupId" | "initialCwd" | "childOf">[];
  nodes: readonly CanvasNode[];
  size: { width: number; height: number };
}): ChildLaunchPlan {
  const { request } = input;
  if (!request.parentPaneId) {
    // Top-level instance from outside any pane: no parent link, placed on free map space.
    if (input.tabs.some((tab) => tab.childOf?.requestId === request.requestId)) {
      return { ok: false, reason: "duplicate-request" };
    }
    const origin = { id: "origin", x: 0, y: 0, width: 0, height: 0 } as CanvasNode;
    return { ok: true, placement: findFreeCanvasSpot(origin, input.size, input.nodes) };
  }
  const parent = parseRuntimePaneId(request.parentPaneId);
  const parentTab = parent ? input.tabs.find((tab) => tab.id === parent.tabId) : undefined;
  if (!parent || !parentTab) return { ok: false, reason: "unknown-parent" };
  const children = input.tabs.filter(
    (tab) => tab.childOf?.parentPaneId === request.parentPaneId,
  );
  if (input.tabs.some((tab) => tab.childOf?.requestId === request.requestId)) {
    return { ok: false, reason: "duplicate-request" };
  }
  if (children.length >= MAX_CHILDREN_PER_PARENT) return { ok: false, reason: "too-many-children" };
  const parentNode =
    input.nodes.find((node) => node.terminalTabId === parent.tabId) ??
    ({ id: "parent-fallback", x: 0, y: 0, width: 0, height: 0 } as CanvasNode);
  return {
    ok: true,
    link: { parentPaneId: request.parentPaneId, parentTabId: parent.tabId, requestId: request.requestId },
    parentTab,
    placement: findFreeCanvasSpot(parentNode, input.size, input.nodes),
  };
}

export interface ChildLinkSegment {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type NodeBox = Pick<CanvasNode, "x" | "y" | "width" | "height">;

/** Where a line leaving `from` toward `to` crosses the edge of `from`. */
function edgeAnchor(from: NodeBox, to: NodeBox) {
  const cx = from.x + from.width / 2;
  const cy = from.y + from.height / 2;
  const dx = to.x + to.width / 2 - cx;
  const dy = to.y + to.height / 2 - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scale = Math.min(
    dx === 0 ? Infinity : from.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : from.height / 2 / Math.abs(dy),
  );
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** One line per child whose parent card is still on the map, edge to edge. */
export function childLinkSegments(
  tabs: readonly Pick<Tab, "id" | "childOf">[],
  nodes: readonly CanvasNode[],
): ChildLinkSegment[] {
  const nodeByTab = new Map<string, CanvasNode>();
  for (const node of nodes) {
    if (node.type === "terminal" && node.terminalTabId && !nodeByTab.has(node.terminalTabId)) {
      nodeByTab.set(node.terminalTabId, node);
    }
  }
  const segments: ChildLinkSegment[] = [];
  for (const tab of tabs) {
    const parentTabId = tab.childOf?.parentTabId;
    if (!parentTabId || parentTabId === tab.id) continue;
    const parent = nodeByTab.get(parentTabId);
    const child = nodeByTab.get(tab.id);
    if (!parent || !child) continue;
    const start = edgeAnchor(parent, child);
    const end = edgeAnchor(child, parent);
    segments.push({ id: tab.id, x1: start.x, y1: start.y, x2: end.x, y2: end.y });
  }
  return segments;
}

/** Best-effort request id from a request that failed validation, so its CLI hears back. */
export function requestIdOf(raw: string): string | null {
  try {
    const id = (JSON.parse(raw) as { requestId?: unknown }).requestId;
    return typeof id === "string" && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * What a helper terminal runs: the agent, started interactively on its task so
 * you can keep talking to it, then a normal shell so the terminal stays usable
 * after the agent exits. A `shell` helper runs the task as a command.
 */
export function childStartupCommand(provider: AgentProvider, task: string): string {
  const quoted = shellQuote(task);
  const start =
    provider === "shell"
      ? task
      : provider === "opencode"
        ? `opencode --prompt ${quoted}`
        : `${provider} ${quoted}`;
  return `${start}; exec "\${SHELL:-bash}" -l`;
}
