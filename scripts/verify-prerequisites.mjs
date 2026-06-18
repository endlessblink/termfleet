import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const checks = [];

function commandVersion(command, args = ["--version"]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return {
    ok: result.status === 0,
    output: `${result.stdout}${result.stderr}`.trim().split(/\r?\n/)[0] ?? "",
    error: result.error?.message,
  };
}

function pkgConfigModule(name, installHint) {
  const result = spawnSync("pkg-config", ["--modversion", name], { encoding: "utf8" });
  checks.push({
    ok: result.status === 0,
    label: `pkg-config ${name}`,
    detail: result.status === 0 ? result.stdout.trim() : installHint,
  });
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
checks.push({
  ok: Number.isInteger(nodeMajor) && nodeMajor >= 20,
  label: "Node.js 20+",
  detail: `found ${process.version}`,
});

for (const command of ["npm", "cargo", "rustc", "pkg-config"]) {
  const version = commandVersion(command);
  checks.push({
    ok: version.ok,
    label: command,
    detail: version.ok ? version.output : version.error ?? `${command} not found on PATH`,
  });
}

pkgConfigModule("webkit2gtk-4.1", "Install WebKitGTK 4.1 development files, e.g. libwebkit2gtk-4.1-dev on Debian/Ubuntu.");
pkgConfigModule("javascriptcoregtk-4.1", "Install JavaScriptCoreGTK 4.1 development files, usually provided with WebKitGTK dev packages.");
pkgConfigModule("libsoup-3.0", "Install libsoup 3 development files, e.g. libsoup-3.0-dev on Debian/Ubuntu.");

checks.push({
  ok: existsSync("package-lock.json"),
  label: "package-lock.json",
  detail: "required so fresh clones can use npm ci for reproducible installs",
});

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  const status = check.ok ? "OK" : "FAIL";
  console.log(`${status}: ${check.label} - ${check.detail}`);
}

if (failures.length > 0) {
  console.error("\nTermFleet prerequisites are incomplete. Fix the failed items above before running npm install, npm run build, or npm run tauri:dev.");
  process.exit(1);
}

console.log("\nTermFleet prerequisite checks passed.");
