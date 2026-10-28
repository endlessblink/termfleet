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
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { paneSidecarPath, statusDir } from "./lib/agent-status-paths.mjs";
import { ancestors, argv as procArgv, isProviderProcess } from "./lib/single-chat-owner.mjs";
import { resolveCodexPaneId } from "./lib/codex-pane-owner.mjs";
import { findTranscript } from "./lib/handoff-user-words.mjs";
import { enumerateSessionSourceJournals } from './lib/session-event-journal.mjs';
import { createHandoffCapsule, handoffTask, capsuleFreshness } from "./lib/handoff-capsule.mjs";
import { checkBotTask, botTaskContext } from "./lib/bot-workflow-preflight.mjs";
import { memoryGuard } from "./lib/spawn-guards.mjs";
import { explainTaskRoute, explainProviderRoute } from "./lib/task-router.mjs";
import { assertProviderLaunch } from "./lib/provider-launch-policy.mjs";

const VERSION = "2.0.0";
const PROVIDERS = ["claude", "codex", "opencode", "shell"];
const LISTENER_FRESH_MS = 8_000;
const INLINE_TASK_LIMIT = 1_500;
const USAGE = `termfleet-child ${VERSION} - start an agent instance as a visible TermFleet terminal

usage:
  termfleet-child spawn [--provider <${PROVIDERS.join("|")}>] (--task "<text>" | --task-file FILE | --dropoff FILE)
                        [--goal "<one plain sentence>"] [--title "<card title>"] [--model sonnet|haiku|opus] [--project-id ID | --near PROJECT_DIR] [--separate | --replace] [--allow-thin] [--allow-no-words] [--cwd DIR] [--bot REGISTRY_ID] [--timeout SECONDS] [--no-start-app]
  (no --provider: a new terminal starts in Codex; Claude requires a separately verified owner exception)
  termfleet-child status
  termfleet-child --help | --version

Inside a TermFleet pane the new terminal is linked as that pane's child. Elsewhere it
is a top-level instance. Long prompts: use --task-file (not argv).
--goal is the one plain sentence the card shows as the helper's Goal (else the brief's "# heading").
HELPER (you keep running, a new card is added): --task / --task-file.
HANDOVER (your own card is replaced by a fresh instance): --dropoff <your HANDOFF.md>.
A handover always continues in the same agent you are (Codex stays Codex, Claude stays Claude).
Registered bot checkouts are checked automatically before launch; --bot selects an explicit reference.
BOT_WORKFLOW_CHECKER and BOT_REGISTRY_PATH configure a fleet installed elsewhere.`;

function fail(message, code = 1) {
  // A preflight rejection must remain actionable when this CLI is used through pipes.
  writeSync(2, `termfleet-child: ${message}\n`);
  process.exit(code);
}

const BOOLEAN_FLAGS = new Set(["no-start-app", "separate", "replace", "allow-thin", "allow-no-words"]);

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
    writeSync(2, "termfleet-child: TermFleet was not running; started it with the approved launcher...\n");
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

