#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectAgents, collectSessions, collectTermfleetStatus, loadWorkspace, defaultDataRoot } from "./termfleetctl.mjs";

const DEFAULT_COMMANDS = [
  "npm run build",
  "npm run verify:map-terminals",
  "npm run verify:standalone-daemon",
];

function redactString(value) {
  return value
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g, "<redacted-token>")
    .replace(/\b(Bearer|token|api[_-]?key|secret)\s*[:=]\s*["']?[^"'\s]+/gi, "$1=<redacted>")
    .replace(/(?:\/home|\/Users|\/media|\/mnt|\/tmp)\/[^\s)]+/g, (match) => {
      const parts = match.split("/").filter(Boolean);
      const suffix = parts[0] === "tmp" ? parts.slice(-1) : parts.slice(-2);
      return `<path:.../${suffix.join("/")}>`;
    });
}

function redactValue(value) {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]));
  }
  return value;
}

function normalizeUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?/i.test(value)) return value;
  return redactString(value);
}

function collectPreviewUrls(workspace) {
  const urls = new Set();
  for (const tab of Array.isArray(workspace?.tabs) ? workspace.tabs : []) {
    for (const terminal of Array.isArray(tab.terminals) ? tab.terminals : []) {
      const url = normalizeUrl(terminal.previewUrl);
      if (url) urls.add(url);
    }
    const visitSplit = (node) => {
      if (!node || typeof node !== "object") return;
      const url = normalizeUrl(node.previewUrl);
      if (url) urls.add(url);
      for (const child of Array.isArray(node.children) ? node.children : []) visitSplit(child);
    };
    visitSplit(tab.splitLayout);
  }
  for (const node of Array.isArray(workspace?.canvasState?.nodes) ? workspace.canvasState.nodes : []) {
    const url = normalizeUrl(node.previewUrl);
    if (url) urls.add(url);
  }
  return [...urls].sort();
}

function collectTaskBindings(workspace) {
  return (workspace?.canvasState?.nodes ?? [])
    .filter((node) => node?.taskBinding?.taskId)
    .map((node) => ({
      node: node.title ?? node.id,
      taskId: node.taskBinding.taskId,
      planPath: node.taskBinding.planPath ? redactString(node.taskBinding.planPath) : null,
    }));
}

function renderList(items, render) {
  if (items.length === 0) return "- None\n";
  return items.map(render).join("");
}

function renderMarkdown(bundle) {
  const lines = [
    "# TermFleet Evidence Bundle",
    "",
    `Generated: ${bundle.generatedAt}`,
    "",
    "## Workspace",
    "",
    `- Data root: ${bundle.dataRoot}`,
    `- Daemon: ${bundle.status.daemon.reachable ? "reachable" : "unreachable"} (${bundle.status.daemon.mode})`,
    `- Sessions: ${bundle.status.counts.sessions} total, ${bundle.status.counts.liveSessions} live, ${bundle.status.counts.persistedSessions} persisted`,
    `- Agents: ${bundle.status.counts.agents}`,
    "",
    "## Verification Commands",
    "",
    ...bundle.verificationCommands.map((command) => `- \`${command}\``),
    "",
    "## Preview URLs",
    "",
    renderList(bundle.previewUrls, (url) => `- ${url}\n`).trimEnd(),
    "",
    "## Task Bindings",
    "",
    renderList(bundle.taskBindings, (binding) => `- ${binding.taskId}: ${binding.node}${binding.planPath ? ` (${binding.planPath})` : ""}\n`).trimEnd(),
    "",
    "## Sessions",
    "",
    renderList(bundle.sessions.sessions, (session) =>
      `- ${session.id}: ${session.sources.join("+")}${session.cwd ? `, cwd ${session.cwd}` : ""}${session.command ? `, command ${session.command}` : ""}\n`
    ).trimEnd(),
    "",
    "## Agents",
    "",
    renderList(bundle.agents.agents, (agent) =>
      `- ${agent.mission}: ${agent.provider ?? "agent"} ${agent.status ?? "unknown"}/${agent.phase ?? "unknown"}${agent.currentActivity ? `, now ${agent.currentActivity}` : ""}${agent.evidence ? `, evidence ${agent.evidence}` : ""}${agent.proof ? `, proof ${agent.proof}` : ""}\n`
    ).trimEnd(),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

export async function createEvidenceBundle(options = {}) {
  const env = options.env ?? process.env;
  const dataRoot = options.dataRoot ?? defaultDataRoot(env);
  const workspaceInfo = loadWorkspace(dataRoot);
  const status = await collectTermfleetStatus({ env, dataRoot });
  const sessions = await collectSessions({ env, dataRoot });
  const agents = await collectAgents({ env, dataRoot });
  const bundle = {
    generatedAt: status.generatedAt,
    dataRoot,
    status,
    sessions,
    agents,
    previewUrls: collectPreviewUrls(workspaceInfo.workspace),
    taskBindings: collectTaskBindings(workspaceInfo.workspace),
    verificationCommands: options.commands?.length ? options.commands : DEFAULT_COMMANDS,
  };
  return redactValue(bundle);
}

function parseArgs(argv) {
  const options = { commands: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      options.out = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--command") {
      options.commands.push(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const bundle = await createEvidenceBundle({ env, commands: options.commands });
  const output = options.json ? `${JSON.stringify(bundle, null, 2)}\n` : renderMarkdown(bundle);
  if (options.out) {
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, output);
  } else {
    process.stdout.write(output);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
