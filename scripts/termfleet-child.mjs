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
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { paneSidecarPath, statusDir } from "./lib/agent-status-paths.mjs";
import { ancestors, argv as procArgv, isProviderProcess } from "./lib/single-chat-owner.mjs";
import { resolveCodexPaneId } from "./lib/codex-pane-owner.mjs";

const VERSION = "2.0.0";
const PROVIDERS = ["claude", "codex", "opencode", "shell"];
const LISTENER_FRESH_MS = 8_000;
const INLINE_TASK_LIMIT = 1_500;
const USAGE = `termfleet-child ${VERSION} - start an agent instance as a visible TermFleet terminal

usage:
  termfleet-child spawn --provider <${PROVIDERS.join("|")}> (--task "<text>" | --task-file FILE | --dropoff FILE)
                        [--title "<card title>"] [--near PROJECT_DIR] [--separate | --replace] [--allow-thin] [--cwd DIR] [--timeout SECONDS] [--no-start-app]
  termfleet-child status
  termfleet-child --help | --version

Inside a TermFleet pane the new terminal is linked as that pane's child. Elsewhere it
is a top-level instance. Long prompts: use --task-file (not argv).
HELPER (you keep running, a new card is added): --task / --task-file.
HANDOVER (your own card is replaced by a fresh instance): --dropoff <your HANDOFF.md>.
A handover always continues in the same agent you are (Codex stays Codex, Claude stays Claude).`;

function fail(message, code = 1) {
  process.stderr.write(`termfleet-child: ${message}\n`);
  process.exit(code);
}

const BOOLEAN_FLAGS = new Set(["no-start-app", "separate", "replace", "allow-thin"]);

const THIN_HANDOFF_CHARS = 1500;
/** A file missing more than this many expected parts is a briefing, not a handoff. */
const HANDOVER_MAX_GAPS = 3;
/** What a successor needs to not lose context; a missing one is warned about, not fatal. */
const HANDOFF_PARTS = [
  ["original request", /request|asked|said|words/i],
  ["done / evidence", /done|evidence|verified|result/i],
  ["files touched", /files?|uncommitted|commit/i],
  ["decisions / rejected approaches", /decision|rejected|decided|why/i],
  ["next steps", /next step|open|todo|remaining/i],
  ["first command", /first command|start with|run first/i],
];

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
    // A thin handoff is how successors lose context (TF-069 request 5): refuse an
    // obviously empty one, and say which expected parts are missing from the rest.
    const text = readFileSync(file, "utf8");
    const gaps = HANDOFF_PARTS.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name);
    if (text.trim().length < THIN_HANDOFF_CHARS && options["allow-thin"] !== true) {
      fail(
        `--dropoff ${file} is only ${text.trim().length} characters; a successor starts with nothing but this file. ` +
          `Write the full handoff (original request in the user's words, corrections, done + evidence, files touched, ` +
          `decisions, rejected approaches, open problems, next steps, first command) or pass --allow-thin.`,
        2,
      );
    }
    if (gaps.length > 0) {
      process.stderr.write(`termfleet-child: warning: handoff has no section for: ${gaps.join(", ")}\n`);
    }
    // Only a real handoff of THIS instance replaces its card. A briefing for a helper
    // that merely arrived through --dropoff must never end the instance that asked.
    const handover = gaps.length <= HANDOVER_MAX_GAPS;
    if (!handover) {
      process.stderr.write(
        "termfleet-child: this file does not read like a handoff of your own work, so it starts a HELPER and your own card stays. " +
          "For a helper use --task-file; use --dropoff only to hand your own work to a fresh instance.\n",
      );
    }
    return {
      task: handover
        ? `Read ${file}. It is a handoff from the previous instance: continue exactly where it left off, and start by confirming what you understood.`
        : `Read ${file} and carry out the instructions in it.`,
      title: handover ? `Continue from ${basename(file)}` : `Helper: ${basename(file)}`,
      handover,
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

/** Which agent is running in a TermFleet pane (from its status record), or undefined. */
export function callerProvider(paneId) {
  try {
    const record = JSON.parse(readFileSync(paneSidecarPath(paneId), "utf8"));
    return ["claude", "codex", "opencode"].includes(record?.provider) ? record.provider : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Who is calling: which agent, and which TermFleet card it runs in.
 *
 * A Claude command inherits TERMFLEET_PANE_ID from its terminal. Codex runs commands from
 * ONE shared background service (`codex app-server`), so a Codex command has no card id
 * (or a stale one from whichever terminal started the service). It does carry the chat's
 * own id (CODEX_THREAD_ID) and has a Codex process above it; the card is then looked up
 * from the chat-to-card record the Codex status hook keeps. Getting this wrong made a
 * Codex handover continue in Claude.
 */
export function resolveCaller(env = process.env, procRoot = "/proc", selfPid = process.pid) {
  const envPane = env.TERMFLEET_PANE_ID?.trim() || "";
  const threadId = (env.CODEX_THREAD_ID ?? env.CODEX_SESSION_ID ?? "").trim();
  const underCodex = [...ancestors(procRoot, selfPid)].some((pid) => isProviderProcess("codex", procArgv(procRoot, pid)));
  if (threadId || underCodex) {
    let pane = "";
    try {
      const bindings = JSON.parse(readFileSync(join(statusDir(), "codex-chat-panes.json"), "utf8"));
      pane = threadId ? String(bindings?.[threadId]?.paneId ?? "") : "";
    } catch {
      /* no record yet */
    }
    if (!pane) {
      try {
        pane = resolveCodexPaneId({ envPaneId: envPane, conversationId: threadId, cwd: process.cwd(), selfPid, procRoot }) || "";
      } catch {
        pane = "";
      }
    }
    return { provider: "codex", paneId: pane || undefined };
  }
  return { provider: envPane ? callerProvider(envPane) : undefined, paneId: envPane || undefined };
}

async function spawnCommand(options) {
  const caller = resolveCaller();
  const parentPaneId = caller.paneId;
  const { task, title, handover } = resolveTask(options);
  let provider = options.provider;
  // A handover continues in the SAME kind of agent: a Codex session that hits its limit
  // continues in Codex, a Claude session in Claude, whatever --provider was typed.
  if (handover && caller.provider && provider !== caller.provider) {
    if (provider) {
      process.stderr.write(`termfleet-child: a handover continues in the same agent as you (${caller.provider}), not ${provider}.\n`);
    }
    provider = caller.provider;
  }
  if (!PROVIDERS.includes(provider)) fail(`--provider must be one of ${PROVIDERS.join(", ")}\n${USAGE}`);
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutSeconds = Number(options.timeout ?? 20);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) fail("--timeout must be a positive number of seconds");

  const dir = childRequestsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  await ensureListener(dir, !options["no-start-app"]);

  const requestId = randomUUID();
  const requestPath = join(dir, `${requestId}.request.json`);
  const resultPath = join(dir, `${requestId}.result.json`);
  // Only a handover (--dropoff of a real handoff) takes over the calling terminal's
  // card; a helper (--task / --task-file) always adds a card and the caller keeps
  // running. --separate opts out of a handover, --replace asks for one explicitly.
  const replace = parentPaneId && !options.separate && (options.replace === true || handover === true) ? true : undefined;
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

// Only run as a command; importing this file (tests) must not start the CLI. The command
// is usually started through a symlink, so compare real paths.
const startedAsCommand = (() => {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return true;
  }
})();

if (startedAsCommand) {
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
}
