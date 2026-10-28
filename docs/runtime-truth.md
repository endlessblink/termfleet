# Runtime truth — read this before diagnosing anything

## Private ImagineBox workspace routing (2026-10-28)

Owner access: https://endlessblink.tail07658e.ts.net:8810/ requires an authenticated device on the existing Tailscale network. Keep the home computer awake; live camera controls also require Blender and its linked project. TermControl separately uses its existing password-protected https://control.in-theflow.com/ and needs no VPN.

Three linked/enabled user units are maintained in `scripts/workspace-access/`: `imaginebox-workspace.service` serves the existing project on loopback8810; `imaginebox-private-proxy.service` adapts private HTTPS8810 through loopback8811; `imaginebox-studio-private-proxy.service` adapts private HTTPS8812 through loopback8813. Studio discovery follows the app's currently linked local Blender port, restricted to8765–8784. Check `systemctl --user status` for those units and `tailscale serve status`;8810 and8812 must remain tailnet-only. Never put these adapters behind a public proxy or Funnel. They require Tailscale's user header, exact Host and same-origin writes and retain the app's action tokens.

Rollback only this routing with `tailscale serve --https=8810 off` and `tailscale serve --https=8812 off`, then `systemctl --user disable --now imaginebox-private-proxy.service imaginebox-studio-private-proxy.service imaginebox-workspace.service`. Do not change other Serve routes or stop TermControl/the terminal daemon. Login-start configuration is enabled; a real reboot and school-network access have not been trialled.

Where the app's real state lives, and which sources lie. Every entry exists
because an agent reported something false by reading the wrong one.

## 1. Ask the daemon what is running. Never the saved files.

```bash
node scripts/termfleetctl.mjs status --json          # daemon pid, build id, counts
node scripts/termfleetctl.mjs sessions list --json   # sessions; `sources` contains "live" for running ones
```

A live session's `command` is what its pane is actually running right now
(`/bin/bash`, `codex resume <id>`, `claude --resume <id>`).

**Do not** judge "did this pane come back?" from
`~/.local/share/terminal-workspace/sessions/*.meta.json` or `.scrollback`. Those
are flushed lazily, so shortly after a relaunch they still describe the
*previous* run — including a stale `restoreStatus` and `restoreFailureReason`.
Reading them is how two working, resumed panes were reported as broken.

Use the persisted files only for panes with **no** live session, or to read a
conversation id.

## 2. A new release does not reach the terminals until the daemon is stopped

`daemon_ensure_running` reuses any reachable daemon **regardless of build id**
(`daemon.rs`) — deliberately, because replacing it kills the operator's live
agents. So:

- `npm run release:install` + relaunching from the dock changes the **window
  only**. Backend fixes (`pty.rs`, `daemon.rs`, restore/resume logic) keep
  running the OLD code.
- To exercise a daemon-side fix the daemon process must end: stop the app and
  the `termfleet --terminal-workspace-daemon` process, or reboot.
- Check before believing anything: daemon start time vs release promotion time.

This cost a full round of "the fix is installed" / "it behaves exactly the same".

**Stop it with `npm run stop:all`, never by hand.** That script SIGTERMs (then
SIGKILLs) every owning process, verifies they are gone, and refuses to report
success while the socket still answers. It never unlinks the socket: deleting a
socket whose daemon was still alive is what produced a daemon split-brain — two
daemons, two socket listeners, and every running agent unreachable from the app.
A stale socket file is fine; the launcher connects, is refused, and proceeds.

## 3. Logs that already exist

