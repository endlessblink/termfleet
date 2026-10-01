#!/usr/bin/env node
// FEATURE-64: start another agent instance as a real, visible TermFleet terminal.
// Works from inside a TermFleet pane (becomes a child of that pane) and from
// anywhere else (becomes a top-level instance). Never use tmux/Konsole for this.
//
//   termfleet-child spawn --provider claude --task "Write tests for the export dialog"
//   termfleet-child spawn --provider claude --task-file prompt.md --cwd DIR
//   termfleet-child spawn --provider claude --dropoff HANDOFF.md [--cwd DIR]
//   termfleet-child status      (is the app running and listening?)
//
// The request is dropped into the app's child-requests folder; the app opens the
// terminal and writes a result that this command prints as JSON (pane id etc).
import { spawn as launch, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const VERSION = "2.0.0";
const PROVIDERS = ["claude", "codex", "opencode", "shell"];
const LISTENER_FRESH_MS = 8_000;
const INLINE_TASK_LIMIT = 1_500;
const USAGE = `termfleet-child ${VERSION} - start an agent instance as a visible TermFleet terminal

usage:
  termfleet-child spawn --provider <${PROVIDERS.join("|")}> (--task "<text>" | --task-file FILE | --dropoff FILE)
                        [--title "<card title>"] [--near PROJECT_DIR] [--separate | --replace] [--cwd DIR] [--timeout SECONDS] [--no-start-app]
  termfleet-child status
  termfleet-child --help | --version

Inside a TermFleet pane the new terminal is linked as that pane's child. Elsewhere it
is a top-level instance. Long prompts: use --task-file (not argv). Handoff: --dropoff.`;

function fail(message, code = 1) {
  process.stderr.write(`termfleet-child: ${message}\n`);
  process.exit(code);
}

const BOOLEAN_FLAGS = new Set(["no-start-app", "separate", "replace"]);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith("--")) fail(`unexpected argument "${key}"\n${USAGE}`);
    if (BOOLEAN_FLAGS.has(key.slice(2))) {
      options[key.slice(2)] = true;
      continue;
    }
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${key} needs a value\n${USAGE}`);
    options[key.slice(2)] = value;
    i += 1;
  }
  return { command, options };
}

function dataRoot(env = process.env) {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "terminal-workspace");
}

export function childRequestsDir(env = process.env) {
  return join(dataRoot(env), "child-requests");
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function listenerAgeMs(dir) {
  try {
    return Date.now() - Number(readFileSync(join(dir, ".listener"), "utf8"));
  } catch {
    return Infinity;
  }
}

/** True when a TermFleet desktop window process (not this CLI, not the daemon) runs. */
function appProcessRunning() {
  const ps = spawnSync("ps", ["-eo", "args"], { encoding: "utf8" });
  return (ps.stdout ?? "")
    .split("\n")
    .some((line) => /\/termfleet( |$)/.test(line) && !/--terminal-workspace-daemon|termfleet-child/.test(line));
}

function startApp() {
  const launcher = join(homedir(), ".local", "bin", "termfleet-desktop");
  if (!existsSync(launcher)) return false;
  // The approved launcher: keeps the shared daemon, so no terminal is killed.
  const child = launch(launcher, ["--child"], { detached: true, stdio: "ignore" });
  child.unref();
  return true;
}

async function waitForListener(dir, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    if (listenerAgeMs(dir) < LISTENER_FRESH_MS) return true;
    await sleep(500);
  }
  return false;
}

/** Make sure the app is listening, or exit at once saying exactly why not. */
async function ensureListener(dir, allowStart) {
  if (listenerAgeMs(dir) < LISTENER_FRESH_MS) return;
  if (!appProcessRunning()) {
    if (!allowStart) fail("TermFleet is not running (and --no-start-app was given)", 3);
    if (!startApp()) fail("TermFleet is not running and its launcher (~/.local/bin/termfleet-desktop) was not found", 3);
    process.stderr.write("termfleet-child: TermFleet was not running; started it with the approved launcher...\n");
    if (await waitForListener(dir, 45)) return;
    fail("started TermFleet but its agent-request listener did not come up within 45s (open its window; board may still be loading)", 3);
  }
  // Running but silent: give one poll cycle, then explain instead of hanging.
  if (await waitForListener(dir, 4)) return;
  fail(
    "TermFleet is running but is not listening for agent requests. Either this installed build is older than agent-spawn support " +
      "(it needs a rebuilt release and an app relaunch), or the workspace is still loading, or the feature was switched off " +
      '(localStorage "termfleet.experimental.helperTerminals" = "0").',
    3,
  );
}

function resolveTask(options) {
  const given = ["task", "task-file", "dropoff"].filter((key) => options[key] !== undefined);
  if (given.length !== 1) fail(`give exactly one of --task, --task-file, --dropoff\n${USAGE}`);
  const root = dataRoot();
  const stash = (text, label) => {
    // Long text never rides on a command line: the child reads it from a private file.
    const dir = join(root, "child-tasks");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `${randomUUID()}.md`);
    writeFileSync(file, text, { mode: 0o600 });
    return { task: `Read ${file} and carry out the instructions in it.`, title: label };
  };
  if (options.dropoff !== undefined) {
    const file = resolve(options.dropoff);
    if (!existsSync(file) || !statSync(file).isFile()) fail(`--dropoff file not found: ${file}`);
    return {
      task: `Read ${file}. It is a handoff from the previous instance: continue exactly where it left off, and start by confirming what you understood.`,
      title: `Continue from ${basename(file)}`,
    };
  }
  if (options["task-file"] !== undefined) {
    const file = resolve(options["task-file"]);
    if (!existsSync(file) || !statSync(file).isFile()) fail(`--task-file not found: ${file}`);
    const text = readFileSync(file, "utf8").trim();
    if (!text) fail("--task-file is empty");
    return stash(text, options.title ?? text.split("\n")[0].slice(0, 80));
  }
  const text = options.task.trim();
  if (!text) fail("--task is empty");
  return text.length > INLINE_TASK_LIMIT
    ? stash(text, options.title ?? text.slice(0, 80))
    : { task: text, title: options.title };
}

async function spawnCommand(options) {
  const parentPaneId = process.env.TERMFLEET_PANE_ID?.trim() || undefined;
  const provider = options.provider;
  if (!PROVIDERS.includes(provider)) fail(`--provider must be one of ${PROVIDERS.join(", ")}\n${USAGE}`);
  const { task, title } = resolveTask(options);
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutSeconds = Number(options.timeout ?? 20);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) fail("--timeout must be a positive number of seconds");

  const dir = childRequestsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await ensureListener(dir, !options["no-start-app"]);

  const requestId = randomUUID();
  const requestPath = join(dir, `${requestId}.request.json`);
  const resultPath = join(dir, `${requestId}.result.json`);
  // A handover (--dropoff) takes over the calling terminal's card; --separate opts out,
  // --replace asks for the same with a plain task.
  const replace = parentPaneId && !options.separate && (options.replace === true || options.dropoff !== undefined) ? true : undefined;
  const near = options.near ? resolve(options.near) : undefined;
  const request = { version: 1, requestId, parentPaneId, provider, task, title, near, replace, cwd, createdAt: Date.now() };
  // Write then rename, so the app never reads a half-written request.
  writeFileSync(`${requestPath}.tmp`, JSON.stringify(request), { mode: 0o600 });
  renameSync(`${requestPath}.tmp`, requestPath);

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      const text = readFileSync(resultPath, "utf8");
      rmSync(resultPath, { force: true });
      process.stdout.write(`${text}\n`);
      let ok = false;
      try {
        ok = JSON.parse(text).ok === true;
      } catch {
        ok = false;
      }
      process.exit(ok ? 0 : 1);
    }
    await sleep(250);
  }
  // Nobody picked it up: withdraw it so it cannot open a terminal later by surprise.
  const withdrawn = existsSync(requestPath);
  rmSync(requestPath, { force: true });
  fail(
    withdrawn
      ? "the app was listening but did not take the request in time; the request was withdrawn"
      : "TermFleet took the request but did not report back in time; check the map for the new terminal",
    2,
  );
}

function statusCommand() {
  const dir = childRequestsDir();
  const age = listenerAgeMs(dir);
  const running = appProcessRunning();
  const listening = age < LISTENER_FRESH_MS;
  process.stdout.write(
    `${JSON.stringify({ appRunning: running, listening, listenerAgeMs: Number.isFinite(age) ? age : null, insidePane: Boolean(process.env.TERMFLEET_PANE_ID) })}\n`,
  );
  process.exit(listening ? 0 : 3);
}

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h" || argv[0] === "help") {
  process.stdout.write(`${USAGE}\n`);
  process.exit(0);
}
if (argv[0] === "--version" || argv[0] === "-v") {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
const { command, options } = parseArgs(argv);
if (command === "spawn") await spawnCommand(options);
else if (command === "status") statusCommand();
else fail(`unknown command "${command}"\n${USAGE}`);
