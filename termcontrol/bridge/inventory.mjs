import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PATHS } from './paths.mjs';

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
};

/**
 * A restored map card can persist its split leaves before the runtime terminal
 * records attach. Those leaves still own their exact terminal-<tab>-<pane> IDs.
 * Project a complete read-only inventory; never guess ownership from a cwd,
 * replace an explicit runtime binding, or revive a closed/predecessor ID.
 */
export function withLayoutTerminals(workspace) {
  if (!Array.isArray(workspace?.tabs)) return workspace;
  const retired = new Set(workspace.closedSessionIds || []);
  for (const tab of workspace.tabs) for (const earlier of tab.earlierSessions || []) {
    for (const id of earlier.ptyIds || []) retired.add(id);
  }
  const leaves = (node) => node?.type === 'terminal' && node.id ? [node.id]
    : node?.type === 'split' ? (node.children || []).flatMap(leaves) : [];
  return { ...workspace, tabs: workspace.tabs.map((tab) => {
    const terminals = tab.terminals || [];
    // Populated records already carry the authoritative runtime bindings.
    if (terminals.length || !tab.id) return tab;
    const inferred = leaves(tab.splitLayout).map((paneId) => ({
      id: `terminal-${tab.id}-${paneId}`, paneId, initialCwd: tab.initialCwd,
    })).filter((terminal) => !retired.has(terminal.id));
    return inferred.length ? { ...tab, terminals: inferred } : tab;
  }) };
}

/**
 * The desktop rewrites workspace.json (over a megabyte) while termcontrol reads
 * it, so a read can land on a half-written file. Treating that as "no map" made
 * every daemon session reappear until the next poll. Keep the last good copy and
 * fall back to it, so the list never flickers back to the full set.
 */
let lastWorkspace = { mtimeMs: 0, value: null };
export function readWorkspace() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(PATHS.workspace).mtimeMs; } catch { return lastWorkspace.value; }
  if (mtimeMs === lastWorkspace.mtimeMs && lastWorkspace.value) return lastWorkspace.value;
  const fresh = readJson(PATHS.workspace);
  if (fresh && Array.isArray(fresh.tabs)) {
    const workspace = withLayoutTerminals(fresh);
    if (Array.isArray(workspace.canvasState?.nodes)) {
      const retired = retiredTerminalIds(workspace);
      const ownedTabs = new Set(workspace.tabs
        .filter((tab) => (tab.terminals || []).some((terminal) => terminal?.id && !retired.has(terminal.id)))
        .map((tab) => tab.id));
      // Filter the read-only view after recovering split ownership. A missing
      // daemon session alone must never hide a card waiting to reconnect.
      workspace.canvasState = { ...workspace.canvasState, nodes: workspace.canvasState.nodes
        .filter((node) => node?.type !== 'terminal' || ownedTabs.has(node.terminalTabId)) };
    }
    lastWorkspace = { mtimeMs, value: workspace };
    return lastWorkspace.value;
  }
  return lastWorkspace.value;
}

/** Stable version of ownership, order and shared project identity, never activity. */
export function inventoryVersion(workspace) {
  const ownership = {
    tabs: (workspace?.tabs || []).map((tab) => ({ id: tab.id, groupId: tab.groupId,
      terminals: (tab.terminals || []).map((terminal) => ({ id: terminal.id, paneId: terminal.paneId })),
      splitLayout: tab.splitLayout, earlierIds: (tab.earlierSessions || []).flatMap((earlier) => earlier.ptyIds || []),
    })),
    groups: (workspace?.groups || []).map(({ id, name, emoji, color }) => ({ id, name, emoji, color })),
    nodes: (workspace?.canvasState?.nodes || []).map(({ id, type, terminalTabId }) => ({ id, type, terminalTabId })),
    order: workspace?.workspaceUiState?.canvasSidebarManualOrder,
    sort: workspace?.workspaceUiState?.canvasSidebarSortMode,
    closed: workspace?.closedSessionIds,
  };
  return createHash('sha256').update(JSON.stringify(ownership)).digest('hex');
}

const PROVIDERS = { claude: 'claude', codex: 'codex', opencode: 'opencode' };

function providerOf(source) {
  const s = String(source || '');
  for (const key of Object.keys(PROVIDERS)) if (s.startsWith(key)) return key;
  return null;
}

const CODEX_ROLLOUT = /rollout-[^/]*-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;
let agentScan = { at: 0, byPane: new Map() };