| What | Where |
| --- | --- |
| Structured incidents (launch, exit, watchdog recovery, pressure; pruned to the latest two calendar days on first daily write) | `~/.local/state/termfleet/incidents.jsonl` |
| Five-second desktop CPU, pressure, and top-three UI/WebKit thread summaries (thread ID, state, CPU share, wait channel; automatic 48-hour retention) | `~/.local/state/termfleet/desktop-samples-YYYY-MM-DD.tsv` |
| Standalone five-second process/pressure sampler when the installed watchdog is stale; timing/state only, pruned after 48 hours | `/tmp/termfleet-performance/desktop-samples-YYYY-MM-DD.tsv`; verify with `npm run verify:performance-sampler` |
| Watchdog progress stage, atomically refreshed in runtime memory; copied into each pre-recycle snapshot | `$XDG_RUNTIME_DIR/termfleet/pressure-watchdog.heartbeat` and `watchdog-heartbeat.txt` |
| Canvas drag, resize, and layout summaries (at most one record per second, with bounded affected-node IDs and source counts) | `/tmp/terminal-workspace-geometry.jsonl` (`kind=canvas-node-movement`) |
| Human incident summary (same two-day pruning policy) | `~/.local/state/termfleet/incident-summary.md` |
| Launcher decisions + daemon startup | `~/.local/state/termfleet/desktop-launch.log` |
| The cockpit's own stdout/stderr | `~/.local/state/termfleet/app-output.log` (+ `.1`) |
| Per-pane agent status sidecars | `~/.local/share/terminal-workspace/agent-status/` |
| Live cockpit health poll | `agent-status/termfleet-pane-health.json` |
| Content-free renderer stalls, terminal interaction timings, map camera changes, and coalesced terminal movement sources | `/tmp/terminal-workspace-geometry.jsonl` (expires after two days of inactivity; rotates above 8 MiB, keeps the latest 1 MiB) |
| Opt-in Rust terminal input timing events (pane ID, byte count, sequence IDs only) | `/tmp/terminal-workspace-latency-trace-<pid>-<thread>.jsonl` (each file rotates at 1 MiB; files older than two days are pruned on first write) |

A clean exit is recorded as `desktop_exit ... status=0 daemon=preserved`. A
watchdog-forced restart is `desktop_recovery` — an exit with no recovery event
means nothing killed it.

The pressure watchdog appends one compact row every five seconds, including
while the desktop is absent or being replaced. It records process states and
cumulative CPU ticks for the desktop/WebKit processes when present, plus host
and desktop-cgroup CPU/I/O pressure and bounded summaries of each process's top
three CPU threads (thread ID, state, CPU share, wait channel). An absent desktop
is explicit in the row, so a quiet log can be distinguished from a missing app. These samples contain
  no terminal content and are pruned after 48 hours. Incident JSONL and its
  Markdown summary are pruned to the latest two calendar days on the first
  incident write each day.

The renderer log records only stall durations, batched input-to-render timing
percentiles, geometry, committed camera changes, and movement-source counts. New
browser and Rust input traces retain byte counts and key categories, never typed
text or terminal output. The geometry log expires after two days of inactivity and
rotates above 8 MiB; each opt-in Rust trace file rotates at 1 MiB, and old trace
files are pruned after two days.

**Still not covered:** a stall where the process looks healthy but the UI is not
painting. The pressure watchdog samples every 5s and catches a *blocked*
process, not a busy one. Detecting that needs a heartbeat from the app itself.

## 4. Agent resume rules (TC-054 lineage)

- Recovery is **per pane**, never per folder. The durable key is
  `terminal-<tabId>-<paneId>`; the conversation id lives in that pane's sidecar.
- On cold restore, a pane whose checkpoint is an agent terminal is respawned
  **directly into** `codex resume` / `claude --resume` / `opencode --session`.
  Resume commands are never typed into a live terminal — that pastes visible
  junk and can produce a second writer.
- Duplicate writers are prevented downstream, not by refusing to resume:
  `provider_writer_is_alive` plus an on-disk `flock` resume lock.
- A recorded `resume-failed` is only sticky when the failure is **terminal**
  (the saved conversation is gone, or the operator quit the agent). Ownership or
  policy refusals must be retried — after a reboot the previous owner is dead,
  and a sticky refusal means the pane never comes back.
- A resumed agent that exits cleanly after running a while was quit by the
  operator: the pane comes back as a plain shell, not another resume. Otherwise
  `/exit` relaunches the agent instantly.

## 5. Verifying a recovery claim

