#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const prompt = process.argv.at(-1);
if (!prompt) {
  console.error("missing reviewer prompt");
  process.exit(2);
}

const result = spawnSync("claude", ["-p", "--output-format", "json", prompt], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.error || result.status !== 0) {
  console.error(result.error?.message ?? result.stderr ?? `claude exited ${result.status}`);
  process.exit(result.status || 2);
}

let envelope;
try {
  envelope = JSON.parse(result.stdout.trim());
} catch {
  console.error("claude did not return JSON output");
  process.exit(2);
}

const candidate = typeof envelope?.result === "string" ? envelope.result.trim() : envelope;
let review;
try {
  review = typeof candidate === "string" ? JSON.parse(candidate) : candidate;
} catch {
  if (typeof candidate !== "string") {
    console.error("claude JSON output did not contain a review object");
    process.exit(2);
  }
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    console.error("claude JSON output did not contain a review object");
    process.exit(2);
  }
  try {
    review = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    console.error("claude JSON output contained no parseable review object");
    process.exit(2);
  }
}
if (!review || Array.isArray(review) || typeof review !== "object") {
  console.error("claude review output is not an object");
  process.exit(2);
}
const snapshot = process.env.TERMFLEET_CHALLENGE_SNAPSHOT
  ? JSON.parse((await import("node:fs")).readFileSync(process.env.TERMFLEET_CHALLENGE_SNAPSHOT, "utf8"))
  : null;
review.snapshot = snapshot?.snapshot_sha256 ?? review.snapshot;
review.review_count = Number(process.env.TERMFLEET_CHALLENGE_REVIEW_COUNT ?? review.review_count);
review.reviewer = {
  ...(review.reviewer && typeof review.reviewer === "object" ? review.reviewer : {}),
  context_id: `hosted-${Date.now()}-${process.pid}`,
};
process.stdout.write(`${JSON.stringify(review)}\n`);
