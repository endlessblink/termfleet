#!/usr/bin/env node

import fs from "node:fs";

const snapshotPath = process.env.TERMFLEET_CHALLENGE_SNAPSHOT;
const runDir = process.env.TERMFLEET_CHALLENGE_RUN_DIR;
const reviewCount = Number(process.env.TERMFLEET_CHALLENGE_REVIEW_COUNT ?? 1);
if (!snapshotPath || !runDir || !Number.isInteger(reviewCount) || reviewCount < 1) {
  process.exitCode = 2;
  console.error("BLOCKED: local reviewer context is incomplete");
} else {
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
  console.log(JSON.stringify({
    verdict: "BLOCKED",
    snapshot: snapshot.snapshot_sha256,
    findings: [],
    remaining_risks: "No safe provider reviewer is available inside the network-isolated read-only context; no behavioral PASS is asserted.",
    review_count: reviewCount,
    reviewer: {
      context_id: `local-reviewer-${process.pid}`,
      authority: "read-only",
      isolation_evidence: "bundled reviewer executed in the network-isolated read-only sandbox",
    },
    evidence: [],
  }));
}