Never say "fixed" from tests alone. The acceptance surface is the dock-launched
app, pane by pane:

```bash
npm run verify:reboot-rehearsal   # per-pane verdict from copies of live checkpoints
npm run doctor                    # status pipeline health
node scripts/termfleetctl.mjs sessions list --json   # what is live right now
```

## TC-199 desktop liveness (activated and verified 2026-10-04)

The desktop writes a tiny, content-free heartbeat every 10 s to
`$XDG_RUNTIME_DIR/termfleet/cockpit-heartbeat-<desktop-pid>`, independently of
pane mounts and content snapshot writes. The writer is atomic and owner-only.
The watchdog prefers this per-PID file, falling back to the content snapshot for
older installed desktops. Only a write strictly after the selected desktop's
start counts. Missing, older or future-dated files are unknown, not a recycle
trigger; independent blocked/missing-process rules still apply.

Defaults are 180 s startup grace, 90 s staleness and three consecutive stale
polls. CPU progress gives 180 s staleness grace. A fresh write or a different
desktop resets the streak. Snapshot content writes run on a blocking worker,
with a 3 s caller deadline and a worker-owned single-flight guard; a deadline
never releases the guard before the worker finishes. The independent heartbeat
has a separate single-flight guard. Verify the installed watcher script inode
and current desktop heartbeat before claiming the source change is active.

Initial scoped acceptance: candidate `98d2508ebff6-8a596f5f9d5e-b23b2b7ff1e9` ran as UI1656110 with the expected binary checksum and a fresh per-PID heartbeat beyond startup grace. Watchdog1655916 executes the current script inode/hash. Daemon18932 and all29 session IDs/PTY PIDs survive unchanged. Canonical installed-release verification passes against archived frontend provenance. The broad doctor still compares against a different primary target build and reports one artifact mismatch; do not call that diagnostic fully green. Evidence is in the TC-199 activation report.

Current accepted unified release (2026-10-04): release `b4ecac5f18ea-9e0b177f1906-9b58af6507ab`; source `b4ecac5f18ea18e57dfb62c0bde456c022e2ee96`; UI4142165; binary SHA256 `9e0b177f190608ff7a07023761079ae48ef191e05aa7b6a7a441f079758b7522`; watchdog4133321; daemon18932; all32 original PTY IDs/PIDs preserved. Target, installed file and running executable match; canonical installed verification and host doctor pass. Runtime source revision is the clean b4ecac5 implementation/test/documentation tree; its later evidence-only receipt is not a new embedded runtime revision. The exact32 before-install session IDs/PTY PIDs are preserved, and daemon18932 was not restarted. Current per-PID heartbeat advances beyond startup grace. Recovery/archive decisions and repeat proof are in `docs/git-reconciliation-tc201.md`.

### Automatic-action pause candidate (TF-143, not activated)

The bridge candidate reads `automatic-actions.paused` in its existing TermControl
configuration directory, or `TC_PAUSE_AUTOMATIC_ACTIONS=1`. Presence or an
unreadable marker prevents admission of automatic cleanup, sleep, recovery,
held-message passes, room/routine polling, retries, startup resume and canary
runs. Cleanup close, helper nudge and health recovery callbacks also recheck
immediately before their guarded effects. Graceful shutdown latches that pause
before awaiting bot replies. Existing manual routes retain their own guards.

The marker has no timeout. Removing the exact maintenance marker reverses its
admission pause; a shutdown latch lasts until process exit. Do not remove an
unknown marker or resume automatic work as part of a read check. No marker has
been created on the live service for this candidate.

**Paused does not mean quiescent.** Already-issued daemon requests, an already
running canary, an admitted held/room/routine operation, internal bot
continuations and existing health subprocesses are not cancelled or proved
settled. Status explicitly reports `quiescence_verified: false`. In-flight
scheduled delivery is not converted into an artificial failure or consumed by a
globally guarded manual-send callback. No universal no-model or no-input claim
is supported by this candidate.

