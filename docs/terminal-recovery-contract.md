# Terminal recovery contract

This is the acceptance contract for terminal and agent recovery. The durable
workspace, PTY daemon, lifecycle ledger, provider session records, and curated
manifests must implement the same rules.

1. An explicit operator close is the only event that creates a close tombstone.
   A tombstone is keyed by the exact pane/PTy identity and, when known, the
   exact provider conversation ID; it is never inferred from project, folder,
   age, missing UI state, or a broad cleanup.
2. A terminal that was not explicitly closed is eligible for automatic recovery
   after UI exit, TermFleet restart, logout, shutdown, or reboot.
3. Recovery is per pane, never per folder. It must preserve the exact pane
   identity, working directory, provider type, provider conversation ID, and
   provider checkpoint. `codex` and `claude` are not interchangeable.
4. A provider conversation may have at most one live writer. Before launching
   a resume, the coordinator must prove that no other PTY, provider process, or
   writer lock owns that conversation. A collision or existing writer lock is
   held for review.
5. Unknown provider, missing conversation ID, daemon/project mismatch, stale
   ownership, corrupt checkpoint, and failed resume are held for review. They
   must never silently become a fresh chat or be relabeled into another pane.
   When the exact provider writer is live under a different project identity,
   the coordinator emits an explicit owner-transfer record; transfer must be
   atomic and preserve the source project's replacement shell.
6. Explicitly closed terminals remain excluded from automatic recovery but stay
   visible in a recovery list. A deliberate `Restore` action may clear the
   exact tombstone and retry the exact provider resume; it must not restore by
   folder or create a replacement chat when the provider checkpoint is gone.
7. Every recovery decision is append-only auditable and idempotent. Repeating
   startup, reconciliation, or recovery concurrently cannot create a second
   pane, second PTY, second provider writer, or new tombstone.
8. A pane's durable provider/conversation binding is write-once during passive
   status capture. A nested helper that inherits `TERMFLEET_PANE_ID` may report
   status, but it cannot replace the pane owner's bound conversation; changing
   the binding requires an explicit recovery-manifest update.
9. Recovery has distinct receipts: shell attached, scrollback replayed, resume
   sent, and exact provider live. Only a stable live process whose top-level
   command contains the pane's exact provider and conversation ID is recovered.
   Writing a resume command, seeing old scrollback, or finding any provider
   descendant is never sufficient.
10. For a daemon-owned pane, the daemon's exact session ID to root PID mapping is
    the live process authority. Recovery inspects that PID's process tree and
    requires one unambiguous top-level provider resume command. The inherited
    pane environment marker is a fallback for hand-started agents, not a
    prerequisite for recognizing older live sessions.

The strongest proof is a real restart/shutdown-style test that kills only the
UI, preserves the daemon, then exercises cold daemon recovery and provider
resume. Source tests and dry-run plans are supporting evidence, not proof of
the installed dock runtime.

## Failure triage order

Do not patch the first visible symptom. Trace one preserved pane through these
boundaries and stop at the first mismatch:

1. **Installed provenance** — `npm run verify:installed-release` must prove the
   dock symlink, binary checksum, and post-Tauri frontend tree checksum match the
   current verified build. An internally consistent older release is a failure.
2. **Saved authority** — the pane must exist in `workspace.json` under its stable
   `terminal-<tabId>-<paneId>` identity. `recovered-tab-*` is legacy inventory,
   never permission to restore or a durable pane identity.
3. **Close authority** — neither the pane identity nor its provider conversation
   ID may appear in the exact close tombstones. Do not substitute cwd, title,
   provider name, age, or daemon presence.
4. **Conversation identity** — prefer the pane's durable manifest binding. A
   pane-keyed sidecar may seed a missing binding only after the exact provider
   conversation is confirmed live; nested inherited-pane status cannot replace
   an existing binding. Ambiguous or missing evidence fails closed.
5. **Writer ownership** — a live provider process or writer lock means
   `owned_elsewhere`, never a second resume.
6. **Provider-live receipt** — after resume injection, the pane's top-level
   provider process must stably report the exact `codex resume <id>` or
   `claude --resume <id>` identity. A command write, live PTY, bash process,
   matching daemon ID, nested provider, or replayed scrollback is not recovery.
7. **Visible acceptance** — launch from the dock and inspect every preserved pane.
   Each must visibly contain its prior conversation; every explicitly killed
   pane must be absent. Record the pane matrix before challenge review.

The controlling issue records are `TF-017` (exact provider recovery) and
`TF-019` (dock restart/visual acceptance). Keep them in `verifying` until the
installed pane matrix, challenge-loop PASS, and final Sure HIGH/PASS all exist.

## Known false-positive pattern

`npm run tauri build` runs its own frontend build. The release manifest must hash
`dist/` only after that build completes. Hashing the earlier frontend build can
label one asset tree while the binary embeds another. The installed verifier
must compare against the current post-Tauri tree so an older dock binary cannot
pass merely because its own manifest is internally consistent.
