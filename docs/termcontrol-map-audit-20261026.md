# Terminal map count investigation — 2026-10-26

State: `manual_action_required` for visual reproduction. TF-110 remains `reproducing`; no fix or deployment is claimed.

## Request and runtime boundary

Investigate the reported 51 desktop map terminals versus 9–10 TermControl terminals, and check whether live agents still use Claude. Registry reference `termcontrol` passed the path checker against SHA-256 `85b1b10558b7ffab0764bbd4ac28b2fd657d80e0b6e38953e96302dd7ac30918`. Identity and runtime surfaces were read before changes. The service is active as PID 1670314, started 2026-10-26 10:07:32 IST, and executes this checkout's `termcontrol/bridge/server.mjs`. The daemon is independently reachable as PID 2068834. Loaded module revision is unknown; disk HEAD alone is not proof of loaded code.

No service restart, deployment, provider switch, terminal close, workspace edit, or external message was performed. Initial user-bus inspection failed with `No medium found`; read-only retry with the existing `/run/user/1000/bus` succeeded. No credentials or raw transcripts were read.

## Sources and observed discrepancy

The desktop map renders canvas nodes from the workspace store and joins them to saved tabs. `normalizeCanvasState` removes duplicate/missing-tab nodes, but saved tabs are retained during daemon reconciliation: absent does not mean explicitly closed. A saved card can be starting, recoverable, or sleeping; deleting every absent PTY would lose those distinctions.

TermControl `buildCurrentPanes` reads saved workspace ownership, then daemon `liveness`, adds sleeping terminals, and calls `reconcileLivePanes`. Its list excludes exited/retired sessions and sessions without a saved owner. Agent status sidecars enrich identity/activity; they do not establish liveness. Lists and cards are therefore intentionally filtered differently, and card count alone is not live-terminal count.

At 2026-10-26 09:21 UTC the content-free identity audit found:

- 10 saved tabs and 10 map terminal cards, rather than 51.
- 10 daemon terminals; 9 are owned by current map cards and appear in reconciliation.
- One saved card, “Agent: Sidebar folders design”, is marked starting without a matching live PTY. Its tab is `a477c1a3-3bd2-4083-9554-8e6dcb3be8bf`; its terminal is `terminal-a477c1a3-3bd2-4083-9554-8e6dcb3be8bf-8d178a29-e7e8-4d0e-9eed-218f5637f496`. It is not explicitly retired. Absence alone does not authorize treating it as disposable.
- One live Codex PTY has no saved map card: `terminal-eec5d53e-1967-435a-a455-377cb0c66d74-14ebebe4-6faa-4103-88ec-f5f16cb4e20e`, PID 3631818, project politic-fighter. It is intentionally excluded by current ownership filtering.
- Adding the existing sleeping records did not change the nine owned reconciled identities.

The reported 51-card failure is not reproduced in saved state. No production candidate was selected from this evidence; no acceptance trial or speculative cleanup was run. A visual stale-window state cannot be inferred from disk.

## Provider check

`termfleet-team list` and process-derived `agentsByPane` both identify Claude for BLICH, MAIN VULT, and freelance-desk. Remaining listed agents use Codex. This proves provider identity, not the exact Claude model or whether those three conversations were intended to migrate. No conversations were interrupted or relaunched.

## Baseline evidence and next gate

`node --test termcontrol/test/inventory-parity.test.mjs termcontrol/test/layout-ownership.test.mjs` passed 7/7. These are baseline diagnosis checks, not approval evidence for a fix. The sanitized audit and helper scripts are `/tmp/tf-map-audit.json`, `/tmp/tf-map-audit.mjs`, and `/tmp/tf-map-detail.mjs`.

Computer-use inventory returned no apps and no browsers. Authenticated visual access to https://control.in-theflow.com and the actual desktop map is unavailable here. Next manual action: make the authenticated TermControl browser and the desktop map available for inspection, or provide their current counts and the stale card identity. Then repeat the identity comparison and select one concrete repair with a failing regression before editing production behavior. Do not mark TF-110 resolved from the current source tests.
