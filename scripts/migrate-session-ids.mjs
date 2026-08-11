#!/usr/bin/env node
// Populate structured provider ownership IDs from legacy saved resume commands.
// The migration is additive: it never removes records or merges terminal panes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const apply = process.argv.includes("--apply");
const dataRoot = process.env.TERMFLEET_DATA_DIR || path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
  "terminal-workspace",
);
const sessionDir = path.join(dataRoot, "sessions");
const resumePattern = /(?:\b(codex)\s+resume|\b(claude)\s+(?:--)?resume)\s+([0-9a-f-]{36})/i;

let migrated = 0;
let alreadyStructured = 0;
let unmatched = 0;
let unreadable = 0;

if (!fs.existsSync(sessionDir)) {
  console.log(`No session registry found at ${sessionDir}`);
  process.exit(0);
}

for (const name of fs.readdirSync(sessionDir).filter((entry) => entry.endsWith(".meta.json"))) {
  const filePath = path.join(sessionDir, name);
  let meta;
  try {
    meta = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    unreadable += 1;
    continue;
  }

  if (meta.providerSessionId) {
    alreadyStructured += 1;
    continue;
  }

  const command = [meta.command, meta.sanitizedResumeCommand, meta.originalCommand]
    .filter(Boolean)
    .join(" ");
  const match = command.match(resumePattern);
  if (!match) {
    unmatched += 1;
    continue;
  }

  meta.provider = meta.provider || match[1] || match[2];
  meta.providerSessionId = match[3];
  migrated += 1;
  if (!apply) continue;

  const tempPath = `${filePath}.migration-${process.pid}`;
  const bytes = `${JSON.stringify(meta)}\n`;
  fs.writeFileSync(tempPath, bytes, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  sessionDir,
  migrated,
  alreadyStructured,
  unmatched,
  unreadable,
}, null, 2));

if (unreadable) process.exitCode = 1;