/**
 * An agent started by hand in a terminal may never have written a status
 * record, and then the phone took it for a plain shell and showed its raw
 * screen. The process table is the ground truth: each agent process carries
 * its terminal's id, and Codex keeps its conversation file open while Claude
 * records its conversation id per process.
 */
export function agentsByPane({ procRoot = '/proc', claudeSessions = path.join(process.env.HOME || '', '.claude', 'sessions'), now = Date.now() } = {}) {
  if (procRoot === '/proc' && now - agentScan.at < 3000) return agentScan.byPane;
  const byPane = new Map();
  // Codex also holds its helpers' conversation files open (reviews, sub-agents),
  // so every open conversation is gathered per terminal and the main one picked
  // afterwards: the one named by `codex resume <id>`, else the oldest — helpers
  // are always started after the conversation that spawned them.
  const codexSeen = new Map();
  const freshest = new Map();   // paneId -> when the kept claude record was last updated
  let pids = [];
  try { pids = fs.readdirSync(procRoot).filter((name) => /^\d+$/.test(name)); } catch { return byPane; }
  for (const pid of pids) {
    let cmd = '';
    try { cmd = fs.readFileSync(path.join(procRoot, pid, 'cmdline'), 'utf8').split('\0').join(' '); } catch { continue; }
    const provider = /(^|\/)codex( |$)/.test(cmd) ? 'codex'
      // Claude Code's native build runs as claude.exe on Linux too (2026-10-16: a
      // restarted chat ran as claude.exe and the phone kept showing the old one).
      : /(^|\/)claude(\.exe)?( |$)/.test(cmd) ? 'claude'
      : /(^|\/)opencode( |$)/.test(cmd) ? 'opencode'
      : null;
    if (!provider) continue;
    let paneId = null;
    try {
      const env = fs.readFileSync(path.join(procRoot, pid, 'environ'), 'utf8');
      paneId = env.match(/(?:^|\0)TERMFLEET_PANE_ID=([^\0]+)/)?.[1] || null;
    } catch { continue; }
    if (!paneId) continue;
    let sessionId = null;
    if (provider === 'codex') {
      const seen = codexSeen.get(paneId) || { resumed: null, open: [] };
      seen.resumed ||= cmd.match(/\bresume\s+([0-9a-f]{8}-[0-9a-f-]{27})\b/)?.[1] || null;
      try {
        for (const fd of fs.readdirSync(path.join(procRoot, pid, 'fd'))) {
          let target = '';
          try { target = fs.readlinkSync(path.join(procRoot, pid, 'fd', fd)); } catch { continue; }
          const match = target.match(CODEX_ROLLOUT);
          if (match) seen.open.push({ id: match[1], file: path.basename(target) });
        }
      } catch { /* not ours to read */ }
      codexSeen.set(paneId, seen);
    }
    let vendorStatus = null;
    let freshness = 0;
    if (provider === 'claude') {
      // Claude's own per-process record: its conversation, and whether it is idle,
      // busy or waiting on the operator. That status comes from the agent itself.
      const recordFile = path.join(claudeSessions, `${pid}.json`);
      const record = readJson(recordFile);
      sessionId = record?.sessionId || null;
      if (['idle', 'busy', 'waiting'].includes(record?.status)) vendorStatus = { status: record.status, at: Number(record.statusUpdatedAt) || null, ...(record.status === 'waiting' && record.waitingFor ? { waitingFor: String(record.waitingFor) } : {}) };
      try { freshness = Math.max(Number(record?.statusUpdatedAt) || 0, fs.statSync(recordFile).mtimeMs); } catch { freshness = Number(record?.statusUpdatedAt) || 0; }
    }
    const previous = byPane.get(paneId);
    // The wrapper and the real binary share a terminal; keep whichever knows the
    // conversation. When two claude processes both know one (a leftover original
    // after a restart moved the chat to a new record, 2026-10-16), the one whose
    // record was updated last is the live conversation: following the other made
    // the phone show a frozen chat where new messages "disappeared".
    if (!previous || (!previous.sessionId && sessionId) || (sessionId && previous.sessionId && freshness > (freshest.get(paneId) || 0))) {
      byPane.set(paneId, { provider, sessionId, ...(vendorStatus ? { vendorStatus } : {}) });
      freshest.set(paneId, freshness);
    }
  }
  for (const [paneId, seen] of codexSeen) {
    const main = seen.open.find((item) => item.id === seen.resumed)
      || [...seen.open].sort((a, b) => a.file.localeCompare(b.file))[0];
    const sessionId = main?.id || seen.resumed || null;
    if (sessionId) byPane.set(paneId, { provider: 'codex', sessionId });
  }
  if (procRoot === '/proc') agentScan = { at: now, byPane };
  return byPane;
}

