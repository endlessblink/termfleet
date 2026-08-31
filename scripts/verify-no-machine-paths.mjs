#!/usr/bin/env node
// OSS readiness gate: nothing that would be committed may hardcode one person's
// machine. Operator-specific paths belong in the user config file or an
// environment variable, never in a default baked into the source.
//
// Only files git would publish are scanned (tracked plus untracked-but-not-
// ignored), so local one-off scripts kept out of the repo do not trip the gate.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const targets = ["src", "src-tauri/src", "scripts", ".github/workflows"];
const skipFiles = new Set(["scripts/verify-no-machine-paths.mjs"]);

// Names used deliberately as stand-ins in tests, fixtures, and documentation.
const placeholderUsers = ["operator", "me", "you", "user", "alice", "bob", "example", "runner"];

const machinePath = new RegExp(
  `(?:/home/(?!(?:${placeholderUsers.join("|")})\\b)[a-z0-9._-]+/` +
    `|/media/[a-z0-9._-]+/[a-z0-9._-]+/my-projects)`,
  "i",
);

function publishableFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...targets],
    { cwd: repoRoot, encoding: "utf8" },
  );
  return output.split("\n").map((line) => line.trim()).filter(Boolean);
}

const findings = [];
for (const file of publishableFiles()) {
  if (skipFiles.has(file)) continue;
  let text;
  try {
    text = readFileSync(path.join(repoRoot, file), "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, index) => {
    if (machinePath.test(line)) findings.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
  });
}

if (findings.length > 0) {
  console.error("Machine-specific paths must not be committed:");
  for (const finding of findings) console.error(`  ${finding}`);
  console.error("\nMove the value into the TermFleet config file or an environment variable.");
  process.exit(1);
}

console.log(`No machine-specific paths in shipped code (${publishableFiles().length} files scanned).`);