The current legacy process cannot observe this new marker. Its graceful drain
tracks bot replies and HTTP requests, not all automatic jobs/outbound effects.
An idle bot/queue snapshot and startup environment changes therefore cannot
certify its first reload. Activation remains gated on a source-backed legacy
bootstrap/settlement mechanism; no such mechanism was found in the existing
service. Do not restart the daemon, inject terminal input, hot-patch the process,
or infer permission to accept that gap. After a coordinated bootstrap is proven,
start with the marker already present, read authenticated pause status and the
loaded digest, preserve every terminal/bot identity and queue, and verify older
unanswered questions by read-only navigation before resuming automatic work.


TF-143 registered-drain extension (source only): scheduled automatic roots now
register synchronously before invocation and remain visible through their returned
promise. The maintenance handshake persists the pause, cancels registered timers,
closes admission to bot replies and saves original queued messages without ending
an active reply or side responder. Queue read/write failures retain the original
in-memory prefix; repeated successful saves preserve duplicates and arrival order.
This existing atomic-rename writer does not establish power-loss durability.

Pending operation metadata is fsynced before a registered callback starts; it
contains a label/reference, never message words. Individual automatic held, room
and routine deliveries now register stable source/target references before their
child effect starts. A completed parent callback does not retire its child.
Verified receipt means settled; explicit not-sent means failed-before-effect;
unknown, thrown, interrupted or unverified terminal typing means uncertain.
Uncertain records block admission and drain certification across reconstruction,
without reclaim, retry or replay. A receipt persistence failure retains the
original pending record: temporary-file creation and rename failures are covered.

For bots, settlement proves the exact original text was accepted as an operator
chat row, not that a model read or understood it. Held settlement uses its existing
validated receipt. Terminal `ok`/`delivered` alone is not receipt proof. Only the
automatic poll/tick routes use the new room/routine adapter; manual callbacks keep
their original behavior. Completed metadata is capped at 100 in memory/status,
with an explicit omitted count; all pending records and disk receipts are retained.
Disk receipt retention is not bounded by this candidate.

Status separates callback completion, individual delivery settlement and global
work settlement. Other automatic effects remain partially instrumented, so
`registered_work_settled`, `restart_boundary_proven` and `quiescence_verified`
remain false. This is source-only coverage, not a universal drain guarantee.

The candidate has a cooperative SIGUSR2 maintenance handshake; ONLY a process whose
exact loaded protocol and PID have been verified may receive it. **Never send
SIGUSR2 to the current legacy bridge: it has no handler and would terminate.**
The loaded service properties were read using the native user bus:
`TimeoutStopUSec=5min 30s`, `KillMode=mixed`, `KillSignal=15`, `Restart=always`.
This finite forced-stop window is not a drain proof; SIGTERM alone does not wait
for all automatic work, nor cancel the legacy timers. No supported legacy
cooperative pause/settlement hook was found. Changing the next process environment
or observing idle queues cannot add it to the current process. First activation
therefore still lacks an in-process legacy pause plus outstanding-effect
settlement capability; it cannot be bootstrapped by signalling the new handler.
No live signal, marker mutation or reload has been performed.

Disposable bridge verification uses its own config, synthetic account and fake
daemon. It persists a pause, observes timer cancellation and callback status,
preserves queued duplicate words and chat bytes, retains an original open question
past 310 later messages, and jumps to that exact question at 390/1400 widths with
answer/send requests blocked. This is not production older-history or human-owner
proof. Existing signed-in embed-session reads likewise are not human authentication.

TF-143 individual-receipt follow-up: actual 136/136 checks passed in
`/tmp/termfleet-delivery-accounting-final.tap`; focused 35/35 in
`/tmp/termfleet-delivery-accounting-focused.tap`. Separate processes prove a parent
callback can finish before its delivery settles or becomes uncertain. The broader
restart fixture now establishes the fake runner first, using the real caller
issuer/validator with its existing private test-store option. The original fixture
failed before runner start; it had used the host caller store. The corrected five
restart checks retain the actual drain/queue assertions and use no real provider.

