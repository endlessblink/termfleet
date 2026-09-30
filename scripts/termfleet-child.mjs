#!/usr/bin/env node
// FEATURE-64: lets an agent running inside a TermFleet terminal open a child agent
// in its own visible terminal on the map, right next to the parent's card.
//
//   termfleet-child spawn --provider claude --task "Write tests for the export dialog" [--cwd DIR] [--timeout SECONDS]
//
// The parent is identified by the terminal's own TERMFLEET_PANE_ID. The request is
// dropped into the app's child-requests folder; the running app picks it up, opens
// the child, and writes a result that this command prints as JSON.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PROVIDERS = ["claude", "codex", "opencode", "shell"];
const USAGE = `usage: termfleet-child spawn --provider <${PROVIDERS.join("|")}> --task "<what the child should do>" [--cwd DIR] [--timeout SECONDS]`;

function fail(message, code = 1) {
  process.stderr.write(`termfleet-child: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith("--")) fail(`unexpected argument "${key}"\n${USAGE}`);
    const value = rest[i + 1];
    if (value === undefined || value.startsWith("--")) fail(`${key} needs a value\n${USAGE}`);
    options[key.slice(2)] = value;
    i += 1;
  }
  return { command, options };
}

export function childRequestsDir(env = process.env) {
  const dataHome = env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "terminal-workspace", "child-requests");
}

async function spawn(options) {
  const parentPaneId = process.env.TERMFLEET_PANE_ID?.trim();
  if (!parentPaneId) fail("not running inside a TermFleet terminal (TERMFLEET_PANE_ID is not set)");
  const provider = options.provider;
  if (!PROVIDERS.includes(provider)) fail(`--provider must be one of ${PROVIDERS.join(", ")}\n${USAGE}`);
  const task = options.task?.trim();
  if (!task) fail(`--task is required\n${USAGE}`);
  const cwd = resolve(options.cwd ?? process.cwd());
  const timeoutSeconds = Number(options.timeout ?? 60);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) fail("--timeout must be a positive number of seconds");

  const dir = childRequestsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const requestId = randomUUID();
  const requestPath = join(dir, `${requestId}.request.json`);
  const resultPath = join(dir, `${requestId}.result.json`);
  const request = { version: 1, requestId, parentPaneId, provider, task, cwd, createdAt: Date.now() };
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
    await new Promise((done) => setTimeout(done, 250));
  }
  // Nobody picked it up: withdraw it so it cannot open a terminal later by surprise.
  const withdrawn = existsSync(requestPath);
  rmSync(requestPath, { force: true });
  fail(
    withdrawn
      ? "TermFleet did not pick up the request in time (is the TermFleet app open?)"
      : "TermFleet took the request but did not report back in time; check the map for the new terminal",
    2,
  );
}

const { command, options } = parseArgs(process.argv.slice(2));
if (command === "spawn") await spawn(options);
else fail(USAGE, command ? 1 : 0);
