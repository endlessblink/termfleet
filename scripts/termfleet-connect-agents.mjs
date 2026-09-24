#!/usr/bin/env node
// Connect Claude Code, Codex, and OpenCode to TermFleet so their panes report a
// real Task line and a true Running / Waiting / Idle badge.
//
// The status hooks ship inside the app, but an AppImage is mounted at a new
// temporary path on every launch, so they are first copied to a stable user
// directory and registered from there. Settings files are backed up before any
// edit, and a hook that is already registered and points at a file that exists
// is left alone (a source checkout keeps pointing at its own scripts).
//
// Usage: node termfleet-connect-agents.mjs [--check] [--json] [--force]
//   --check  report only, change nothing
//   --force  re-point existing TermFleet registrations at the stable copy
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const force = args.has("--force");
const asJson = args.has("--json");

const HOME = homedir();
const dataHome = process.env.XDG_DATA_HOME || path.join(HOME, ".local", "share");
const configHome = process.env.XDG_CONFIG_HOME || path.join(HOME, ".config");
const hookHome = path.join(dataHome, "termfleet", "agent-hooks");

const HOOK_FILES = [
  "termfleet-claude-status-hook.mjs",
  "termfleet-codex-status-hook.mjs",
  "termfleet-opencode-status-plugin.js",
  "lib/agent-status-paths.mjs",
  "lib/agent-status-lifecycle.mjs",
  "lib/agent-status-goal.mjs",
];

const CLAUDE_EVENTS = ["Stop", "Notification", "PermissionRequest", "UserPromptSubmit", "PostToolUse"];
const CODEX_EVENTS = ["Stop", "Notification", "UserPromptSubmit", "PreToolUse", "PostToolUse"];

const results = [];
const note = (agent, state, detail) => results.push({ agent, state, detail });

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, "utf8"));
}