Read-only GET at 2026-10-28T11:34:06Z in
`/tmp/termfleet-delivery-accounting-runtime.json` still observes PID2252271 loaded
18-module8d3ea43cbb73, exactly reconstructible from commit35c9acd; frozen disk is
24-module03134943ffbee709bb946beed7e7715c47a0a2afd6c42e4fcfc17ee07ad43107.
The old source waits bot shutdown but neither cancels automatic timers nor exposes
outstanding-effect settlement. Host signal inspection confirmed TERM/INT handlers
and no USR2 handler. No live signal or reload was attempted. The exact minimum
first-deployment gate is a platform-authorized legacy bootstrap that stops old
admission/timers and accounts for every already-issued effect before TERM; no
existing service, HTTP or signal surface supplies it. A new process's receipt
protocol is not retroactive. A separately authorized controlled legacy migration
and explicit reconciliation boundary are required before first activation; this
is separate from the unanswered isolation approval. Production older-question
retention/navigation and human-owner UI remain unverified.

#### Legacy first-deployment inventory and migration decision (TF-143)

This inventory is for **PID2252271, loaded18-module digest8d3ea43cbb73**,
reconstructed exactly from35c9acd. It does not describe the newer source as
already loaded. Read-only host observation at2026-10-28T12:05:25Z still found
that Node process:39 descriptors,16 sockets,8 pipes,11 threads, sleeping kernel
state. None of those observations measures pending JavaScript callbacks or
acknowledges downstream effects. Artifact:
`/tmp/termfleet-legacy-bootstrap-observation.json`.

**1. Existing controls and their actual scope**

| Control on the old process | Can prevent | Cannot establish |
| --- | --- | --- |
| Existing sleep settings `enabled:false`, read by subsequent sleep sweeps | Future sleep decisions after the setting is observed | Cancellation of a sweep already past its decision, cleanup closes, recovery typing, routines, rooms or held delivery |
| Disable an individual routine through its existing update route | Subsequent ticks selecting that routine | Cancellation of an already selected occurrence; re-enabling also affects scheduling, so it is not a transparent global pause |
| HTTP ingress block or listener closure | New HTTP requests through that ingress | Internal timers, existing requests, loopback alternatives, daemon connections or desktop file requests |
| SIGTERM/SIGINT graceful shutdown | `Bots.closing` stops new brain drains; existing bot runs get their bounded finish window, followed by queue save | Global admission stop, automatic timer cancellation, outstanding-effect settlement, or a durable queue-checkpoint acknowledgement before exit |
| `TC_NO_*`/`TC_CONFIG_DIR` flags in next service start | Selected producers in the next process | Reconfiguration of flags already captured by this process; changing disk code/environment is not a live control |
| New pause marker/SIGUSR2 protocol on disk | Nothing in this old process | It has no SIGUSR2 handler; sending that signal is not a bootstrap operation |
| Disable socket access or rename its path | At most some future connections | Existing connected descriptors, already queued consumer operations or the independent desktop close-request channel; also affects unrelated daemon users |
| Stop/freeze the whole process externally | Further scheduling while stopped/frozen | Durable memory queues, settlement of effects already issued, or their outcome; resuming restarts the same producers |

No control in this inventory is a complete reversible admission boundary. No
setting, signal, socket, service or terminal was changed during diagnosis.

**2. What existing evidence can and cannot reconcile**

* Durable `send-receipts` reservations/outcomes and pane locks can identify a
  particular guarded HTTP draft. A finished uncertain outcome stays uncertain;
  an absent reservation is not proof about callers that bypass `sendOnce`.
  The old server wraps the phone send/answer routes, not all routine/recovery
  calls. The read-only observation found zero JSON receipts and zero pane locks
  in the configured default directory, not zero outstanding automatic effects.
* Existing SQL delivery evidence can settle a recorded delivery only when its
  exact session/input marker was captured. The existing scanner reads provider
  records; it was not run here because this investigation excludes private
  transcripts. Existing metadata may be inspected without scanning records,
  but missing rows cannot prove non-delivery or identify every issued action.
