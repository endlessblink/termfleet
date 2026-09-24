// Demo status sidecars for the showcase capture (scripts/capture-showcase-shots.sh).
//
// Writes the SAME files the status hooks write at runtime, so the captured cockpit
// renders its real Task row and TASKS panel — with invented, plain-language work
// instead of anything from the operator's machine. Only ever run against a private
// XDG_DATA_HOME (the capture script sets one); it refuses to touch a real one.
import { mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { paneSidecarPath, sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

const home = process.env.SHOWCASE_DEMO_HOME;
if (!home) {
  console.error("SHOWCASE_DEMO_HOME is required");
  process.exit(1);
}
if (!process.env.XDG_DATA_HOME || !process.env.XDG_DATA_HOME.startsWith("/tmp/")) {
  console.error("refusing to seed: XDG_DATA_HOME must be a private /tmp dir");
  process.exit(1);
}

const now = Date.now();
const panes = [
  {
    cwd: `${home}/code/api-gateway`,
    mainTask: "Adding rate limiting to the orders API",
    now: "Running the test suite",
    turn: "working",
    todos: [
      { content: "Add a request limit per API key", status: "completed" },
      { content: "Return a clear error when the limit is hit", status: "in_progress" },
      { content: "Cover burst traffic with tests", status: "pending" },
    ],
  },
  {
    cwd: `${home}/code/web-app`,
    mainTask: "Fixing the checkout page on small screens",
    now: "Checking the cart layout at 375px",
    turn: "working",
    todos: [
      { content: "Reproduce the squashed cart on a phone width", status: "completed" },
      { content: "Keep the pay button reachable without scrolling", status: "in_progress" },
      { content: "Take before and after screenshots", status: "pending" },
    ],
  },
  {
    cwd: `${home}/code/docs-site`,
    mainTask: "Rewriting the getting-started guide",
    now: "Reading the current guide end to end",
    turn: "idle",
    todos: [
      { content: "Cut the setup steps down to five", status: "in_progress" },
      { content: "Add a first-run screenshot", status: "pending" },
    ],
  },
];

// Terminals opened inside TermFleet read their OWN status file (keyed by the
// terminal), never one keyed by folder. So after the capture driver has moved
// each demo terminal into its folder, look up which live terminal sits in which
// demo folder and seed that terminal's file as well.
function liveDemoTerminals() {
  const found = [];
  for (const name of readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    let env = "";
    try {
      env = readFileSync(`/proc/${name}/environ`, "utf8");
    } catch {
      continue;
    }
    const vars = Object.fromEntries(
      env.split("\0").filter(Boolean).map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]),
    );
    if (!vars.TERMFLEET_PANE_ID || vars.XDG_DATA_HOME !== process.env.XDG_DATA_HOME) continue;
    try {
      const args = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0");
      if (!/(^|\/)bash$/.test(args[0] ?? "")) continue;
      found.push({ paneId: vars.TERMFLEET_PANE_ID, cwd: readlinkSync(`/proc/${name}/cwd`) });
    } catch {
      continue;
    }
  }
  return found;
}

const byTerminal = process.argv.includes("--live-terminals");
const terminals = byTerminal ? liveDemoTerminals() : [];

mkdirSync(statusDir(), { recursive: true });
for (const pane of panes) {
  const payload = {
    cwd: pane.cwd,
    updatedAt: now,
    now: pane.now,
    mainTask: pane.mainTask,
    mainTaskSource: "goal-task",
    userTask: pane.mainTask,
    turn: pane.turn,
    todos: pane.todos.map((todo, index) => ({
      id: `demo-${index + 1}`,
      content: todo.content,
      status: todo.status,
      activeForm: todo.content,
    })),
  };
  const targets = byTerminal
    ? terminals
        .filter((terminal) => terminal.cwd === pane.cwd)
        .map((terminal) => ({ path: paneSidecarPath(terminal.paneId), paneId: terminal.paneId }))
    : [{ path: sidecarPath(pane.cwd), paneId: undefined }];
  for (const target of targets) {
    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, `${JSON.stringify({ ...payload, paneId: target.paneId }, null, 2)}\n`);
    console.log(`seeded ${target.path} -> ${pane.mainTask}`);
  }
}
