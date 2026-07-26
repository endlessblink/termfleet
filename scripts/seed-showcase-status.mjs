// Demo status sidecars for the showcase capture (scripts/capture-showcase-shots.sh).
//
// Writes the SAME files the status hooks write at runtime, so the captured cockpit
// renders its real Task row and TASKS panel — with invented, plain-language work
// instead of anything from the operator's machine. Only ever run against a private
// XDG_DATA_HOME (the capture script sets one); it refuses to touch a real one.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { sidecarPath, statusDir } from "./lib/agent-status-paths.mjs";

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
  const target = sidecarPath(pane.cwd);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`seeded ${target} -> ${pane.mainTask}`);
}
