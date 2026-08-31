#!/usr/bin/env node
import net from "node:net";

const [, , id, cwd, mode, resumeId] = process.argv;
if (!id || !cwd || !mode || !resumeId || !["codex", "claude"].includes(mode)) {
  console.error("usage: termfleet-ensure-session.mjs <id> <cwd> <codex|claude> <provider-session-id>");
  process.exit(2);
}
const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const socket = net.createConnection(`${runtimeDir}/terminal-workspace/daemon.sock`);
let response = "";
socket.setEncoding("utf8");
socket.on("data", (chunk) => { response += chunk; });
socket.once("error", (error) => { console.error(error.message); process.exit(1); });
socket.once("connect", () => {
  socket.end(JSON.stringify({
    type: "ensureSession",
    id,
    cwd,
    command: `export TERMFLEET=1 TERMFLEET_SESSION_NAME_B64=Zmxvdy1zdGF0ZQ; exec ${mode === "claude" ? "claude --resume" : "codex resume"} ${resumeId}`,
    cols: 80,
    rows: 24,
  }));
});
socket.once("end", () => process.stdout.write(response));
