# TermFleet Control Surface

Status: first read-only slice for TC-022.

TermFleet's control surface is the product-level facade for clients outside the
React renderer: a future CLI, local Web UI, MCP/Hermes bridge, and desktop IPC.
It does not own durable truth. It composes existing owners into stable JSON.

## Contract Shape

- `Query`: read-only. It must not spawn shells, create workstreams, send input,
  resize terminals, kill sessions, or mutate workspace state.
- `Command`: explicit side effects. Commands are out of scope for this first
  slice and must add validation, authorization, and visible cockpit/audit state
  before they are exposed.
- `Event`: push updates for future status/output streams. Events are out of
  scope for this first slice.

All responses are serializable JSON and include `schemaVersion`. Boundary
callers must branch on structured fields, not human error strings.

## Ownership

- The Rust daemon owns PTY/session runtime truth: reachability, live sessions,
  cwd, pid, command, scrollback size, subscribers, exit status, and session
  events.
- Workspace persistence owns cockpit projection: tabs, groups, canvas layout,
  terminal pane metadata, agent/workstream metadata, task labels, worktree
  labels, evidence, memory, proof, and review state.
- The control surface may join these records by terminal/session id, tab id, and
  run id. It must not become a new persistence layer.

## First Queries

The first local CLI facade is `scripts/termfleetctl.mjs`.

```bash
npm run termfleetctl -- status --json
npm run termfleetctl -- sessions list --json
npm run termfleetctl -- agents list --json
```

The script is executable directly as well:

```bash
node scripts/termfleetctl.mjs status --json
node scripts/termfleetctl.mjs sessions list --json
node scripts/termfleetctl.mjs agents list --json
```

The CLI is intentionally read-only. It reads the daemon socket when reachable
and the durable workspace mirror at:

```text
${XDG_DATA_HOME:-~/.local/share}/terminal-workspace/workspace.json
${XDG_DATA_HOME:-~/.local/share}/terminal-workspace/sessions/
```

For tests or alternate installs:

```bash
TERMFLEET_DATA_DIR=/tmp/termfleet-fixture \
TERMFLEET_DAEMON_SOCKET=/tmp/no-daemon.sock \
node scripts/termfleetctl.mjs status --json
```

## Response Summary

- `status`: daemon reachability, socket/data paths, workspace load state, and
  counts for live sessions, persisted sessions, and agent workstreams.
- `sessions list`: live daemon sessions plus persisted scrollback records. If a
  live and persisted record share an id, one row is returned with both sources.
- `agents list`: persisted workspace tabs whose `workstream.kind` is `agent`,
  including provider, mission, cwd, branch/worktree, lifecycle, current activity,
  evidence/memory/proof fields, and linked terminal ids.

## Boundaries For Later Commands

Future write commands such as `send`, `open`, `kill`, `archive`, or remote Web UI
control must add:

- runtime payload validation;
- local-only transport and capability token or pairing;
- visible UI indicator when an external controller is attached;
- audit/event rows in the cockpit;
- regression tests proving unrelated terminals are not affected.

Do not expose shell control over HTTP before those checks exist.
