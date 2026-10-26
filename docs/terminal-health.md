# Automatic terminal recovery

TF-113 remains **verifying**, with recovery enabled and a successful live disposable recovery; authenticated visual proof is pending.

The bridge checks tracked workspace terminals every two minutes. It requires both
an absent process and SQL activity older than five minutes, plus five minutes of
continuous observed absence. A fresh independent provider-process scan and final
daemon/SQL recheck protect live conversations. SQL failure, uncertain ownership,
daemon failure, sleeping panes and intentional closes never authorize recovery.
The shared `stateOf` supplies the existing stuck state. A live but stuck process
stays open; silence alone never authorizes termination.

The workspace supplies the original task and working directory; the existing bot
helper assignment supplies the owner. An unfinished task resumes through the
daemon under the **same durable terminal ID**, using its exact provider conversation
and checkpoint. A process in another pane already owning that conversation blocks
recovery. Missing/mismatched checkpoint identity, missing scrollback and authentication
failures require attention instead of starting an empty conversation. The daemon
may synthesize its normal resume command when no saved command exists.

Helpers initially launch before a provider conversation ID is known. The source
status hooks now bind the first known top-level SessionStart or UserPromptSubmit
identity to its exact recoverable checkpoint, including matching working directory
and provider. Existing conversation bindings, nested agents and closed checkpoints
are protected. Restore/authentication failure fields remain unchanged. This uses
the existing daemon merge API; its preflight is not an atomic compare-and-set.
Installed hook copies were updated through the existing connector after explicit
authorization. The installer and release bundle now include the recovery helper
and its imports, plus the existing self-close helper required by status hooks.

Keeping the terminal ID also keeps its SQL events and bot assignment linked. The
recovery event includes `predecessor_terminal_id`, original session ID and recent
repository commit hashes. Those hashes show repository work exists; they do not
attribute commits to a particular terminal. Exact provider resume preserves the
conversation. The existing installed SessionStart SQL history hook is unfiltered
by terminal ID; its per-terminal history injection is **not proven by this change**.

Recovery is journaled before requesting a replacement and is never retried
automatically after failure or bridge restart. A new shell is not success: the
independent process inventory must find the exact original conversation. Otherwise
the state becomes attention-required after five minutes. Finished dead terminals
use the existing close-request path. No live process is force-killed by this feature.

Authenticated `GET /api/terminals/health` reports each terminal's status, reason,
task, owner, last activity and saved commits. Reading it never initiates repair.
The Health page explains checking, alive, stuck, sleeping, unknown, dead,
recovering, retired and blocked states; stale data is labeled. An older bridge
returning 404 hides this section. `TC_CONFIG_DIR` isolates test copies and disables
their repair timer; `TC_NO_TERMINAL_HEALTH=1` disables production automatic repair.

## Evidence and remaining gate

`npm run verify:terminal-health` passes30/30, including eight helper identity tests,
a real child process death,
temporary SQLite event history, crash-safe recovery journal, exact-owner confirmation,
commit discovery and English phone/Hebrew desktop fixtures. `npm run build` passes;
`npm run verify:termcontrol-mobile` passes31/31. Logs are
`/tmp/termcontrol-health-{tests,build,mobile}.log`.
Existing Codex/status-sidecar tests also pass93/93.

The full isolated TermControl suite finished694/708 with14 failures
(`/tmp/termcontrol-health-suite-final.log`), covering folder selection, bot provider
handover/window flow, Claude tool restrictions, voice setup, touch targets,
restart replies, reminders/watchdog, agent close guidance and worker deadlines.
An untouched main-copy baseline reproduces both touch-target failures
(`/tmp/termcontrol-health-head-baseline.log`). Other failures are not claimed to
be baseline-proven. The restart-reply test failed and left its isolated bridge
PID2010560 running; after verifying its unique test-only TC_CONFIG_DIR, this task
sent that fixture SIGTERM so the runner could finish. This broad test stopped no production process. The first broad attempt timed out after240seconds without totals.


Disposable visual review inspected `/tmp/termcontrol-health-en-390-{top,recovery}.png`
and `/tmp/termcontrol-health-he-1600-{top,recovery}.png`; all are synthetic local
fixtures. These images do not prove the production visual surface. `npm run doctor`
reports existing desktop/release age failures; this task does not promote or
restart the desktop release.

After explicit activation authorization, the existing hook connector installed the
updated copies; six relevant source/installed hashes match and both installed status
modules import successfully. Only `termcontrol.service` was restarted, at
2026-10-26 16:15:13 IST, PID2435587, direct checkout runtime; automatic repair is
enabled. The desktop and PTY daemon were not restarted. Evidence:
`/tmp/termfleet-health-activation.json`. The existing packaged-hook regression
failed before the dependency fix and passes2/2 afterward
(`/tmp/termfleet-health-bundle-{before,after}.log`); recovery tests pass30/30 again
(`/tmp/termfleet-health-activation-tests.log`).

A visible disposable Codex helper was spawned in a disposable git repository. Its
first prompt hook bound the exact conversation to `agent-terminal` recovery metadata.
After verifying its pane, working directory and process group, only that helper's
process group was killed abruptly. The automatic timer reopened the same pane with a new process (PID2629715) and
`codex resume 01a17892-49ff-7222-9c69-a94e9b5eceb3`. Independent process inventory
confirmed that exact conversation, and the recovery journal cleared only after
confirmation. Its pre-death context marker appeared in the restored history; SQL
recorded the predecessor ID and the disposable repository commit. The interrupted
turn remained at the input prompt: reopening preserves context but does not prove
automatic continuation of an interrupted tool call. Evidence:
`/tmp/termfleet-recovery-live-{before,killed,after}.json`. A post-recovery prompt
confirmed the marker. Its Stop hook then misclassified test harness instructions as
four owner requests and retried after a ledger-busy error; those test-only rows were
marked context and the verified disposable terminal was closed. This separate bug
is recorded as TF-115; recovery success does not prove hook completion reliability.
Browser
inventory returned zero apps/browsers, so authenticated visual confirmation remains
unavailable.

A separate read-only audit (`/tmp/termfleet-sql-hook-audit.json`) found that SQL
logging is automatic through the bridge but universal mandatory agent use is not
enforced. SQL hook registration covers Claude only; history injection is optional,
previously unfiltered and oldest-first, and metadata-only. Failures do not block agents.
Universal enforcement remains open; exact conversation resume must not be presented as proof
that every agent reads and writes SQL. No external messages were sent.

The bounded SessionStart gap is now corrected: the connector migrates only the known
legacy Claude history registration, preserves other hooks, and installs the packaged
exact-terminal history reader. Queries select the newest20 events explicitly and
display them chronologically; absent or ambiguous identity never falls back to global
or cwd history. Existing SQL callers retain ascending defaults. The installed hook
was invoked against the closed disposable recovery pane and returned its newest20
metadata events; its persisted recovery predecessor was independently checked (that
older event is outside the latest20 window). Evidence `/tmp/termfleet-sql-history-live.json`;
focused DB/hook/migration15/15 and packaged hook2/2 pass. Only the bridge was restarted,
latest PID2972951. This does not enforce SQL use universally or add transcript content.

The final broad-suite rerun timed out after300seconds (exit124), with537passing and17failing subtests and no final totals (`/tmp/termfleet-activation-full-suite.log`). No surviving full-suite runner was found afterward. Panel source and placement were subsequently activated in the same service only, PID2832317; `/tmp/termfleet-TF114-activation.json` records the exact source hashes and426unique active ledger rows, with no harness-wrapper rows.
