#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const INTERVAL_MS = 5000;
const PRESSURE_HIGH = 10;
const PRESSURE_RECOVERED = 3;
const BACKGROUND_SCOPE = /^termfleet-background-[0-9]+-[0-9]+\.scope$/;
const stateDir = `${process.env.XDG_STATE_HOME || `${os.homedir()}/.local/state`}/termfleet`;
const stateFile = `${stateDir}/io-governor.state`;
const sessionEnv = {
  ...process.env,
  XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? "1000"}`,
  DBUS_SESSION_BUS_ADDRESS:
    process.env.DBUS_SESSION_BUS_ADDRESS ||
    `unix:path=${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? "1000"}`}/bus`,
};

function ioPressure() {
  const text = fs.readFileSync("/proc/pressure/io", "utf8");
  const match = text.match(/^some .*?avg10=([0-9.]+)/m);
  return match ? Number(match[1]) : 0;
}

function scopes() {
  const result = spawnSync("systemctl", ["--user", "list-units", "--type=scope", "--all", "--no-legend", "--plain"], {
    encoding: "utf8",
    env: sessionEnv,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((unit) => BACKGROUND_SCOPE.test(unit));
}

function setWeights(unit, ioWeight, cpuWeight) {
  spawnSync("systemctl", ["--user", "set-property", unit, `IOWeight=${ioWeight}`, `CPUWeight=${cpuWeight}`], {
    encoding: "utf8",
    env: sessionEnv,
  });
}

function main() {
  fs.mkdirSync(stateDir, { recursive: true });
  let mode = "normal";
  setInterval(() => {
    const pressure = ioPressure();
    const nextMode = pressure >= PRESSURE_HIGH ? "pressured" : pressure <= PRESSURE_RECOVERED ? "normal" : mode;
    if (nextMode === mode) return;
    mode = nextMode;
    for (const unit of scopes()) {
      setWeights(unit, mode === "pressured" ? 10 : 25, mode === "pressured" ? 25 : 50);
    }
    fs.writeFileSync(stateFile, `${new Date().toISOString()} mode=${mode} io_avg10=${pressure}\n`);
  }, INTERVAL_MS);
}

main();