/**
 * One pane record as written by the status hooks. The file name is opaque; the
 * record itself carries the identity we care about.
 */
function readPaneRecords() {
  let names = [];
  try { names = fs.readdirSync(PATHS.agentStatus); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.startsWith('pane-') || !name.endsWith('.json')) continue;
    const file = path.join(PATHS.agentStatus, name);
    const rec = readJson(file);
    if (!rec) continue;
    let mtime = 0;
    try { mtime = fs.statSync(file).mtimeMs; } catch { /* ignore */ }
    out.push({ ...rec, _file: name, _mtime: mtime });
  }
  return out;
}

/**
 * A project the desktop has no lane for still needs an icon, or the fleet
 * shows a blank where every other row has one. The choice is derived from the
 * name so it never changes between looks.
 */
const FALLBACK_ICONS = ['🗂️', '📘', '🧩', '🔧', '🧪', '📐', '🗺️', '🎯', '🛠️', '📎', '🧱', '🔭'];

function iconFor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
  return FALLBACK_ICONS[hash % FALLBACK_ICONS.length];
}

/** Plain-language line describing what this pane is doing, or null. */
function taskLine(rec) {
  const inProgress = (rec.todos || []).find((t) => t.status === 'in_progress');
  const candidate =
    (inProgress && (inProgress.activeForm || inProgress.content)) ||
    rec.mainTask ||
    rec.now ||
    null;
  const text = typeof candidate === 'string' ? candidate.trim() : '';
  return text.length > 0 ? text : null;
}

/** waiting > working > idle, from what the hooks recorded. */
function turnOf(rec) {
  const t = String(rec.turn || '').toLowerCase();
  if (t === 'waiting' || t === 'working' || t === 'idle') return t;
  return 'idle';
}

/**
 * The desktop cockpit gives every tab an emoji, colour and title. Terminal ids
 * in the workspace file are exactly the pane ids we key on, so the phone can
 * show the same identity the operator already recognises.
 */
function tabDecorations(ws) {
  const byTerminal = new Map();
  const byProjectName = new Map();

  // The emoji and human project name live on the group (the project lane);
  // tabs themselves all carry the same placeholder square.
  const groups = new Map();
  for (const g of ws?.groups || []) {
    if (!g?.id) continue;
    const name = g.name || g.title || null;
    const look = { emoji: g.emoji || null, name, color: g.color || null };
    groups.set(g.id, look);
    if (name) byProjectName.set(name, look);
  }

  for (const tab of ws?.tabs || []) {
    const g = groups.get(tab.groupId) || {};
    for (const term of tab.terminals || []) {
      if (!term?.id) continue;
      byTerminal.set(term.id, {
        emoji: g.emoji || null,
        color: g.color || tab.color || null,
        groupId: tab.groupId || null,
        groupName: g.name || null,
      });
    }
  }
  return { byTerminal, byProjectName };
}

function orderedCanvasNodes(workspace) {
  const nodes = (workspace?.canvasState?.nodes || []).filter((node) => node?.type === 'terminal');
  const manual = workspace?.workspaceUiState?.canvasSidebarManualOrder || [];
  const positions = new Map(manual.map((id, index) => [id, index]));
  const ordered = [...nodes].sort((a, b) => {
    const aPosition = positions.get(a.id);
    const bPosition = positions.get(b.id);
    if (aPosition === undefined && bPosition === undefined) return 0;
    if (aPosition === undefined) return 1;
    if (bPosition === undefined) return -1;
    return aPosition - bPosition;
  });

  if (workspace?.workspaceUiState?.canvasSidebarSortMode !== 'project') return ordered;

  const tabs = new Map((workspace?.tabs || []).map((tab) => [tab.id, tab]));
  const buckets = new Map();
  for (const node of ordered) {
    const groupId = tabs.get(node.terminalTabId)?.groupId || '__unassigned__';
    if (!buckets.has(groupId)) buckets.set(groupId, []);
    buckets.get(groupId).push(node);
  }
  return [...buckets.values()].flat();
}

