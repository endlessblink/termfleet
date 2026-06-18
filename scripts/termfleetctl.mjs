#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA_VERSION = 1;
const SOCKET_TIMEOUT_MS = 350;

export function defaultDataRoot(env = process.env) {
  if (env.TERMFLEET_DATA_DIR) return env.TERMFLEET_DATA_DIR;
  const xdgDataHome = env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(xdgDataHome, "terminal-workspace");
}

export function defaultDaemonSocket(env = process.env) {
  if (env.TERMFLEET_DAEMON_SOCKET) return env.TERMFLEET_DAEMON_SOCKET;
  const runtimeDir = env.XDG_RUNTIME_DIR || os.tmpdir();
  return path.join(runtimeDir, "terminal-workspace", "daemon.sock");
}

function responseBase() {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

function decodeHexId(stem) {
  if (stem.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(stem)) return null;
  const bytes = [];
  for (let index = 0; index < stem.length; index += 2) {
    bytes.push(Number.parseInt(stem.slice(index, index + 2), 16));
  }
  return Buffer.from(bytes).toString("utf8");
}

function encodeHexId(id) {
  return Buffer.from(id, "utf8").toString("hex");
}

function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

export function loadWorkspace(dataRoot = defaultDataRoot()) {
  const workspacePath = path.join(dataRoot, "workspace.json");
  const workspace = readJsonFile(workspacePath);
  return {
    path: workspacePath,
    loaded: Boolean(workspace && typeof workspace === "object"),
    workspace: workspace && typeof workspace === "object" ? workspace : {},
  };
}

export function listPersistedSessions(dataRoot = defaultDataRoot()) {
  const sessionsDir = path.join(dataRoot, "sessions");
  let entries = [];
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".scrollback"))
    .map((entry) => {
      const stem = entry.name.slice(0, -".scrollback".length);
      const id = decodeHexId(stem);
      if (!id) return null;
      const scrollbackPath = path.join(sessionsDir, entry.name);
      const meta = readJsonFile(path.join(sessionsDir, `${encodeHexId(id)}.meta.json`), {});
      const stat = fs.statSync(scrollbackPath);
      return {
        id,
        source: "persisted",
        cwd: typeof meta.cwd === "string" ? meta.cwd : null,
        command: typeof meta.command === "string" ? meta.command : null,
        scrollbackBytes: Math.max(0, stat.size - 8),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function requestDaemon(request, socketPath = defaultDaemonSocket()) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let settled = false;
    let response = "";

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);
    socket.on("connect", () => {
      socket.end(JSON.stringify(request));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("end", () => {
      try {
        finish({ ok: true, value: JSON.parse(response) });
      } catch (error) {
        finish({ ok: false, error: `daemon response was not JSON: ${error.message}` });
      }
    });
    socket.on("timeout", () => finish({ ok: false, error: "daemon request timed out" }));
    socket.on("error", (error) => finish({ ok: false, error: error.message }));
  });
}

export async function daemonStatus(socketPath = defaultDaemonSocket()) {
  const response = await requestDaemon({ type: "status" }, socketPath);
  if (!response.ok) {
    return {
      socketPath,
      reachable: false,
      mode: "unreachable",
      protocolVersion: null,
      pid: null,
      buildId: null,
      message: response.error,
    };
  }
  return response.value;
}

async function liveDaemonSessions(socketPath) {
  const response = await requestDaemon({ type: "listSessions" }, socketPath);
  if (!response.ok || response.value?.type !== "listSessions") return [];
  return (response.value.sessions ?? []).map((session) => ({
    ...session,
    source: "live",
    cwd: session.initialCwd ?? null,
    scrollbackBytes: session.scrollbackBytes ?? 0,
  }));
}

function mergeSessionRows(liveSessions, persistedSessions) {
  const rows = new Map();
  for (const session of persistedSessions) {
    rows.set(session.id, { ...session, sources: ["persisted"] });
  }
  for (const session of liveSessions) {
    const existing = rows.get(session.id);
    rows.set(session.id, {
      ...existing,
      ...session,
      persisted: existing ?? null,
      sources: existing ? ["live", "persisted"] : ["live"],
    });
  }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function listAgents(workspace) {
  const tabs = Array.isArray(workspace?.tabs) ? workspace.tabs : [];
  return tabs
    .filter((tab) => tab?.workstream?.kind === "agent")
    .map((tab) => {
      const workstream = tab.workstream;
      return {
        tabId: tab.id,
        title: tab.title,
        runId: workstream.runId ?? null,
        provider: workstream.provider ?? null,
        role: workstream.role ?? null,
        mission: workstream.mission ?? workstream.prompt ?? tab.title,
        cwd: workstream.cwd ?? tab.initialCwd ?? null,
        cwdLabel: workstream.cwdLabel ?? null,
        gitRoot: workstream.gitRoot ?? null,
        gitBranch: workstream.gitBranch ?? null,
        gitDirty: workstream.gitDirty ?? null,
        worktreePath: workstream.worktreePath ?? null,
        isolationMode: workstream.isolationMode ?? null,
        isolationStatus: workstream.isolationStatus ?? null,
        worktreeCleanupStatus: workstream.worktreeCleanupStatus ?? null,
        status: workstream.status ?? null,
        phase: workstream.phase ?? null,
        currentActivity: workstream.currentActivity ?? null,
        activityKind: workstream.activityKind ?? null,
        lastSummary: workstream.lastSummary ?? null,
        nextAction: workstream.nextAction ?? null,
        evidence: workstream.evidence ?? null,
        proof: workstream.statusSummary?.proof ?? null,
        blocker: workstream.statusSummary?.blocker ?? null,
        memory: workstream.memory ?? null,
        confidence: workstream.confidence ?? workstream.statusSummary?.confidence ?? null,
        risk: workstream.risk ?? null,
        promptCount: workstream.promptCount ?? 0,
        sentCount: workstream.sentCount ?? 0,
        signalCount: workstream.signalCount ?? 0,
        controlCount: workstream.controlCount ?? 0,
        createdAt: workstream.createdAt ?? null,
        completedAt: workstream.completedAt ?? null,
        reviewedAt: workstream.reviewedAt ?? null,
        lastActivityAt: workstream.lastActivityAt ?? workstream.activityUpdatedAt ?? null,
        terminalIds: Array.isArray(tab.terminals) ? tab.terminals.map((terminal) => terminal.id) : [],
      };
    })
    .sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")));
}

export async function collectTermfleetStatus(options = {}) {
  const dataRoot = options.dataRoot ?? defaultDataRoot(options.env);
  const socketPath = options.socketPath ?? defaultDaemonSocket(options.env);
  const workspaceInfo = loadWorkspace(dataRoot);
  const persistedSessions = listPersistedSessions(dataRoot);
  const daemon = await daemonStatus(socketPath);
  const liveSessions = daemon.reachable ? await liveDaemonSessions(socketPath) : [];
  const agents = listAgents(workspaceInfo.workspace);
  return {
    ...responseBase(),
    dataRoot,
    daemon: {
      socketPath,
      reachable: Boolean(daemon.reachable),
      mode: daemon.mode ?? "unknown",
      protocolVersion: daemon.protocolVersion ?? null,
      pid: daemon.pid ?? null,
      buildId: daemon.buildId ?? null,
      message: daemon.message ?? "",
    },
    workspace: {
      path: workspaceInfo.path,
      loaded: workspaceInfo.loaded,
      activeTabId: workspaceInfo.workspace.activeTabId ?? null,
      projectRoot: workspaceInfo.workspace.projectRoot ?? null,
    },
    counts: {
      liveSessions: liveSessions.length,
      persistedSessions: persistedSessions.length,
      sessions: mergeSessionRows(liveSessions, persistedSessions).length,
      agents: agents.length,
    },
  };
}

export async function collectSessions(options = {}) {
  const dataRoot = options.dataRoot ?? defaultDataRoot(options.env);
  const socketPath = options.socketPath ?? defaultDaemonSocket(options.env);
  const daemon = await daemonStatus(socketPath);
  const liveSessions = daemon.reachable ? await liveDaemonSessions(socketPath) : [];
  const persistedSessions = listPersistedSessions(dataRoot);
  return {
    ...responseBase(),
    sessions: mergeSessionRows(liveSessions, persistedSessions),
  };
}

export async function collectAgents(options = {}) {
  const dataRoot = options.dataRoot ?? defaultDataRoot(options.env);
  const workspaceInfo = loadWorkspace(dataRoot);
  return {
    ...responseBase(),
    workspace: {
      path: workspaceInfo.path,
      loaded: workspaceInfo.loaded,
    },
    agents: listAgents(workspaceInfo.workspace),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  process.stderr.write(`Usage:
  node scripts/termfleetctl.mjs status --json
  node scripts/termfleetctl.mjs sessions list --json
  node scripts/termfleetctl.mjs agents list --json

Environment:
  TERMFLEET_DATA_DIR       Override durable workspace/session data root
  TERMFLEET_DAEMON_SOCKET  Override daemon Unix socket path
`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const wantsJson = argv.includes("--json");
  const args = argv.filter((arg) => arg !== "--json");
  if (!wantsJson) {
    usage();
    return 2;
  }

  const options = { env };
  if (args[0] === "status" && args.length === 1) {
    printJson(await collectTermfleetStatus(options));
    return 0;
  }
  if (args[0] === "sessions" && args[1] === "list" && args.length === 2) {
    printJson(await collectSessions(options));
    return 0;
  }
  if (args[0] === "agents" && args[1] === "list" && args.length === 2) {
    printJson(await collectAgents(options));
    return 0;
  }

  usage();
  return 2;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const exitCode = await main();
  process.exit(exitCode);
}
