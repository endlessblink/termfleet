# Automatic terminal recovery

TF-113 remains **verifying**, pending authorized activation and production proof.

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
Installed hook copies have not been updated or activated by this task.

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
sent that fixture SIGTERM so the runner could finish. No production process was
stopped. The first broad attempt timed out after240seconds without totals.


Disposable visual review inspected `/tmp/termcontrol-health-en-390-{top,recovery}.png`
and `/tmp/termcontrol-health-he-1600-{top,recovery}.png`; all are synthetic local
fixtures. No production visual or restart proof is claimed. `npm run doctor`
reports existing desktop/release age failures; this task does not promote or
restart the desktop release.

After explicit activation authorization, install the updated source status hooks,
verify the loaded bridge revision and
authenticated health report, then use one disposable real helper to prove exact
conversation/cwd/task/bot continuity and one-time recovery in the installed desktop.
Never run a conversation in two live panes. Test SQL SessionStart history separately
before claiming per-terminal injected history. This task has not deployed, restarted
services, changed trust handling or sent messages.
