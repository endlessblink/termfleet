// FEATURE-64: picks up helper-terminal requests that parent agents drop via the
// `termfleet-child` command. Each helper is a plain terminal (not an agent-run
// workstream) placed beside its parent, started right away in the daemon so it
// runs even while its card is off-screen, and marked with the parent link. The
// outcome is written back so the waiting command can report it.
import { checkAgentProvider } from "./agentProviders";
import {
  childStartupCommand,
  HELPER_TERMINAL_COLOR,
  parseChildRequest,
  planChildLaunch,
  requestIdOf,
} from "./childTerminals";
import { useWorkspaceStore } from "../stores/workspace";
import type { Tab } from "./types";

const POLL_INTERVAL_MS = 1_500;
const DEFAULT_CHILD_SIZE = { width: 1180, height: 720 };
// Loop guard: no more than this many agent-requested terminals per minute overall.
const SPAWN_WINDOW_MS = 60_000;
const MAX_SPAWNS_PER_WINDOW = 6;
let recentLaunches: number[] = [];
let started = false;
let ticking = false;

function hasTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function complete(requestId: string, result: Record<string, unknown>) {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("child_request_complete", {
    requestId,
    result: JSON.stringify({ requestId, completedAt: Date.now(), ...result }),
  }).catch((error) => console.warn("[child-terminals] could not report result:", error));
}

async function handle(raw: string) {
  const parsed = parseChildRequest(raw);
  if (!parsed.ok) {
    const requestId = requestIdOf(raw);
    console.warn("[child-terminals] rejected request:", parsed.reason);
    if (requestId) await complete(requestId, { ok: false, reason: parsed.reason });
    return;
  }
  let { request } = parsed;
  if (!request.parentPaneId && request.near) {
    // Started from outside any pane but "for" a project: join that project's row and group.
    const near = request.near;
    const homeTab = useWorkspaceStore
      .getState()
      .tabs.find((tab) => tab.initialCwd && (near === tab.initialCwd || near.startsWith(`${tab.initialCwd}/`)));
    if (homeTab) request = { ...request, parentPaneId: `terminal-${homeTab.id}-${homeTab.activePaneId}` };
  }
  const now = Date.now();
  recentLaunches = recentLaunches.filter((at) => now - at < SPAWN_WINDOW_MS);
  if (recentLaunches.length >= MAX_SPAWNS_PER_WINDOW) {
    await complete(request.requestId, { ok: false, reason: "rate-limited" });
    return;
  }
  recentLaunches.push(now);
  const store = useWorkspaceStore.getState();
  const parentNode = request.parentPaneId
    ? store.canvasState.nodes.find(
        (node) => node.terminalTabId && request.parentPaneId!.startsWith(`terminal-${node.terminalTabId}-`),
      )
    : undefined;
  const plan = planChildLaunch({
    request,
    tabs: store.tabs,
    nodes: store.canvasState.nodes,
    size: parentNode ? { width: parentNode.width, height: parentNode.height } : DEFAULT_CHILD_SIZE,
  });
  if (!plan.ok) {
    await complete(request.requestId, { ok: false, reason: plan.reason });
    return;
  }
  const availability = await checkAgentProvider(request.provider);
  if (!availability.available) {
    await complete(request.requestId, { ok: false, reason: "provider-unavailable", detail: availability.message });
    return;
  }

  const cwd = request.cwd ?? plan.parentTab?.initialCwd;
  const predecessor = plan.replaces ? store.tabs.find((candidate) => candidate.id === plan.parentTab?.id) : undefined;
  const command = childStartupCommand(request.provider, request.task);
  // Opening a helper must not pull the operator away from what they are doing.
  const previousTabId = store.activeTabId;
  const previousTerminalId = store.activeTerminalId;
  const knownTabIds = new Set(store.tabs.map((tab) => tab.id));
  store.addTab({
    title: `${plan.link ? "Helper" : "Agent"}: ${request.title ?? request.task}`,
    emoji: "↳",
    color: HELPER_TERMINAL_COLOR,
    initialCwd: cwd,
    // A handover stays in the project (and slot) of the card it replaces, even when
    // the successor's shell starts in another folder.
    projectCwd: predecessor
      ? predecessor.projectCwd ??
        store.canvasState.nodes.find((node) => node.terminalTabId === predecessor.id)?.terminalCwd ??
        predecessor.initialCwd
      : undefined,
    groupId: plan.parentTab?.groupId,
    childOf: predecessor ? predecessor.childOf : plan.link,
  }, plan.placement);
  const after = useWorkspaceStore.getState();
  const tab = after.tabs.find((candidate) => !knownTabIds.has(candidate.id));
  if (!tab) {
    await complete(request.requestId, { ok: false, reason: "launch-failed" });
    return;
  }
  // Only the new card is placed; every card already on the map stays put.
  after.updateCanvasNode(`terminal-map-${tab.id}`, plan.placement, "workspace-update");
  if (previousTabId && after.tabs.some((candidate) => candidate.id === previousTabId)) {
    after.setActiveTab(previousTabId);
    after.setActiveTerminal(previousTerminalId);
  }

  if (predecessor) {
    // Handover: the old session leaves the map but is kept (not killed) under the new card.
    after.archivePredecessor(predecessor.id, tab.id);
  }
  const childPaneId = `terminal-${tab.id}-${tab.activePaneId}`;
  // Start it now in the daemon; the card attaches to this same session later.
  // The daemon answers within 700ms, but starting a login shell can take longer:
  // the session still comes up, so asking again for the same id just reuses it.
  const { invoke } = await import("@tauri-apps/api/core");
  // Start at the card's own size. A default 80-column start leaves an agent drawing
  // in the left half of a wide card (a map card never reflows a running agent).
  const cardSize = parentNode ? { width: parentNode.width, height: parentNode.height } : DEFAULT_CHILD_SIZE;
  const cols = Math.max(40, Math.floor((cardSize.width - 80) / 7.9));
  const rows = Math.max(12, Math.floor((cardSize.height - 260) / 17));
  let startError: unknown = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await invoke("daemon_ensure_session", { id: childPaneId, cwd: cwd ?? null, command, cols, rows });
      startError = null;
      break;
    } catch (error) {
      startError = error;
      await new Promise((wait) => window.setTimeout(wait, 500 * (attempt + 1)));
    }
  }
  if (startError) {
    await complete(request.requestId, { ok: false, reason: "start-failed", detail: String(startError), childPaneId });
    return;
  }
  await complete(request.requestId, {
    ok: true,
    parentPaneId: request.parentPaneId ?? null,
    childTabId: tab.id,
    childPaneId,
    replacedTabId: predecessor?.id ?? null,
    provider: request.provider,
  });
}

