#!/usr/bin/env node

// Read-only daemon handshake used by doctor and release tooling. It sends only
// Status over the canonical socket and never starts, replaces, or mutates a PTY.
import net from "node:net";

const socketPath = process.env.TERMFLEET_DAEMON_SOCKET ||
  `${process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() ?? ""}`}/terminal-workspace/daemon.sock`;
const timeoutMs = 900;

const response = await new Promise((resolve) => {
  const chunks = [];
  const socket = net.createConnection(socketPath);
  const finish = (value) => {
    socket.destroy();
    resolve(value);
  };
  socket.setTimeout(timeoutMs, () => finish(null));
  socket.on("error", () => finish(null));
  socket.on("data", (chunk) => chunks.push(chunk));
  socket.on("end", () => {
    try {
      resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      resolve(null);
    }
  });
  socket.on("connect", () => {
    socket.end("status\n");
  });
});

if (!response || typeof response !== "object" || !("protocolVersion" in response)) process.exit(1);
process.stdout.write(`${JSON.stringify(response)}\n`);