/** The one plain sentence the card shows as a stashed brief's Goal. */
function briefGoal(text, options) {
  const clean = (value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 160) : "");
  const explicit = clean(options.goal);
  if (explicit) return explicit;
  const heading = /^#\s+(.+)$/m.exec(text);
  if (heading) return clean(heading[1]);
  return clean(options.title);
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
    // A bare "Read <file>" pointer names no work, so the card had nothing to show as the
    // helper's Goal and fell back to the agent's own guess (report 2026-10-14). The goal
    // rides in front of the pointer, where the opening-request reader finds it.
    const goal = briefGoal(text, options);
    if (!goal) {
      writeSync(2, 'termfleet-child: warning: no --goal and no "# heading" in the brief, so the card will show no Goal. Pass --goal "<one plain sentence>".\n');
    }
    const pointer = `Read ${file} and carry out the instructions in it.`;
    return { task: goal ? `Goal: ${goal}\nFull instructions: ${pointer}` : pointer, title: label };
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
      writeSync(2, `termfleet-child: warning: handoff has no section for: ${gaps.join(", ")}\n`);
    }
    // Only a real handoff of THIS instance replaces its card. A briefing for a helper
    // that merely arrived through --dropoff must never end the instance that asked.
    const handover = gaps.length <= HANDOVER_MAX_GAPS;
    if (!handover) {
      writeSync(2,
        "termfleet-child: this file does not read like a handoff of your own work, so it starts a HELPER and your own card stays. " +
          "For a helper use --task-file; use --dropoff only to hand your own work to a fresh instance.\n",
      );
    }
    return {
      task: handover
        ? `Read ${file}. It is a handoff from the previous instance: continue exactly where it left off. ` +
          `First confirm what you understood: quote Noam's newest messages (the last section of the file) and the first next step in full, and say which ONE thing you will do first. ` +
          `Do that first step before any side investigation; a failing test or odd finding on the way is a sub-step of it, never a replacement for it.`
        : `Read ${file} and carry out the instructions in it.`,
      title: handover ? `Continue from ${basename(file)}` : `Helper: ${basename(file)}`,
      handover,
      file,
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

/** This Codex thread, then the thread that started it, and so on (a sub-agent has a parent in its session record). */
export function threadChain(threadId, home) {
  const chain = [];
  let id = threadId;
  while (id && !chain.includes(id) && chain.length < 6) {
    chain.push(id);
    let parent = "";
    try {
      const file = findTranscript({ provider: "codex", sessionId: id, home });
      const first = file ? readFileSync(file, "utf8").split("\n", 1)[0] : "";
      parent = String(JSON.parse(first)?.payload?.parent_thread_id ?? "");
    } catch {
      parent = "";
    }
    id = parent;
  }
  return chain;
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
      // A helper thread Codex starts inside a chat (review, sub-agent) has no card of its own:
      // its command belongs to the chat that started it, so walk up to the first bound chat.
      for (const id of threadChain(threadId)) {
        pane = String(bindings?.[id]?.paneId ?? "");
        if (pane) break;
      }
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
    // A card another chat is bound to is not this chat's card. Falling through to the id the
    // command inherited from whichever terminal started the shared Codex service made a paper-bot
    // handover replace a showtime-bot card. Unknown beats wrong: the handover then refuses.
    if (pane && threadId) {
      try {
        const bindings = JSON.parse(readFileSync(join(statusDir(), "codex-chat-panes.json"), "utf8"));
        const mine = threadChain(threadId).some((id) => bindings?.[id]?.paneId === pane);
        const other = Object.entries(bindings).some(([id, value]) => value?.paneId === pane && id !== threadId);
        if (!mine && other) pane = "";
      } catch {
        /* no record: nothing to contradict the pane */
      }
    }
    return { provider: "codex", paneId: pane || undefined };
  }
  return { provider: envPane ? callerProvider(envPane) : undefined, paneId: envPane || undefined };
}