* Held queue/inflight/quarantine records retain original intent and known
  uncertainty. They are not receipts for unrelated direct sends. This
  observation enumerated files only and did not read held message bodies.
* A matching desktop close result may explain its exact request while retained.
  `requestClose` consumes result files, and may then use a direct daemon kill
  fallback. Fourteen result files were present; their existence neither binds
  them to all current work nor accounts for consumed results. None was removed
  or used to perform a close.
* Routine `nextRunAt`/`lastResult`, room state, action logs, service logs, process
  descendants and daemon session existence are supporting observations. They
  lack a complete durable before-dispatch identifier/outcome for every effect.
  A missing process/socket/request or quiet kernel state is not an effect ACK.

The concrete rejected candidate was an external ingress/egress blocker followed
by reconciliation from those persisted records. Exact old-code disposable
diagnosis in `/tmp/termfleet-legacy-barrier-diagnosis.tap` establishes three
counterexamples: ingress closure leaves the routine timer dispatching; a
refused send still advances its original due occurrence; and two separate
processes leave byte-identical scheduler state when one has already applied a
synthetic file effect and the other has not. These are counterexamples, not
acceptance evidence or a live-terminal failure trial. Repeating the occurrence
can duplicate the first effect; skipping it can lose the second.

**3. Reviewable migration procedure and exact capability gate**

There is no current operator command that proves a no-loss/no-duplicate cutover
for this PID. This is a missing compatibility capability, not a request for
permission to do an ordinary reversible reload. The pending credential/isolation
approval is unrelated and cannot authorize or repair it.

1. Preserve the loaded revision/PID, original daemon/pane/bot identities and
   existing receipt metadata as the baseline. Stage the replacement with its
   startup pause already set; do not start it against the live state yet.
2. A platform maintainer must supply a **supported legacy compatibility hook**
   that runs inside this exact process: stop every automatic root's admission,
   cancel its timers, stop bot queue consumers, and durably checkpoint each
   queue entry in original order with duplicate entries distinct. Its ACK must
   bind old PID/revision, checkpoint hashes/counts, retained target identities,
   active callbacks and individual outstanding effects. It must not answer,
   send, close, replay or discard anything. A file marker read only by the new
   source does not implement this hook. No inspector/ptrace injection or live
   code replacement is presently supported or authorized as that mechanism.
3. Pair the hook with a consumer-side fence that covers **this producer's**
   daemon writes/kills and desktop close requests, including existing
   connections. It must report accepted-but-pending requests and their final
   outcomes by stable operation ID while retaining refused intents. The
   current daemon status protocol does not provide that per-producer fence;
   changing the running daemon is outside this task. Global socket blocking
   is not an equivalent implementation.
4. Reconcile every previously issued operation using original request/result
   metadata. Record settled, failed-before-effect and uncertain separately.
   Retain unknown operations without replay. If an old operation lacks both an
   identity and an outcome, neither a new journal nor manual inspection of a
   quiet pane can reconstruct it reliably: certification must stop there.
5. Only after an acknowledged durable queue checkpoint and zero unresolved
   old effects may the existing graceful bridge-only stop/start run. Preserve
   daemon2068834. Verify the new process starts paused, the reviewed loaded
   digest matches, queue ordering/duplicates and all identities match, and no
   original question or answer-control identity changed. Do not let a finite
   systemd timeout substitute for that ACK. Re-enable producers only after
   these readbacks pass.
6. Read back an older still-open question from the loaded backend and jump to
   its exact original message at phone/desktop widths through the authenticated
   surface, with answer requests blocked. Until then R19768 remains partial.

Steps2–4 are unavailable on this legacy process today. Implementing a new broker
alone cannot retroactively recover absent old receipts or in-memory queues.
The alternative is an **explicit owner-authorized maintenance exception** accepting
that some uncheckpointed work may be lost or left uncertain, with affected work
retained for later manual reconciliation and no automatic replay; that would
relax the present requirements and is not requested or assumed here. No such
exception, terminal experiment or restart has been performed. Under the current
constraints the exact external gate is delivery of the legacy checkpoint plus
consumer-fence capability and reconciliation of its unknowns, rather than
another ordinary restart approval.

