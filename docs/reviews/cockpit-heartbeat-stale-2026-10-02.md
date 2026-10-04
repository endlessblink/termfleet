# cockpit-heartbeat-stale at 19:55 IDT — investigation (2026-10-02, read-only)

Nothing in the app was restarted, killed or modified. Times are Asia/Jerusalem (IDT).

## What the alert is
`scripts/termfleet-pressure-watchdog.sh` (line 272) flags `cockpit-heartbeat-stale` when the desktop is older than 60 s **and** the mtime of `agent-status/termfleet-cockpit-snapshot.json` is 45 s or more old. That file is the renderer's heartbeat: `src/lib/cockpitSnapshot.ts` meant to write it about every 10 s (`COCKPIT_SNAPSHOT_HEARTBEAT_MS`) via the Tauri command `cockpit_snapshot_write` (temp file + rename + append to `cockpit-header-trace.jsonl`). With `TERMFLEET_PRESSURE_WATCHDOG_RECOVER=1` the watchdog does `kill -- -<pgid>` on the desktop group and runs the launcher.

## Timeline
| Time | Event |
|---|---|
| 19:46:25 | Previous desktop exited cleanly (`close_requested`, exit 0); relaunch 19:46:28 as pid 1730900 (pgid 1730877), release `5eb2b7fbba63…` |
| 19:47–19:54 | Normal: snapshot written every 2.8 s median (p90 7.2 s); renderer ~20–30 % of a core |
| **19:54:43** | **Last snapshot write by that desktop** |
| 19:54:46–19:55:29 | Process alive, not blocked: UI thread and WebKit renderer in `S`, CPU ticks still rising (~8 % of a core). No `D` state, no OOM, no kernel messages, no crash |
| **19:55:32** | Watchdog: heartbeat 46 s ≥ 45 s, desktop age 540 s → alert, audit, `desktop_recovery`, kill of group 1730877, launcher run; relaunch logged 19:55:33 (pid 1891495) |
| 19:55:38 | `pressure_cleared` — only because the new desktop was 4 s old (inside the 60 s grace), snapshot file still the old one (age 55 s) |
| 19:56:40 | `pressure_started` again: new desktop age 63 s, snapshot age 114 s |
| 19:57:52 | New desktop's **first** snapshot write (139 s after start). 19:57:55 cleared. Healthy since (snapshot age 1–4 s at 19:58) |

The second alert did not trigger a second kill only because of the 300 s alert cooldown / unchanged signature; the next eligible time would have been ~20:00:32.

## Did recovery work?
Yes, mechanically: the old desktop group was recycled, the daemon (pid 1515447, 2264 PIDs, 24.6 GB cgroup memory at 19:55) was preserved, and a new desktop is running and writing the snapshot. It needed 139 s to produce its first snapshot, during which the watchdog already saw it as stale again.

## Is it a false positive / race?
Partly, in three ways:

1. **Odd numbers explained.** `desktop_age_seconds=540` is the age of the desktop that was launched at 19:46:32. `heartbeat_age_seconds=46` is the age of the snapshot file *mtime*, not the process. They are unrelated clocks, so 540 vs 46 is not an inconsistency. 46 is exactly one poll after the 45 s limit: a stall of about 49 s (19:54:43 → 19:55:32) was enough.
2. **The stall was real, not a clock artefact.** The trace file has no write between 19:54:43 and 19:57:52. But the renderer was not "blocked" in the OS sense (no `D`, CPU advancing); its heartbeat timer or the `invoke("cockpit_snapshot_write")` path simply did not complete for ~50 s. The alert text "renderer is blocked" is an inference from file age.
3. **Relaunch race (genuine bug).** A relaunch keeps the old snapshot file, so the new desktop starts with an already-stale heartbeat. The 60 s startup grace is shorter than the real first-write latency (139 s here), so every recycle is immediately followed by a new `pressure_started`. Only the cooldown prevents a recycle loop.

Also: an earlier identical alert fired at 16:57:29 (desktop age 79 602 s ≈ 22 h, heartbeat 45 s), so this is the second recycle in three hours, both at the threshold.

## Likely cause of the stall (evidence, not proof)
- **Sustained host I/O pressure:** `/proc/pressure/io` full avg10 ≈ 10 %, avg300 ≈ 6.5 % at the time (audit: io_full 7.6 %), swap 45–47 GiB of 59 GiB used (≈ 10.6 GiB of it Firefox "Isolated" processes, 3.7 GiB node, 2.7 GiB lean-ctx), `bo` in the tens of MB/s. Disk `/data` 83 % full.
- **The heartbeat's write path does I/O in a huge directory:** `agent-status/` holds **21 831 entries / 4.9 GB**, of which **20 309 are `termfleet-pane-native-*.png` captures that are never pruned**; the directory file itself is 2.6 MB. Each heartbeat creates a temp file and renames it inside that directory, then appends ~50 KB to a trace file that rotates at 25 MB (`.1` was 26 MB, rotated 19:52). Under swap/I/O pressure a rename or open in such a directory can take many seconds, and the Tauri command is synchronous Rust (no timeout, no async).
- The 25 MB trace rotation happened at 19:52, two minutes before the stall (it deletes and renames a 26 MB file); possible contributor, unproven.
- Daemon: 24.6 GB cgroup memory (10.5 GB at 16:57), 2264 PIDs, `memory.high` event counter 2562 (unchanged during the incident, so no new throttling). Pane health at 19:44: expected 16, live 13, unknown 3 — unrelated to the heartbeat but shows load.

## Relation to existing tasks
Fits the long-uptime/leak group: unbounded `agent-status` growth is the retention gap (TC-078, TC-093, TC-096 cover sidecar/session retention but not the pane PNGs or the trace), and the watchdog's thresholds are the kind of status-contract fragility TC-170…TC-188 describe. No snapshot-size growth: the snapshot itself is only 48–55 KB.

## What to do (see TC-199, TC-200)
- Make the heartbeat independent of the big directory and of the renderer's write latency: write the heartbeat to its own small directory, from a timer that cannot be starved, and make the Tauri command async with a deadline.
- Make the watchdog robust: require several consecutive stale samples or ≥ 90 s, reset/ignore the snapshot mtime across a relaunch (compare against the new desktop's start time), grace ≥ 180 s, and report "snapshot not updated" instead of "renderer is blocked" unless the renderer is actually in `D`/zero CPU.
- Prune `termfleet-pane-native-*.png` and cap the trace.