/** Match the same node and project-bucket order rendered by CanvasSidebar. */
export function orderPanesLikeCanvasSidebar(panes, workspace) {
  const tabs = new Map((workspace?.tabs || []).map((tab) => [tab.id, tab]));
  const paneById = new Map(panes.map((pane) => [pane.id, pane]));
  const ordered = [];
  for (const node of orderedCanvasNodes(workspace)) {
    const tab = tabs.get(node.terminalTabId);
    for (const terminal of tab?.terminals || []) {
      const pane = paneById.get(terminal.id);
      if (!pane) continue;
      ordered.push(pane);
      paneById.delete(terminal.id);
    }
  }
  // A daemon-owned pane can briefly precede its workspace node. Keep it visible
  // once, after every pane whose desktop-map position is already known.
  for (const pane of panes) if (paneById.has(pane.id)) {
    ordered.push(pane);
    paneById.delete(pane.id);
  }
  return ordered;
}

export function canvasSidebarView(workspace = readWorkspace()) {
  return workspace?.workspaceUiState?.canvasSidebarSortMode === 'manual' ? 'manual' : 'projects';
}

/**
 * Terminals the desktop has let go of. A handover (--dropoff) or a closed card
 * keeps its daemon session alive on purpose, so the daemon's list alone makes
 * every predecessor look like a live terminal. The workspace says which ones
 * the operator no longer has: ids in closedSessionIds or in a card's
 * earlierSessions, unless a card still owns that id right now.
 */
export function retiredTerminalIds(workspace) {
  const owned = new Set();
  const retired = new Set();
  for (const tab of workspace?.tabs || []) {
    for (const terminal of tab.terminals || []) if (terminal?.id) owned.add(terminal.id);
    for (const earlier of tab.earlierSessions || []) {
      for (const id of earlier?.ptyIds || []) retired.add(id);
    }
  }
  for (const id of workspace?.closedSessionIds || []) retired.add(id);
  for (const id of owned) retired.delete(id);
  return retired;
}

/** For each live card, the earlier sessions it took over from (handover lineage). */
function lineageByTerminal(workspace) {
  const byTerminal = new Map();
  for (const tab of workspace?.tabs || []) {
    const earlier = tab.earlierSessions || [];
    if (earlier.length === 0) continue;
    const lineage = {
      count: earlier.length,
      lastTitle: earlier[earlier.length - 1]?.title || null,
      lastEndedAt: Math.max(0, ...earlier.map((e) => Number(e?.endedAt) || 0)) || null,
    };
    for (const terminal of tab.terminals || []) if (terminal?.id) byTerminal.set(terminal.id, lineage);
  }
  return byTerminal;
}

/** An explicitly pinned operator Goal belongs to the exact owned pane, never cwd. */
export function attachOperatorGoal(pane, workspace) {
  const terminal=(workspace?.tabs || []).flatMap(tab=>tab.terminals || []).find(item=>item.id===pane.id);
  const goal=terminal?.mainUserAsk;
  return goal?.source==='manual' && typeof goal.text==='string' && goal.text.trim() && Number.isFinite(goal.updatedAt)
    ? {...pane,operatorGoal:{text:goal.text,source:'manual',updatedAt:goal.updatedAt}} : pane;
}

/**
 * Status hooks describe agent conversations, not terminal ownership. Merge the
 * daemon's complete live set back in so ordinary shells and newly created
 * terminals cannot disappear from the phone while remaining present on the
 * desktop. The workspace supplies the same project identity and ordering.
 */
