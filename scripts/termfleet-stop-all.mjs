#!/usr/bin/env node
// Stop every TermFleet process so a daemon-side fix can take effect.
//
// This exists because a hand-rolled stop caused a daemon split-brain: the
// socket file was deleted while a daemon was still alive, so the next launch
// started a SECOND daemon and the running agents became unreachable. The socket
// is never unlinked here, and success is not reported until every owning
// process is really gone.
import fs from "node:fs";
import net from "node:net";

const SOCKET = `${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`}/terminal-workspace/daemon.sock`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ownedProcesses() {
  const owned = [];
  for (const entry of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid === process.pid) continue;
    let argv;
    try {
      argv = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    } catch {
      continue;
    }
    const exe = argv[0] ?? "";
    const isDesktop = exe.endsWith("/termfleet-desktop");
    const isApp =
      exe.endsWith("/.local/bin/termfleet") ||
      (exe.endsWith("/termfleet") && exe.includes("/termfleet/releases/"));
    if (isDesktop || isApp) owned.push({ pid, command: argv.join(" ").slice(0, 100) });
  }
  return owned;
}

async function socketAnswers() {
  if (!fs.existsSync(SOCKET)) return false;
  return await new Promise((resolve) => {
    const socket = net.connect(SOCKET);
    const done = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    setTimeout(() => done(true), 1500);
  });
}

const before = ownedProcesses();
if (!before.length) console.log("no TermFleet processes running");
for (const { pid, command } of before) console.log(`stopping ${pid}  ${command}`);
for (const { pid } of before) {
  try {
    process.kill(pid, "SIGTERM");
  } catch {}
}
for (let attempt = 0; attempt < 40 && ownedProcesses().length; attempt += 1) await sleep(500);
for (const { pid } of ownedProcesses()) {
  console.log(`escalating to SIGKILL for ${pid}`);
  try {
    process.kill(pid, "SIGKILL");
  } catch {}
}
await sleep(1000);

const left = ownedProcesses();
// NEVER unlink the socket. A stale file is handled by the launcher (it connects,
// is refused, and proceeds); deleting a LIVE one is what produced two daemons.
const answers = await socketAnswers();
if (left.length || answers) {
  for (const { pid, command } of left) console.error(`STILL RUNNING ${pid}  ${command}`);
  if (answers) console.error(`socket still answering: ${SOCKET}`);
  console.error("TERMFLEET_STOP_ALL_FAILED — do not launch; an owner is still alive");
  process.exit(1);
}
console.log("TERMFLEET_STOP_ALL_OK all processes stopped; socket left for the launcher");