#### UI-only older-question alternative (TF-141, bounded readback)

At2026-10-28T12:11:24Z the existing authenticated GET surface still reported
PID2252271/digest8d3ea43cbb73. `/api/bot/history` and `/api/bot/messages` both
returned404 `not found`; there is no corresponding route in that exact loaded
server. `/api/bot` ignores `before`, `offset` and `limit`: it calls `bots.view(id)`
without a history parameter. That method retains300 newest rows plus older
unsettled terminal-ask rows, but not older bot question cards. Its exact extracted
method, run only on disposable synthetic messages, omits an original question
that demonstrably remains stored and returns the old terminal prompt.

`/api/search` is not a substitute: the route accepts only a200-character query;
search is capped at4 hits per bot/12 overall and returns timestamp, speaker and a
400-character text snippet. It has no original message ID, question/options,
answer link, withdrawal state, stable cursor or exhaustive enumeration. Structured
questions without searchable text need not appear at all. `/api/requirements`
enumerates owner requests, not bot question cards. Activity/inbox/group routes
likewise do not expose complete bot question history. `/api/local-file` is a
PC-only attachment import route, not phone-accessible chat pagination; no raw
transcript download, local-recovery impersonation or alternate file distribution
was attempted.

Read-only persisted metadata projection found35 older structured question rows
in the owning bot's4025 retained rows:26 have explicit answer links and9 do not.
This does **not** label those9 as open: full-history withdrawal/repetition checks
are still necessary. No original was found missing and then reconstructed; no
claim is made that deleted originals can be recovered. Metadata output contains
counts/identities only, not question words or private transcript content.

Evidence: `/tmp/termfleet-history-route-readback.json` (headless existing-session
GETs, root replaced with an inert document, all mutation/unrelated requests
blocked) and `/tmp/termfleet-history-capability.json` (exact old-method synthetic
diagnosis plus persisted metadata projection). These establish the route limit,
not completed owner-facing navigation or human-owner authentication.

The smallest delivery gate is **loading the already-saved TF141 `Bots.view`
change**: classify full retained history before truncating, prepend only original
still-open question rows, preserve their IDs/options and original answer routes.
It needs no new endpoint, service, task storage or scheduling change. The static
UI already derives its list and exact-message jump from those rows; it cannot
discover originals the loaded endpoint omits. Backend modules are imported once,
so refreshing already-served HTML cannot load that method. Under the present
no-restart/no-injection boundary, no supported UI-only route can finish the
all-retained-questions requirement. After the separately established bridge
cutover capability is available, verify the loaded retention method and exact
original-message navigation headlessly with all answers/mutations blocked before
marking R19768 ready. The broader audit is not an additional feature gate.

#### Pending maintenance review — preparation only, no permission received

Agent-Manager has asked the owner to choose preservation-first continuation or
preparation of a limited maintenance exception. The existing question is pending;
do not repeat it or interpret preparation as approval for cutover or replay.

Snapshot2026-10-28T12:15:58Z, `/tmp/termfleet-maintenance-review.json`: bridge
2252271/8d3ea43c; ten bots each have zero in-memory and persisted queued entries.
Botc0075cf70f9b is working with an inflight marker; the other nine have none.
No retry/provider-switch marker was observed. Six terminal ID/PID/run triples
and ten hashed conversation identities were recorded without message bodies.
Daemon2068834/build1:1792765418313 is unchanged. Pause marker absent; new journal
files0. **Old uncertain-effect count: unknown**, not zero. These observations are
a changing baseline, not a drain acknowledgement or a backup of message contents.

The following exact bridge-only sequence is reviewable but **not executed**.
First freeze reviewed source and coordinate shared ownership, then refresh the
read-only baseline. A working bot must finish naturally; do not interrupt it or
clear its markers. New arrivals/differences require review, not deletion/replay.

