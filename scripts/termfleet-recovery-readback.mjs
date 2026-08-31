#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import path from "node:path";
import { defaultDaemonSocket, requestDaemon } from "./termfleetctl.mjs";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const coordinator = path.join(root, "scripts", "termfleet-recovery-coordinator.mjs");
const plan = JSON.parse(execFileSync(process.execPath, [coordinator], { cwd: root, encoding: "utf8" }));
const results = [];
for (const project of plan.plan) {
  const item = project.selected;
  if (!item) throw new Error(`${project.project}: no exact eligible selection`);
  const daemonSessionId = item.providerOwner?.sessionId ?? item.paneId;
  const response = await requestDaemon({ type: "snapshotSession", id: daemonSessionId }, defaultDaemonSocket());
  if (!response.ok) throw new Error(`${project.project}: daemon read-back failed: ${response.error}`);
  const value = response.value ?? {};
  const serialized = JSON.stringify(value);
  const command = value.command ?? value.session?.command ?? item.exactResume;
  if (command !== item.exactResume) throw new Error(`${project.project}: provider command mismatch during read-back`);
  results.push({
    project: project.project,
    provider: item.provider,
    providerSessionId: item.providerSessionId,
    daemonSessionId,
    command,
    snapshotBytes: serialized.length,
    containsProviderSessionId: serialized.includes(item.providerSessionId),
  });
}
console.log(JSON.stringify({ status: "PASS", results }));
