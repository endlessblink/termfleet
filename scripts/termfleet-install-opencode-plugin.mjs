#!/usr/bin/env node
// Install (or re-point) the TermFleet status plugin for OpenCode.
//
// OpenCode loads ESM modules from `{plugin,plugins}/*.{ts,js}` under its config
// directory, so a symlink is enough — no edit to the user's opencode.json, and the
// plugin follows this checkout as it changes. The plugin itself is inert outside a
// TermFleet pane (it needs TERMFLEET_PANE_ID), so installing it globally is safe.
//
// Usage: node scripts/termfleet-install-opencode-plugin.mjs [--check]
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.join(here, "termfleet-opencode-status-plugin.js");
const configDir =
  process.env.OPENCODE_CONFIG_DIR ??
  path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "opencode");
const target = path.join(configDir, "plugin", "termfleet-status.js");

function currentLink() {
  try {
    return lstatSync(target).isSymbolicLink() ? readlinkSync(target) : null;
  } catch {
    return null;
  }
}

const checkOnly = process.argv.includes("--check");
const linked = currentLink();

if (linked === source) {
  console.log(`ok: OpenCode status plugin installed → ${target}`);
  process.exit(0);
}

if (checkOnly) {
  console.log(
    linked || existsSync(target)
      ? `stale: ${target} points at ${linked ?? "a plain file"} (expected ${source})`
      : `missing: ${target} — OpenCode panes will have no task row`,
  );
  process.exit(1);
}

if (!existsSync(source)) {
  console.error(`fail: plugin source is missing: ${source}`);
  process.exit(1);
}

mkdirSync(path.dirname(target), { recursive: true });
if (existsSync(target) || linked) rmSync(target, { force: true });
symlinkSync(source, target);
console.log(`installed: ${target} → ${source}`);
console.log("Restart any running OpenCode session to pick it up.");