```bash
export XDG_RUNTIME_DIR=/run/user/1000
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet
git status --short
git rev-parse HEAD
node /tmp/termfleet-maintenance-review.mjs
systemctl --user show termcontrol.service -p MainPID -p ActiveState -p KillMode -p TimeoutStopUSec -p SendSIGKILL
```

The next block is **conditional mutation**, permitted only after a specific
maintenance decision accepts unresolved old effects. It exclusively creates the
new-source startup hold and a runtime override for this existing service, so the
old330-second stop deadline cannot force-kill an unfinished bot. Existing files
must be reviewed and retained; do not overwrite them or assume they are ours.

```bash
python3 - <<'PY'
import os,pathlib
files={
 pathlib.Path('/home/endlessblink/.config/termcontrol/automatic-actions.paused'):
 b'{"version":1,"kind":"maintenance-review"}\n',
 pathlib.Path('/run/user/1000/systemd/user/termcontrol.service.d/90-reviewed-question-maintenance.conf'):
 b'[Service]\nTimeoutStopSec=infinity\nSendSIGKILL=no\n'
}
for file,body in files.items():
    file.parent.mkdir(parents=True,exist_ok=True)
    fd=os.open(file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try: os.write(fd,body);os.fsync(fd)
    finally: os.close(fd)
    fd=os.open(file.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
PY
systemctl --user daemon-reload
systemctl --user show termcontrol.service -p TimeoutStopUSec -p SendSIGKILL
# Require infinity/no above before stopping; never force-kill a hung stop.
systemctl --user stop termcontrol.service
systemctl --user show termcontrol.service -p MainPID -p ActiveState
# Require MainPID=0 and inactive. Review persisted state before the next block.
```

This marker does not pause the old process: its timers can still issue effects
during shutdown. Removing the forced-kill limit protects only the shutdown wait;
neither protection settles unknown effects. If stop hangs, preserve state and
report that exact dependency; no SIGKILL, daemon restart or repeated cutover.
Record files newly created by this attempt separately from pre-existing holds.
While stopped, compare original queue/session metadata and preserve additions,
order, duplicate entries, held batches and uncertain receipts. Do not erase
inflight/retry state or copy private messages into this repository or reports.
Any separately authorized runtime backup must stay inside the private host
boundary with0600/0700 access. Metadata hashes alone cannot restore lost bodies.

```bash
# CONDITIONAL: only after stopped-state preservation review passes.
systemctl --user start termcontrol.service
systemctl --user show termcontrol.service -p MainPID -p ActiveState
node /tmp/termfleet-maintenance-review.mjs
```

Require the new loaded hash to match reviewed source, startup
`automatic_actions.paused:true`/`reason:maintenance marker`, unchanged daemon,
terminal ID/PID/run triples and bot conversation hashes, and retained queue
order/duplicates. New-source scheduled resume/retry, room/routine, cleanup,
recovery and canary work is guarded by that pause; manual HTTP sends are not
globally disabled and other effect coverage remains partial. Keep UI readback
headless and mutation-blocked; prove older original retention/navigation at
phone/desktop widths. Do not remove the pause marker or resume/replay work as
part of this review, even if navigation passes. Release of each created hold
requires reconciliation and must not remove pre-existing maintenance holds.

Rollback boundary: keep the hold and gracefully stop only the replacement bridge
if readback fails, preserving all new durable state. Do not automatically restart
old unpaused source, reset the shared checkout, or restore old queue files over
new arrivals. Code rollback cannot undo input/close, recover old process memory,
distinguish an unacknowledged applied send from an unapplied one, or recreate a
deleted original. The18-file old digest is not full dependency/runtime provenance;
35c9acd is a source reference, not an exact state backup. A compatible source/config
rollback needs separate review while retaining current durable state and the
pause. No no-loss guarantee is made and no conditional command above was run.

Status: **in_progress**, terminal open; existing owner maintenance-choice question
unanswered. No further viable preservation implementation for the uninstrumented
old process has been identified within the current constraints.
