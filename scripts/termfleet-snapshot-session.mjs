#!/usr/bin/env node
import net from "node:net";

const id = process.argv[2];
if (!id) {
  console.error("usage: termfleet-snapshot-session.mjs <id>");
  process.exit(2);
}
const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const socket = net.createConnection(`${runtimeDir}/terminal-workspace/daemon.sock`);
let response = "";
socket.setEncoding("utf8");
socket.on("data", (chunk) => { response += chunk; });
socket.once("error", (error) => { console.error(error.message); process.exit(1); });
socket.once("connect", () => socket.end(JSON.stringify({ type: "snapshotSession", id })));
socket.once("end", () => process.stdout.write(response));