function backup(file) {
  if (!existsSync(file)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  copyFileSync(file, `${file}.termfleet-backup-${stamp}`);
}

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  backup(file);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function installHookCopies() {
  for (const rel of HOOK_FILES) {
    const from = path.join(here, rel);
    if (!existsSync(from)) throw new Error(`bundled hook file missing: ${from}`);
    const to = path.join(hookHome, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
}

// The script path inside an existing TermFleet registration, if any.
function registeredScript(command, scriptName) {
  const match = String(command ?? "").match(new RegExp(`node\\s+"?([^"\\s]*${scriptName.replace(/\./g, "\\.")})"?`));
  return match?.[1];
}

// Ensure each event carries exactly one TermFleet command hook for `scriptName`.
function connectHookEvents(hooks, events, scriptName, makeHook) {
  let changed = false;
  const stable = path.join(hookHome, scriptName);
  for (const event of events) {
    const groups = Array.isArray(hooks[event]) ? hooks[event] : [];
    const existing = groups
      .flatMap((group) => (Array.isArray(group.hooks) ? group.hooks : [group]))
      .map((hook) => registeredScript(hook.command, scriptName))
      .filter(Boolean);
    const working = existing.find((script) => existsSync(script));
    if (working && !force) continue;
    // Drop stale or to-be-repointed TermFleet entries for this script only.
    const kept = groups
      .map((group) =>
        Array.isArray(group.hooks)
          ? { ...group, hooks: group.hooks.filter((hook) => !registeredScript(hook.command, scriptName)) }
          : group,
      )
      .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0)
      .filter((group) => Array.isArray(group.hooks) || !registeredScript(group.command, scriptName));
    kept.push({ matcher: "", hooks: [makeHook(stable)] });
    hooks[event] = kept;
    changed = true;
  }
  return changed;
}

function connectClaude() {
  const claudeDir = path.join(HOME, ".claude");
  if (!existsSync(claudeDir)) return note("claude", "absent", "Claude Code is not set up for this user");
  const file = path.join(claudeDir, "settings.json");
  const settings = readJson(file, {});
  settings.hooks ??= {};
  const probe = structuredClone(settings.hooks);
  const needsChange = connectHookEvents(probe, CLAUDE_EVENTS, "termfleet-claude-status-hook.mjs", () => ({}));
  if (!needsChange) return note("claude", "connected", "status hook registered for every turn event");
  if (checkOnly) return note("claude", "not-connected", "status hook missing on one or more turn events");
  connectHookEvents(settings.hooks, CLAUDE_EVENTS, "termfleet-claude-status-hook.mjs", (script) => ({
    type: "command",
    command: `node "${script}"`,
    timeout: 5,
  }));
  writeJson(file, settings);
  note("claude", "connected", "registered; takes effect for newly started Claude Code sessions");
}

function ensureCodexHooksFeature(configFile) {
  const text = existsSync(configFile) ? readFileSync(configFile, "utf8") : "";
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "[features]");
  if (start >= 0) {
    let end = lines.findIndex((line, index) => index > start && /^\s*\[/.test(line));
    if (end < 0) end = lines.length;
    const flag = lines.slice(start + 1, end).findIndex((line) => /^\s*hooks\s*=/.test(line));
    if (flag >= 0) {
      return /=\s*true\b/.test(lines[start + 1 + flag]) ? "on" : "disabled-by-user";
    }
    if (checkOnly) return "off";
    lines.splice(start + 1, 0, "hooks = true");
  } else {
    if (checkOnly) return "off";
    lines.push("", "[features]", "hooks = true");
  }
  backup(configFile);
  writeFileSync(configFile, lines.join("\n"));
  return "enabled";
}

function connectCodex() {
  const codexDir = path.join(HOME, ".codex");
  if (!existsSync(codexDir)) return note("codex", "absent", "Codex is not set up for this user");
  const file = path.join(codexDir, "hooks.json");
  const doc = readJson(file, {});
  doc.hooks ??= {};
  const probe = structuredClone(doc.hooks);
  const needsChange = connectHookEvents(probe, CODEX_EVENTS, "termfleet-codex-status-hook.mjs", () => ({}));
  const feature = ensureCodexHooksFeature(path.join(codexDir, "config.toml"));
  if (feature === "disabled-by-user") {
    return note("codex", "blocked", "hooks are turned off in ~/.codex/config.toml ([features] hooks = false); left unchanged");
  }
  if (!needsChange && (feature === "on" || feature === "enabled")) {
    return note("codex", "connected", "status hook registered for every turn event");
  }
  if (checkOnly) return note("codex", "not-connected", "status hook or hooks feature missing");
  connectHookEvents(doc.hooks, CODEX_EVENTS, "termfleet-codex-status-hook.mjs", (script) => ({
    type: "command",
    command: `node "${script}"`,
    statusMessage: "termfleet status sidecar",
  }));
  writeJson(file, doc);
  note("codex", "connected", "registered; Codex asks you to trust the new hook the next time it starts");
}

function connectOpenCode() {
  const configDir = process.env.OPENCODE_CONFIG_DIR ?? path.join(configHome, "opencode");
  if (!existsSync(configDir)) return note("opencode", "absent", "OpenCode is not set up for this user");
  const target = path.join(configDir, "plugin", "termfleet-status.js");
  if (existsSync(target) && !force) return note("opencode", "connected", "status plugin installed");
  if (checkOnly) return note("opencode", "not-connected", "status plugin missing");
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(path.join(hookHome, "termfleet-opencode-status-plugin.js"), target);
  note("opencode", "connected", "plugin installed; takes effect for newly started OpenCode sessions");
}

try {
  if (!checkOnly) installHookCopies();
  connectClaude();
  connectCodex();
  connectOpenCode();
} catch (error) {
  note("termfleet", "error", String(error?.message ?? error));
}

const connected = results.filter((item) => item.state === "connected").length;
const needed = results.filter((item) => item.state === "not-connected" || item.state === "blocked" || item.state === "error").length;
const summary = { ok: needed === 0, connected, needed, hookHome, results };
if (asJson) {
  console.log(JSON.stringify(summary));
} else {
  for (const item of results) console.log(`${item.state.padEnd(14)} ${item.agent.padEnd(9)} ${item.detail}`);
}
process.exitCode = results.some((item) => item.state === "error") ? 1 : 0;
