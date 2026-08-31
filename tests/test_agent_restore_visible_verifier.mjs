import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const verifier = fs.readFileSync("scripts/verify-agent-restore-visible.sh", "utf8");

test("visible restore verifier isolates the cockpit snapshot writer", () => {
  assert.match(
    verifier,
    /TERMFLEET_COCKPIT_SNAPSHOT_PATH=\"\$SNAPSHOT_FILE\"/,
    "the isolated app must write its cockpit snapshot into the verifier data root",
  );
  assert.match(verifier, /TERMFLEET_CONTEXT_TITLE_DISABLE=0/);
  assert.match(verifier, /TERMFLEET_AGENT_STATUS_COMMAND=cat/);
  assert.match(verifier, /node scripts\/agent-status-summary-server\.mjs\n/);
  assert.match(verifier, /NODE_ID="terminal-map-\$\{TAB_ID\}"/);
  assert.match(verifier, /TERMFLEET_AGENT_RESTORE_WORKSPACE_MODE:-split/);
  assert.match(verifier, /"mainTask": "Resume durable Codex lane"/);
  assert.match(verifier, /"sessionId": provider_session_id/);
  assert.doesNotMatch(
    verifier,
    /node scripts\/agent-status-summary-server\.mjs node scripts\/agent-status-summary-sidecar\.mjs/,
    "the fixture must not launch the sidecar marker that disables contextual titles",
  );
});