let migrated = false;

/**
 * The first helpers were saved as agent-run workstreams, which brought up the
 * "Agent runs" panel. Turn any such saved helper into a plain helper terminal.
 */
function migrateEarlyHelpers() {
  const store = useWorkspaceStore.getState();
  for (const tab of store.tabs) {
    const legacy = (tab.workstream as { childOf?: Tab["childOf"] } | undefined)?.childOf;
    if (!legacy) continue;
    store.updateTab(tab.id, {
      workstream: undefined,
      childOf: tab.childOf ?? legacy,
      color: HELPER_TERMINAL_COLOR,
      emoji: "\u21B3",
      title: tab.title.startsWith("Helper: ") ? tab.title : `Helper: ${tab.title}`,
    });
  }
}

async function tick() {
  if (ticking || useWorkspaceStore.getState().hydrating) return;
  ticking = true;
  try {
    if (!migrated) {
      migrated = true;
      migrateEarlyHelpers();
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const requests = await invoke<string[]>("child_requests_take");
    // One at a time: each placement must see the card the previous one added.
    for (const raw of requests) await handle(raw);
  } catch (error) {
    console.warn("[child-terminals] poll failed:", error);
  } finally {
    ticking = false;
  }
}

// Agent-requested terminals are ON by default: an agent asked to start another
// instance must reach the map without anyone flipping a hidden flag (that flag
// being off is why spawn requests used to time out). Requests only come from this
// user's own processes (the request folder is mode 0700) and are rate limited.
// Turn off with localStorage `termfleet.experimental.helperTerminals` = "0".
const HELPER_TERMINALS_OPT_IN_KEY = "termfleet.experimental.helperTerminals";

function helperTerminalsEnabled() {
  try {
    return window.localStorage.getItem(HELPER_TERMINALS_OPT_IN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function startChildRequestLoop() {
  if (started || !hasTauri() || !helperTerminalsEnabled()) return;
  started = true;
  window.setInterval(() => void tick(), POLL_INTERVAL_MS);
}
