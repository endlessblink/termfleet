#!/usr/bin/env node
import net from "node:net";

const [, , id, encodedData] = process.argv;
if (!id || encodedData === undefined) {
  console.error("usage: termfleet-write-session.mjs <session-id> <base64-data>");
  process.exit(2);
}
const data = Buffer.from(encodedData, "base64").toString("utf8");

// Typing a provider resume command into a pane is never recovery, and doing it
// to a pane that already runs an agent dumps the text straight into the agent's
// composer — which is exactly how a live cockpit ended up with four stray
// `exec codex resume <id>` lines. Recovery starts a conversation by spawning it
// (ensureSession with a command), never by writing keystrokes.
const RESUME_KEYSTROKES =
  /\b(?:codex\s+resume|claude\s+--resume|opencode\s+--session)\b/i;
if (RESUME_KEYSTROKES.test(data)) {
  console.error(
    "refusing to type a provider resume command into a live session; " +
      "start the conversation with ensureSession instead",
  );
  process.exit(3);
}

const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`;
const socketPath = `${runtimeDir}/terminal-workspace/daemon.sock`;
const socket = net.createConnection(socketPath, () => {
  socket.end(JSON.stringify({ type: "writeSession", id, data }));
});
socket.setEncoding("utf8");
let response = "";
socket.on("data", (chunk) => {
  response += chunk;
});
socket.once("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
socket.once("end", () => {
  process.stdout.write(response);
});