export function reconcileLivePanes(panes, liveById, workspace = readWorkspace(), agents = agentsByPane()) {
  workspace = withLayoutTerminals(workspace);
  const everyone = liveById instanceof Map ? liveById : new Map();
  // Only terminals that are still running and that the desktop still owns. An
  // exited shell and a handed-over predecessor both linger in the daemon.
  const retired = retiredTerminalIds(workspace);
  // The desktop map is the source of truth: when the workspace is readable, a
  // terminal is listed only if a card on the map owns it. Daemon sessions with
  // no card (orphans, predecessors, strays) stay hidden so phone and desktop agree.
  const owned = new Set();
  for (const tab of workspace?.tabs || []) for (const t of tab.terminals || []) if (t?.id) owned.add(t.id);
  const mapKnown = owned.size > 0;
  const live = new Map([...everyone].filter(([id, life]) =>
    !life?.exited && !retired.has(id) && (!mapKnown || owned.has(id))));
  const lineage = lineageByTerminal(workspace);
  // The conversation a running agent holds open beats whatever a status record
  // last claimed for its terminal.
  const reconciled = dedupePanes(panes).filter((pane) => live.has(pane.id)).map((pane) => {
    const agent = agents.get(pane.id);
    const withStatus = agent?.vendorStatus && agent.provider === pane.provider ? { ...pane, vendorStatus: agent.vendorStatus } : pane;
    return agent?.sessionId && agent.provider === pane.provider && agent.sessionId !== pane.sessionId
      ? { ...withStatus, sessionId: agent.sessionId }
      : withStatus;
  });
  const known = new Set(reconciled.map((pane) => pane.id));
  const { byTerminal, byProjectName } = tabDecorations(workspace);
  const terminalRecords = new Map();

  for (const tab of workspace?.tabs || []) {
    for (const terminal of tab.terminals || []) {
      if (terminal?.id) terminalRecords.set(terminal.id, { tab, terminal });
    }
  }

  for (const [id, life] of live) {
    if (known.has(id)) continue;
    const record = terminalRecords.get(id) || {};
    const tab = record.tab || {};
    const terminal = record.terminal || {};
    const decoration = byTerminal.get(id) || {};
    const cwd = life?.initialCwd || terminal.initialCwd || tab.initialCwd || null;
    const project = cwd ? path.basename(cwd) : decoration.groupName || 'unknown';
    const matching = byProjectName.get(project);
    const agent = agents.get(id);
    const provider = agent?.provider || providerOf(terminal.agentProvider || tab.workstream?.provider) || 'shell';

    reconciled.push({
      id,
      emoji: decoration.emoji || matching?.emoji || iconFor(project),
      color: decoration.color || matching?.color || null,
      groupName: project,
      mapGroupId: decoration.groupId || null,
      mapGroupName: decoration.groupName || null,
      provider,
      sessionId: agent?.sessionId || null,
      ...(agent?.vendorStatus ? { vendorStatus: agent.vendorStatus } : {}),
      cwd,
      project,
      turn: 'idle',
      turnReason: null,
      task: null,
      updatedAt: 0,
      todos: [],
    });
    known.add(id);
  }

  return orderPanesLikeCanvasSidebar(reconciled, workspace).map((pane) => (
    attachOperatorGoal(lineage.has(pane.id) ? { ...pane, continues: lineage.get(pane.id) } : pane, workspace)
  ));
}

export function listPanes({ maxAgeMs = null, workspace = readWorkspace() } = {}) {
  const { byTerminal, byProjectName } = tabDecorations(workspace);
  const now = Date.now();
  const panes = [];
  for (const rec of readPaneRecords()) {
    const provider = providerOf(rec.source);
    if (!provider) continue;
    if (!rec.sessionId) continue;
    const updatedAt = rec.updatedAt || rec._mtime || 0;
    if (maxAgeMs != null && now - updatedAt > maxAgeMs) continue;

    const id = rec.paneId || rec._file.replace(/^pane-|\.json$/g, '');
    const tab = byTerminal.get(id) || {};

    // A terminal can be reused in a different folder than the lane it was
    // opened in, and then the lane's name is simply wrong. What the terminal
    // is actually working on wins; the lane only supplies the emoji, and only
    // when the two agree on the project.
    const folder = rec.cwd ? path.basename(rec.cwd) : null;
    const project = folder || tab.groupName || 'unknown';
    const matching = byProjectName.get(project);
    const look = {
      groupName: project,
      // The map group a card sits in decides its look, so a row never wears
      // another project's emoji inside this group's section.
      emoji: (tab.groupId ? tab.emoji : null) || matching?.emoji || iconFor(project),
      color: (tab.groupId ? tab.color : null) || matching?.color || null,
    };

    panes.push({
      id,
      emoji: look.emoji || null,
      color: look.color || null,
      groupName: look.groupName || null,
      mapGroupId: tab.groupId || null,
      mapGroupName: tab.groupName || null,
      provider,
      sessionId: rec.sessionId,
      cwd: rec.cwd || null,
      project,
      turn: turnOf(rec),
      turnReason: rec.turnReason || null,
      task: taskLine(rec),
      updatedAt,
      todos: (rec.todos || []).map((t) => ({
        content: t.content,
        activeForm: t.activeForm || null,
        status: t.status,
      })),
    });
  }

  return orderPanesLikeCanvasSidebar(dedupePanes(panes), workspace).map(pane=>attachOperatorGoal(pane,workspace));
}

/** One daemon pane id is one terminal, even when old sidecar filenames remain. */
export function dedupePanes(panes) {
  const freshest = new Map();
  for (const pane of panes) {
    const previous = freshest.get(pane.id);
    if (!previous || Number(pane.updatedAt || 0) >= Number(previous.updatedAt || 0)) {
      freshest.set(pane.id, pane);
    }
  }
  return [...freshest.values()];
}