async function spawnCommand(options) {
  const cwd = resolve(options.cwd ?? process.cwd());
  let botWorkflow;
  try {
    botWorkflow = checkBotTask({ cwd, bot: options.bot });
  } catch (error) {
    fail(error.message, 2);
  }
  const projectId=options["project-id"];
  if(projectId!==undefined && (!/^[A-Za-z0-9_-]{1,120}$/.test(projectId) || !options.cwd || options.near || options.replace || options.dropoff))fail("--project-id requires --cwd and a new task; it cannot inherit, replace or hand over a card",2);
  const caller = projectId ? {} : resolveCaller();
  const parentPaneId = caller.paneId;
  const { task: baseTask, title, handover, file: handoffFile } = resolveTask(options);
  let task = baseTask + botTaskContext(botWorkflow);
  let handoff;
  let retainedManifest;
  let provider = options.provider;
  // A handover continues in the SAME kind of agent: a Codex session that hits its limit
  // continues in Codex, a Claude session in Claude, whatever --provider was typed.
  if (handover && caller.provider && provider !== caller.provider) {
    if (provider) {
      writeSync(2, `termfleet-child: a handover continues in the same agent as you (${caller.provider}), not ${provider}.\n`);
    }
    provider = caller.provider;
  }
  // Automatic work stays in Codex; task prose cannot authorize Claude.
  if (!provider && !handover) {
    const picked = explainProviderRoute(baseTask);
    provider = picked.provider;
    writeSync(2, `termfleet-child: ${provider} for this task (${picked.reasons.join("; ")}); explicit choices also pass launch policy.\n`);
  }
  if (!PROVIDERS.includes(provider)) fail(`--provider must be one of ${PROVIDERS.join(", ")}\n${USAGE}`);
  try { assertProviderLaunch(provider, { surface: handover ? 'child-handover' : 'child-spawn' }); }
  catch (error) { fail(error.message, 4); }
  // Claude helpers start on the model their task needs (Noam 2026-10-24: "קלוד מאבד טוקנים ... אין
  // routing למודלים זולים", "לא רוצה הארדקודינג!!!"): the task router reads the task text and picks
  // haiku (read-only), sonnet (ordinary changes) or opus (hard jobs). --model always wins.
  // A handover keeps the agent it continues (no default), so only a named --model changes it there.
  const routed = provider === "claude" && typeof options.model !== "string" && !handover ? explainTaskRoute(baseTask) : undefined;
  const model = provider !== "claude" ? undefined
    : typeof options.model === "string" ? options.model.trim()
    : routed?.model;
  if (routed) writeSync(2, `termfleet-child: model ${routed.model} for this task (${routed.reasons.slice(0, 3).join("; ")}); --model overrides.\n`);
  if (model !== undefined && !/^[a-z0-9][a-z0-9.\-\[\]]{0,60}$/i.test(model)) fail(`--model must be sonnet, haiku, opus or a Claude model name\n${USAGE}`);
  if (options.model !== undefined && provider !== "claude") writeSync(2, `termfleet-child: --model applies to Claude helpers only; ${provider} starts on its own default.\n`);
  // A new terminal is refused when memory is low; a handover only replaces the caller's own card.
  if (!handover) {
    const memory = memoryGuard();
    if (!memory.ok) {
      writeSync(2, `termfleet-child: warning: low memory, ${memory.freeGb.toFixed(1)} GB free (floor ${memory.minGb} GB).\n`);
      fail(`not started: ${memory.message}`, 4);
    }
  }
  if (!parentPaneId && !options.separate && (handover === true || options.replace === true)) {
    fail("cannot identify your TermFleet card; the handover was not started. Do NOT retry with --separate: it leaves your old card running and adds a second one. Do NOT stop either: keep working on your task right here in this terminal (TF-102: a failed handover used to halt the work until someone noticed). Mention in your final reply that the handover could not start.", 2);
  }
  if (handover && handoffFile) {
    let fromPane;
    try { fromPane = JSON.parse(readFileSync(paneSidecarPath(parentPaneId), "utf8"))?.sessionId; } catch {}
    const fromEnv = provider === "codex"
      ? (process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID ?? "").trim()
      : (process.env.CLAUDE_CODE_SESSION_ID ?? "").trim();
    try {
      const observedSources=await enumerateSessionSourceJournals({paneId:parentPaneId,provider,dir:statusDir()});
      const capsule = createHandoffCapsule({summaryPath:handoffFile,provider,observedSources,observedSourceDir:statusDir(),
        sessionIds:[fromEnv,fromPane],root:join(dataRoot(),"handoff-capsules"),parentPaneId});
      handoff = capsule.descriptor; retainedManifest = capsule.manifest;
      task = handoffTask(handoff) + botTaskContext(botWorkflow);
      writeSync(2, `termfleet-child: retained ${capsule.manifest.ownerCount} owner records in generation ${handoff.generation}; original handoff untouched.\n`);
    } catch(error) { fail(error.message,2); }
  }
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
  // A v3 handoff always replaces the caller's own card; the app rejects any
  // other shape after it is queued, so refuse here with a reason instead.
  if (handoff && replace !== true) {
    fail("a handover replaces your own card, so it cannot be combined with --separate; use --task-file for a helper instead. The handover was not started.", 2);
  }
  if (handoff) {
    const freshness = capsuleFreshness(retainedManifest);
    if (!freshness.ok) fail(`handoff source changed before queue publication: ${freshness.reason}`,2);
  }
  const request = { version: handoff ? 3 : projectId ? 2 : 1, kind: handoff ? "handoff" : undefined, handoff, requestId, parentPaneId, projectId, provider, ...(model ? { model } : {}), task, title, near, replace, cwd, createdAt: Date.now() };
  // Write then rename, so the app never reads a half-written request.
  writeFileSync(`${requestPath}.tmp`, JSON.stringify(request), { mode: 0o600 });
  renameSync(`${requestPath}.tmp`, requestPath);

  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (existsSync(resultPath)) {
      const text = readFileSync(resultPath, "utf8");
      rmSync(resultPath, { force: true });
      writeSync(1, `${text}\n`);
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
  writeSync(1,
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
    writeSync(1, `${USAGE}\n`);
    process.exit(0);
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    writeSync(1, `${VERSION}\n`);
    process.exit(0);
  }
  const { command, options } = parseArgs(argv);
  if (command === "spawn") await spawnCommand(options);
  else if (command === "status") statusCommand();
  else fail(`unknown command "${command}"\n${USAGE}`);
}
