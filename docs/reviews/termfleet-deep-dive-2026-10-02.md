# TermFleet deep dive — 2026-10-02

Scope: read-only review of `devops/termfleet` (v0.2.2). Lenses requested: long-uptime soak, size control (retention/pruning), public-release readiness, and a Brainiac-in-TermFleet evaluation. Nothing was run against the live daemon, nothing deleted, nothing committed. Measurements were taken with `du`/`ls`/`stat`/`rg` only. Where I did not read the code that would prove a point, it is marked **(verify)**.

Supersedes the shallower `/workspace/termfleet-review-2026-10-02.md` (TC-078..TC-092 stay valid). New IDs continue at **TC-093**.

Legend: Impact H/M/L, Effort S (≤½ day) / M (1–3 days) / L (>3 days). Paths relative to `devops/termfleet` unless absolute.

---
## 0. Top 10 highest-leverage items (ranked)

| # | ID | Why it ranks here | Effort |
|---|----|--------------------|--------|
| 1 | TC-078 + TC-093 + TC-096 | ~44 GB of app-owned growth (+13 GB dev build) on a disk that is 83% full, and today nothing prunes it while the daemon is up. Retention policy + in-daemon janitor is the single biggest long-uptime risk. | M |
| 2 | TC-101 | `TMPDIR=~/.cache/termfleet/tmp` is exported to every PTY child (launcher line 77): **19 GB, 12,404 entries**, 580 MB staging dirs ×N. Not in TC-078 at all. | S–M |
| 3 | TC-124 | Persisted terminal content (scrollback, sessions, screenshots) lives in dirs `775` / files `664`: world-readable copies of everything typed/printed. Public-release blocker. | S |
| 4 | TC-095 | 20,099 PNG full-WebView captures (4.8 GB), no cleanup in the writer, no redaction, privacy-sensitive. | M |
| 5 | TC-109 | Unbounded `mpsc` per PTY subscriber (pty.rs:1440-1495, 1767-1771): one stuck UI/bridge consumer = unbounded daemon RSS. | M |
| 6 | TC-110 | `String::from_utf8_lossy` per 4 KB read (pty.rs:1052) corrupts Hebrew/CJK/emoji split across reads, in scrollback and in persisted files. | S |
| 7 | TC-111 | Idle poll storm: 200 ms per BoardNode, 250 ms per native pane, 1.2 s cwd poll per terminal, plus 1–10 s timers; forced software GL on top (TC-115). | M |
| 8 | TC-112 | Daemon has no panic hook / watchdog / restart policy; its transient unit has no `Restart=`; 43 `.lock().unwrap()` sites; daemon death = every PTY gone. | M |
| 9 | TC-080 (+TC-123, TC-125) | fs commands unconfined + loose CSP + bridge Host/Origin gaps. Must precede any public release or phone exposure. | S–M |
| 10 | TC-151 (Brainiac MVP) | Project index + dashboard panel is the cheapest differentiator and gives the janitor/registry a home. Do after 1–9. | M |

---
## 1. Architecture as read (what matters for the rest)

* **Two processes + helpers.** Tauri UI (React 19 + Zustand, Canvas2D terminal) and a separate Rust daemon (`terminal-workspace-daemon`, `src/bin`) that owns PTYs over a Unix socket. UI can restart without killing sessions. This is the product's best idea.
* **Daemon spawn** (`platform_process.rs:72-135`): transient `systemd-run --user --collect --unit=termfleet-daemon-<pid>` with `KillMode=mixed`, `MemoryHigh` (soft, deliberately no `MemoryMax`), `TasksMax`, `CPUWeight/IOWeight=200`; fallback is a plain detached spawn with `process_group(0)`. **No `Restart=`**, stdout/stderr of the spawner are `Stdio::null()`.
* **IPC** (`daemon.rs`): `PROTOCOL_VERSION: u16 = 1` (daemon.rs:23); accept loop does `thread::spawn` per connection (3 spawn sites in daemon.rs); `read_request_frame` 845-864; `SO_PEERCRED` same-UID check (`daemon_ipc.rs`, socket chmod 0600 at :17). Auth is sound for single-user local.
* **PTY core** (`pty.rs`, ~5.5k lines): `PtyManager`, `PtyOutputBuffer` (4 MB scrollback cap `MAX_SCROLLBACK_BYTES`, :23), persisted per session as `.scrollback/.meta.json/.lifecycle.json`, startup prune (:659 → :1682).
* **UI**: `workspace.ts` Zustand store (create at :3247, persistence at :5385-5420, mirrored to disk by `mirrorWorkspaceLayoutToDisk`); giant components: `MagicCanvas.tsx` 10,593 lines, `WorkbenchSidebar.tsx` 8,458, `SplitPane.tsx` 2,893, `Terminal.tsx` 2,734, `TerminalCanvas.tsx` 2,395 (35k lines of components). Only **1** `memo(` in all of `src/`; no list virtualization found.
* **Agent integration**: not screen-scraping only — hook scripts for Claude/Codex/opencode (`scripts/termfleet-*-status-hook.mjs`, shipped as Tauri `resources`, tauri.conf.json bundle.resources) write sidecar JSON into `agent-status/` (1,477 files). Good, adapter-shaped design; only Claude and Codex have bridge adapters (`termcontrol/bridge/adapters/`).
* **Phone bridge** (`termcontrol/bridge/*.mjs`, 2,336 lines, plain Node `http`, no framework): binds `127.0.0.1` by default, `TC_HOST=0.0.0.0` to open (server.mjs:3,37); scrypt accounts, signed cookie sessions, in-memory throttle.
* **Operations**: user-systemd timers already installed: reaper 15 min, doctor 1 h, memory-guard 2 min (`~/.config/systemd/user/termfleet-*.timer`); `termfleet-io-governor`, `-pressure-watchdog`, `-pane-screen-monitor`, `-host-pressure` services in `systemd/` (host tuning incl. `modprobe zswap` — personal-machine tuning, must not ship).
* **Storage governor already exists** for WebKit localStorage (`src/lib/storageGovernor.ts`, 212 lines; comment at :26 says the localStorage WAL reached ~96 MB on 2026-09-29). Today that WAL is still **97.7 MB**.

Positive notes worth preserving: `cockpit-header-trace.jsonl` *is* rotated (commands.rs:2793-2800, `MAX_TRACE_BYTES`, one `.1` generation); persisted-session prune exists with a test (pty.rs:5256); open-file limit is raised (`raise_open_file_limit`, daemon.rs:542-568); exit events share one poller (exitWatcher.ts) instead of one per terminal; Apache-2.0 LICENSE + SECURITY.md + CONTRIBUTING + CODE_OF_CONDUCT + `docs/public-release-checklist.md` exist.

---
## 2. SIZE CONTROL — full retention/pruning design (ranked high; extends TC-078)

### 2.1 Inventory of every growing store (measured 2026-10-02, this machine)

| Store | Path | Size / count | Grows by | Writer / existing cleanup | Class |
|---|---|---|---|---|---|
| Installed releases | `~/.local/share/termfleet/releases` | **18 GB / 989 dirs** (~19–22 MB each) | every `release:install` | `scripts/install-release.sh` – none | R |
| **TMPDIR sandbox** | `~/.cache/termfleet/tmp` | **19 GB / 12,404 entries** (2.0 GB `hyperframes-extract-cache`, `package-dir-staging-*` 580 MB each, 176 latency-trace, 152 `studtmp`, stray `.db`) | every PTY child that honours `$TMPDIR` | launcher exports it (`~/.local/share/termfleet/libexec/termfleet-desktop-launcher:15,77`); nothing sweeps it | T |
| Pane screenshots | `~/.local/share/terminal-workspace/agent-status/*.png` | **4.8 GB / 20,099 PNG** (oldest 2026-06-19) | each `capture_webview_snapshot` (webview_snapshot.rs:`output_path`, ms-stamped filename, never reused) from `cockpitSnapshot.ts:131`, `CockpitSnapshotProbe.tsx:190` (hourly) and the node pane-health monitor | writer has no cleanup | E |
| Agent-status sidecars | same dir `*.json` | 1,477 files, plus `cockpit-header-trace.jsonl` 8.6 MB (+`.1`) | per pane/cwd key, never removed on pane close **(verify)** | trace rotated; sidecars not | S |
| Saved sessions | `…/terminal-workspace/sessions` | **832 MB / 5,386 files** (~1,638 scrollbacks, largest 5.0 MB) | per terminal | startup-only age prune, 30 d (pty.rs:38,659,1682) | U |
| Session archive | `…/sessions-archive-20260831`, `sessions-stale-backup-20260531-235824` | **744 MB**, 192 KB | manual | none | A |
| Workspace backups | `…/workspace.json.before-*` | 51 files (62 entries in dir) | recovery tooling | none (TC-087) | A |
| Debug logs | `…/paste-debug.log{,.1,.before-*}` | ~0.9 MB now | per paste | one `.1`; `.before-*` never removed | L |
| Geometry/latency traces | `$TMPDIR/terminal-workspace-{geometry,latency}*` | in the 19 GB above | per session | `cleanup_stale_latency_trace_files` (commands.rs:947), `cleanup_expired_geometry_log` (:1012) — only for their own names | L |
| WebKit data dir | `~/.local/share/io.github.endlessblink.termfleet` | **1.1 GB** incl. `localstorage/*.localstorage-wal` **97.7 MB**, `WebKitCache` (blobs ≤8.6 MB) | page loads, localStorage writes | `storageGovernor.ts` throttles writes; no checkpoint/VACUUM/cache cap | W |
| SQLite | WebKit localStorage + `hsts-storage.sqlite` only; stray `*.db` copies in TMPDIR | see above | — | TermFleet owns **no** app SQLite today | W |
| Crash dumps | none produced (no panic hook, no `tracing`, no minidump); core dumps are the OS default | 0 | — | n/a — gap, see TC-107 | C |
| Build output (dev) | `src-tauri/target` | **13 GB** | each cargo build | none; `dist` 12 MB, `node_modules` 524 MB | D |
| Boards/child tasks | `…/terminal-workspace/{boards,child-requests,child-tasks}` | 68 KB | small | none, bounded in practice | S |
| Persisted workspace state | `workspace.json` 1.5 MB (was 0.3–0.5 MB per the TF-015 note) | grows with `closedSessionIds`, `closedRestoreTargets`, `dismissedRecoverySessionKeys`, `recoveryTransfers` (workspace.ts:5385-5395) | per closed pane | arrays unbounded **(verify caps in reducers)** | S |

Class key: R release, T temp, E evidence/screenshot, S state-small, U user session data, A archive/backup, L log, W webview, C crash, D dev-only.
Reclaimable at a glance: ≈ 18 + 19 + 4.8 + 0.8 + 0.7 + ~1 ≈ **44 GB** (app-owned) plus 13 GB dev. The data disk (`/media/endlessblink/data`) is 83% full (177 GB free); /home 70%.

### 2.2 Design

**One registry, one engine.** Every store above is declared once in a `StoreSpec` registry (Rust, daemon crate; mirrored read-only to the UI and `termfleet doctor`):

```
StoreSpec { id, root, glob, class, owner(app|child|user),
            max_age, max_bytes, max_files, min_keep,
            protect: [pinned|active|referenced|newest_n|running_exe],
            action: delete|trash|compress|truncate|vacuum,
            default_enabled, secret_risk }
```

**Per-store defaults (caps by age AND size; whichever trips first, oldest-first, protected items skipped):**

| Store | Max age | Max size | Always keep | Action |
|---|---|---|---|---|
| releases | 14 d | 2 GB (or 10 newest) | `current`, `previous`, every release a live process executes (read `/proc/*/exe`), pinned `known-good-*`, newest 5 | trash → purge |
| TMPDIR | 7 d untouched (mtime+atime) | 3 GB | anything held open or used as cwd by a live process (scan `/proc/*/{cwd,fd}`), per-session dirs of live sessions | trash for dirs >10 MB, delete small |
| pane screenshots | 24 h (default **off**, see TC-095) | 200 MB / 300 files | last 3 per pane, any referenced by an open Task/Issue | delete (they are regenerable) |
| sessions (scrollback/meta/lifecycle) | 30 d idle | 1 GB total, 8 MB/scrollback | sessions of live panes, pinned panes, resumable agent sessions | compress (zstd) after 3 d, then trash |
| archives/backups (`sessions-archive-*`, `workspace.json.before-*`, stale backups) | 30 d | 200 MB | newest 5 workspace backups, last-good | compress then trash |
| logs (paste-debug, traces, lifecycle) | 7 d | 20 MB each, 100 MB total | current + 1 generation | rotate + gzip |
| WebKit localStorage WAL | — | checkpoint at >16 MB | — | `PRAGMA wal_checkpoint(TRUNCATE)` while no page is writing (or on next start); `VACUUM` monthly |
| WebKit cache | 30 d | 200 MB | — | clear via WebKit data manager |
| crash reports | 60 d | 50 MB, ring of 10 | newest | delete |
| dev build (`target`, `node_modules`) | n/a — **not** touched by the product janitor | doctor warns >10 GB | — | `npm run clean:build` (TC-103) |

**Dry-run first, everywhere.** Engine API: `plan(store) -> Plan{ items[], bytes, protected_reasons }`, then `apply(plan_id)`. First run after upgrade is *always* dry-run and shows the plan in the Storage panel; auto-apply only after the user (or a config flag) opts in. Plans are written to `janitor/plans/<ts>.json` for audit.

**Safe delete.** Never `unlink` user-class data directly: `rename()` into `~/.local/share/termfleet/trash/<ts>/<store>/…` (same filesystem, instant) with a `manifest.json`; purge after an undo window (default 7 d; 24 h under disk pressure). Hard guard: a path must resolve (realpath, no symlink escape) under a store root before any rename — same idea as the existing `cleanup_guard_accepts_only_managed_worktree_paths` test (commands.rs:3206). Temp-class and regenerable stores (screenshots, logs, caches) skip the trash. `Undo last cleanup` restores from the manifest.

**Protection.** Pinned panes/sessions/releases (user pin + `pinned.json`), active (live PTY, open file handle, running exe, cwd of a live process), referenced (an issue/plan/agent-status sidecar names it), and `min_keep` per store. Janitor refuses to run a plan that would delete the current binary, the daemon socket dir or anything outside the registry.

**Daemon background janitor (TC-096).** A single low-priority thread inside the daemon (not only the 15-min external reaper, because startup-only pruning at pty.rs:659 never runs on a daemon that stays up for weeks): `nice 19`, `ioprio idle`, scans at most N entries per tick, yields when PTY traffic is high or load is high, exponential backoff, `catch_unwind` around each store so one failing store cannot kill the thread. Emergency mode when free space <10% or <10 GB: tighten ages by half and run immediately. Metrics (also in `termfleet doctor --json`, status bar, and the Storage panel): `bytes_by_store`, `files_by_store`, `last_run`, `bytes_freed_total`, `items_protected`, `errors`, `trash_bytes`, `plan_pending`.

**Disk budget setting + UI usage panel (TC-098).** Settings → Storage: one number ("TermFleet may use up to 5 GB", default; `0` = unlimited with a warning), per-store bars (used / cap / reclaimable), *Clean up now* (shows the dry-run plan first), *Undo last cleanup*, per-store toggles and caps, pin list, "Keep screenshots: Off / 24 h / 7 d", "Persist terminal content: On / Redacted / Off per project". Status-bar chip turns amber at 80% and red at 95% of budget. The budget is enforced by the janitor by shrinking oldest/lowest-priority classes first (order: temp → screenshots → logs → archives → sessions → releases → never user pins).

**Secrets in screenshots and persisted content.** Screenshots are full WebView captures, so they contain whatever is on screen, including tokens and prompts. Default **off** for periodic captures; on-demand captures are kept in memory/streamed to the consumer and written only when asked (TC-095). When on: exclude panes marked "sensitive", blur/blank regions matching a redaction list (OSC-marked password prompts, regex for `AKIA…`, `ghp_…`, `sk-…`, PEM headers) before write, store `0600`, short TTL. Same options for scrollback persistence (TC-124): per-project "don't persist", redaction pass on write, `0600/0700`.

**Compaction.** JSON stores: cap arrays with TTL (TC-105); JSONL: size rotation + gzip; WebKit sqlite: WAL checkpoint/VACUUM schedule (TC-102); future Brainiac index (sqlite): `incremental_vacuum`, `PRAGMA optimize`, WAL cap.

**Rotation.** One `LogSink` (TC-104): size+age rotation, N generations, gzip older, level filter, never `Stdio::null()` the daemon's stderr silently.

**Rollout order:** (1) read-only `termfleet-retention.mjs --dry-run` + doctor report (TC-078 phase 1) → (2) apply for releases, screenshots, TMPDIR with trash → (3) Rust janitor + metrics → (4) UI panel + budget → (5) sessions compress/redact → (6) WebKit WAL/cache.

### 2.3 Size-control tasks (all P0/P1; TC-078 is the umbrella and phase 1)

| ID | Pri | Eff | Imp | Task | Evidence |
|---|---|---|---|---|---|
| TC-078 (existing, amended) | P0 | S–M | H | Phase 1 script, dry-run default, releases/PNG/sessions, removal log. Now also reads the registry in TC-093 and covers TC-101. | plan lines 10181-10185 |
| TC-093 | P0 | M | H | `StoreSpec` registry + retention engine (age AND size caps, protect rules, plan/apply, audit log). Single source for script, janitor, UI and doctor. | table 2.1 |
| TC-094 | P0 | S | H | Release pruning: keep `current/previous/running/pinned/newest N`; hook into `install-release.sh` (prune after successful install); optional hardlink-dedupe of identical files across releases (19 MB × 989). | 989 dirs / 18 GB; install-release.sh no prune |
| TC-095 | P0 | M | H | Screenshot lifecycle: default off for periodic capture, in-memory/streamed on-demand, TTL+count cap, per-pane exclude, redaction before write, `0600`. | webview_snapshot.rs `output_path`; cockpitSnapshot.ts:131; CockpitSnapshotProbe.tsx:190; 20,099 PNG |
| TC-096 | P0 | M | H | Daemon background janitor (low-priority thread, `catch_unwind` per store, backoff, emergency low-disk mode, metrics). Replaces startup-only prune. | pty.rs:659,1682 |
| TC-097 | P0 | S–M | H | Safe-delete: trash dir + manifest + undo window + realpath root guard; dry-run is the default for every destructive path. | commands.rs:3206 pattern |
| TC-098 | P0 | M | H | Disk-budget setting + Storage panel (bars, plan preview, clean now, undo, pins) + status-bar chip. | storageGovernor.ts shows the pattern for WebKit only |
| TC-099 | P1 | S–M | M | Session retention by size: per-file and total caps, zstd after 3 d, fold `sessions-archive-*` into the registry, protect live/pinned/resumable. | pty.rs:38,1682 (age only) |
| TC-100 | P1 | S | M | Backups/debug logs: keep 5 `workspace.json.before-*`, rotate/disable `paste-debug.log*` in release builds, expire `sessions-stale-backup-*`. Extends TC-087. | 51 backups; commands.rs:2156 |
| TC-101 | P0 | S–M | H | TMPDIR containment: per-session tmp subdir removed on session exit, age sweep of untouched entries (skip anything a live process holds), cap; consider not exporting `TMPDIR` to child shells unless needed. | launcher:77; 19 GB, 12,404 entries |
| TC-102 | P1 | S | M | WebKit data: checkpoint/truncate localStorage WAL at >16 MB, monthly VACUUM, WebKit cache cap/clear on version bump. | WAL 97.7 MB; storageGovernor.ts:26 |
| TC-103 | P1 | S | M | Dev build hygiene: `npm run clean:build` (`cargo clean -p`, `cargo sweep`), `profile.dev` `debug=line-tables-only`, shared `CARGO_TARGET_DIR`, doctor warning >10 GB. Excluded from product janitor. | `src-tauri/target` 13 GB |
| TC-104 | P1 | S–M | M | Unified `LogSink` with size+age rotation and gzip; daemon logs to a file (not `Stdio::null()` on the fallback path); `termfleet logs`. | platform_process.rs spawn `Stdio::null`; 38 `eprintln!/println!` outside tests; no `tracing` in Cargo.toml |
| TC-105 | P1 | S | M | Cap/TTL for `closedSessionIds`, `closedRestoreTargets`, `dismissedRecoverySessionKeys`, `recoveryTransfers`; fail dev builds if `workspace.json` >1 MB. | workspace.ts:5385-5395; 1.5 MB file |
| TC-106 | P1 | S | M | Cockpit snapshot write amplification: heartbeat every 10 s rewrites a 74 KB snapshot and appends the same to the trace (≈640 MB/day if every beat persists) — make it change-driven and debug-flag-gated; fsync policy. | cockpitSnapshot.ts:92; commands.rs:2788-2812 |
| TC-107 | P1 | S | M | Crash-report ring (panic hook writes ≤1 MB report, keep 10, 60 d); `LimitCORE=0` or capped core on the daemon unit; opt-in upload only. | no `set_hook`/`catch_unwind` found in main.rs/lib.rs/daemon.rs |
| TC-108 | P1 | S | M | Free-space guard: warn at <15%, emergency tighten at <10%, never write new evidence below 5%; alert via status bar and `doctor`. | data disk 83% used |

---
## 3. LONG-UPTIME SOAK

### 3.1 Findings (file:line)

| ID | Pri | Eff | Imp | Finding / task |
|---|---|---|---|---|
| TC-109 | P0 | M | H | **Unbounded subscriber queues.** `subscribe_registered` (pty.rs:1440-1495) builds an unbounded `mpsc::channel`; `broadcast_pty_output` (:1767-1771) clones each chunk per subscriber. A hung UI/bridge consumer grows daemon RSS without bound (4 unbounded channel sites, 0 `sync_channel`). Fix: bounded queue with drop-oldest + "resync from snapshot" marker, per-subscriber byte cap, disconnect after N seconds of no progress, metric `subscriber_lag_bytes`. |
| TC-110 | P0 | S | H | **UTF-8 corruption.** Reader does `String::from_utf8_lossy(&buf[..n])` per 4096-byte read (pty.rs:1034-1052). A multibyte char split across reads becomes `U+FFFD` in scrollback and persisted files. Fix: carry incomplete trailing bytes to the next read (`std::str::from_utf8` + `error.valid_up_to()`), property test with random splits (Hebrew, CJK, emoji, ZWJ). |
| TC-111 | P1 | M | H | **Poll storm / idle wakeups.** Per-instance intervals: `BoardNode.tsx:270` 200 ms `getBoundingClientRect` per node (forces layout); `useNativeTerminalPane.ts:211` 250 ms per native pane; `Terminal.tsx:2608` 1.2 s `refreshProjectRootFromActiveTerminal` (an IPC → daemon connection → new thread per call, see TC-113); `TerminalCanvas.tsx:560` 2 s geometry; `GamificationPanel.tsx:148` 1 s; `CanonicalAgentBoard.tsx:161` 2 s; `useMasterPlanTasks.ts:44`/`GitMonitoringView.tsx:144` 5 s; `StatusBar.tsx:207`/`CockpitSnapshotProbe.tsx:154` 10 s; module-level `childRequestLoop.ts:272` 1.5 s and `statusPollLoop.ts:504` 4 s. 26 `setInterval` vs 17 `clearInterval` in `src` (several are intentional singletons — audit each). Fix: ResizeObserver/IntersectionObserver instead of rect polling, daemon push events for cwd/status, gate every timer on `document.visibilityState` and pane visibility, one shared scheduler with jitter. Budget: <1 wake/s/idle terminal. |
| TC-112 | P1 | M | H | **Panic/supervision.** No `panic::set_hook`/`catch_unwind` found in main/lib/daemon; 43 non-test `.lock().unwrap()` (poison cascade, extends TC-081); the transient unit has no `Restart=` (platform_process.rs:76-98). Fix: panic hook → crash report (TC-107); per-connection `catch_unwind`; `Restart=on-failure` + `WatchdogSec` with `sd_notify` heartbeat from the main loop; heartbeat file for non-systemd fallback; on respawn, restore from persisted scrollback (existing machinery). |
| TC-113 | P1 | M | M | **Unbounded connection threads.** Accept loop spawns one OS thread per client connection (daemon.rs ~626-640). With TC-111 polling that is a steady thread-create/teardown churn; with a stuck client threads accumulate. Fix: worker pool + max concurrent connections + per-connection read/write timeouts + keep-alive connection reuse in the UI. |
| TC-114 | P1 | M | H | **Soak harness.** Nightly job (or `npm run soak -- --hours 24`) in an isolated `HOME`/socket: 50 sessions with churn, a deliberately slow subscriber, forced client disconnects, random resizes, 1 MB/s output bursts; sample every 60 s `VmRSS`, thread count, `/proc/<pid>/fd` count, zombie/defunct children, scrollback bytes, event-queue length; fail on positive slope (RSS >2%/h after warm-up, FD/threads any growth) and write a report. Existing `termfleet-reaper.mjs` (15 min) becomes an assertion target. |
| TC-115 | P1 | S–M | M | **Forced software GL by default** (launcher lines 108-110: `LIBGL_ALWAYS_SOFTWARE=1`, `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`) for all users, including those with working GPUs: it was a local workaround. Make it detect-and-fall-back, measure idle CPU (`perf stat`, wakeups/s) and stop animating when the window is unfocused/hidden. |
| TC-116 | P2 | M | M | **Sleep/resume + network change.** In the files I read, only `storageGovernor.ts` and the phone app react to visibility/suspend; no logind `PrepareForSleep` or clock-jump handling **(verify)**. Reconcile timers after resume, reconnect bridge/subscriptions with resync, re-run liveness. |
| TC-117 | P1 | L | H | **Render hot-spots.** One `memo(` in 35k lines of components; a single ~5.4k-line Zustand store; 10.6k-line `MagicCanvas.tsx`; no virtualization for long lists (sessions, tasks, sidebar). Plan: split store by slice with selectors + `useShallow`, `React.memo` leaf components, profile with React DevTools/`rendererStallTelemetry.ts`, virtualize lists >100 rows, lazy-mount hidden panes. |
| TC-118 | P2 | S | M | **Crash-safe persistence.** Snapshot write is `write tmp` + `rename` without `fsync` of file/dir (commands.rs:2788-2792); add fsync(file)+fsync(dir), checksum, keep one last-good generation, and recover automatically. Extends TC-087. |
| TC-119 | P2 | M | M | **IPC robustness.** Fuzz/proptest `read_request_frame` (daemon.rs:845-864) and `handle_daemon_input_stream` (:954-1022); audit max frame size and read timeouts **(verify limits)**. |
| TC-120 | P2 | L | H | **Daemon in-place upgrade.** `daemon_ensure_running` (daemon.rs:199-255) treats a protocol mismatch as "spawn another"; an update therefore leaves old daemons holding PTYs, and release pruning must never delete the exe they run (TC-094). Design fd-passing/exec handover or versioned side-by-side drain; add capability negotiation (extends TC-083; `PROTOCOL_VERSION` is a bare `u16`). |

### 3.2 Soak acceptance (add to CI nightly, report in `docs/soak/`)
24 h, 50 sessions: RSS slope ≤ 2%/h after the first hour; FD, thread and zombie count flat (±5); no subscriber queue >1 MB; janitor ran ≥ N times with 0 errors; disk growth of app-owned stores ≤ configured budget; idle CPU <1% with all panes idle and window hidden; no `U+FFFD` in a corpus that contains non-ASCII.

---
## 4. SECURITY: phone bridge, Tauri, supply chain

| ID | Pri | Eff | Imp | Finding / task |
|---|---|---|---|---|
| TC-121 | P1 | S | H | Session cookie is `HttpOnly; SameSite=Lax; Secure` (auth.mjs:45) but the bridge speaks plain HTTP; `TC_HOST=0.0.0.0` "open from your phone on the same network" (server.mjs:3,278) therefore cannot hold a session in a normal browser, which pushes users toward tunnels. Ship a documented TLS path (Tailscale serve / Caddy / self-signed with pinning), refuse non-loopback binding without `--insecure`, print the URL + QR. |
| TC-122 | P1 | S | H | `clientIp()` (auth.mjs:21-23) trusts `cf-connecting-ip`/`x-forwarded-for` unconditionally; the throttle map (accounts.mjs:158-167) is keyed by that attacker-chosen string, never pruned (memory growth) and bypassable by rotating the header. Trust proxy headers only when configured; cap the map (LRU); add a global attempt limit. |
| TC-123 | P1 | S | H | `new URL(req.url, 'http://'+req.headers.host)` (server.mjs:113) runs outside any try/catch and there is no `unhandledRejection` handler **(verify)**; a malformed `Host` can crash the bridge. No `Host` allowlist (DNS rebinding against a loopback bind) and no `Origin` check on `POST /api/send`, `/api/upload` (SameSite=Lax mitigates cross-site cookies only). Add top-level try/catch, Host allowlist, Origin check, request size/time limits (body cap exists: auth 8 KB, uploads 25 MB). |
| TC-124 | P0 | S | H | **Persisted terminal content is group/other-readable.** `terminal-workspace`, `sessions`, `agent-status` are mode `775`; `workspace.json` and `.scrollback` files `664`. `daemon_ipc.rs:17` shows the author knows to use `0600` for the socket. Set `umask 077` in the daemon/UI, chmod existing trees on migration, add per-project "don't persist" and optional scrub. |
| TC-125 | P1 | S | M | CSP (tauri.conf.json `app.security.csp`): `style-src 'unsafe-inline'`, `frame-src http: https:` (any site can be framed), no `object-src 'none'`, `base-uri`, `form-action`. Capability `opener:allow-open-path` is unscoped (capabilities/default.json). Overlaps TC-080; do together. |
| TC-126 | P1 | M | M | Phone pairing: QR pairing token, device list with revoke, audit log of every `/api/send` (keystroke injection into terminals = RCE-equivalent behind one password), optional TOTP. Extends TC-086. |
| TC-127 | P1 | S | M | `termfleet-connect-agents.mjs` ships as a resource and (judging by name) edits the user's Claude/Codex/opencode configuration **(verify)**: show a diff, ask consent, write a backup, provide `disconnect`. |

---
## 5. Agent integration and plugin surface

| ID | Pri | Eff | Imp | Task |
|---|---|---|---|---|
| TC-128 | P1 | M | H | Publish the **agent-status contract**: JSON schema for the `agent-status/*.json` sidecars (state, goal, activity, cwd, session id, last-heartbeat), version field, validator in `doctor`. Today the contract is implicit in `scripts/lib/agent-status-*.mjs` (lifecycle, goal, activity, paths). |
| TC-129 | P1 | M | H | Adapters beyond Claude/Codex/opencode: Gemini CLI, Aider, Copilot CLI, Cursor agent, Amp, goose. Generic "wrap any command" adapter (heuristic, with confidence flag). Bridge adapters today: `claude.mjs`, `codex.mjs` only. |
| TC-130 | P2 | L | H | Extension surface: define 3 extension points before public release — status adapters (above), dashboard panels (iframe/sandboxed, declarative), command-palette commands. No palette or theme registry exists today (no match for "command palette", `data-theme`). Sandboxed, permission-scoped, off by default. |
| TC-131 | P2 | S | M | Agent connect step in onboarding (detect installed agents, show what will be written, test with a dry-run ping). |

---
## 6. Packaging, updates, licensing, bundle, startup

| ID | Pri | Eff | Imp | Finding / task |
|---|---|---|---|---|
| TC-132 | P1 | M | H | **Updates + signing.** No `tauri-plugin-updater` in Cargo.toml/package.json; `release.yml` builds one `ubuntu-22.04` job, "unsigned + checksums" (release.yml:17,61,69). Add the Tauri updater with minisign keys, signed AppImage/deb, delta-friendly channels (stable/preview), and release notes. |
| TC-133 | P1 | L | H | **Windows/macOS readiness.** Daemon IPC is Unix sockets + `SO_PEERCRED` (`daemon_ipc.rs`), spawn uses `systemd-run`, GTK/webkit2gtk crates are Linux-only (Cargo.toml). `portable-pty` supports ConPTY, so the PTY layer is portable; the IPC seam needs named pipes (Windows) / `getpeereid` (macOS), launchd/Task Scheduler instead of systemd, and non-GTK snapshot. `bundle.targets` is `appimage, deb` only. |
| TC-134 | P2 | M | M | Linux matrix: Flatpak, AUR, rpm; CI matrix for Ubuntu 22.04/24.04/Fedora; X11 + Wayland smoke under xvfb/weston. |
| TC-135 | P1 | S | M | Dependency and licence audit: `cargo deny` + `cargo audit` + `npm audit` + `license-checker` in CI, generate SBOM (CycloneDX) and `THIRD_PARTY_NOTICES`; fonts (Geist Mono, Rubik – OFL) attribution; confirm Excalidraw (MIT) notices; `@xterm/*` and `@xterm/addon-webgl` are still dependencies although the terminal renders on Canvas2D (used by `usePty.ts`/`Terminal.tsx` – decide and prune). License declared Apache-2.0 (package.json:4, LICENSE). |
| TC-136 | P2 | M | M | Bundle size: `dist` 12 MB; largest chunks `subset-shared.chunk` 1.8 MB, `percentages-*` 1.2 MB, `index-*` 1.2 MB plus the `excalidraw` asset dir. Route-level lazy loading for Magic Canvas/Excalidraw/Workbench, bundle-size budget in CI (`vite-bundle-visualizer`). Release profile (strip/LTO/panic=abort is not safe with `catch_unwind` — decide with TC-112; extends TC-091). |
| TC-137 | P2 | M | M | Startup: measure cold start to first interactive terminal; lazy-hydrate 5k session files and the 1.5 MB `workspace.json` parse; defer Magic Canvas/Workbench; report in `doctor`. |
| TC-138 | P1 | S | M | `minWidth 1400 / minHeight 900` (tauri.conf.json windows) blocks 1366×768 and many laptop/HiDPI setups. Relax to ~900×600 with a responsive layout. |

---
## 7. UX: accessibility, keyboard, theming, settings, onboarding, docs

| ID | Pri | Eff | Imp | Task |
|---|---|---|---|---|
| TC-139 | P2 | M | M | Accessibility: 395 `aria-*` and 52 `role=` usages show intent, but the terminal is a Canvas2D surface (not readable by screen readers) → add an accessible text layer/live region for output and prompts, `prefers-reduced-motion`/`forced-colors` support (only 4 media-query hits in `src`), focus-trap audit, contrast check of themes. |
| TC-140 | P2 | M | M | Keyboard UX: command palette (none found), user-rebindable keymap file, in-app cheat sheet (`?`), conflict detection with shell/Vim keys; WebKitGTK Tab interception hook exists (Cargo.toml comment) – keep under test. |
| TC-141 | P2 | S | L | Theming: token-based light/dark/high-contrast, follow-system, import iTerm2/Alacritty palettes. |
| TC-142 | P2 | M | M | Settings: today state is split between localStorage and `workspace.json` with one ad-hoc migration key (`agentRecoveryMigrationVersion`). Introduce `settings.json` with `schemaVersion`, ordered migrations, validation, export/import, and a Settings UI (also hosts the Storage panel). |
| TC-143 | P2 | M | H | First-run onboarding: pick project roots, connect agents (TC-131), safety defaults (screenshots off, persistence mode), run doctor, demo layout (`layouts/` already exists). |
| TC-144 | P2 | S | M | End-user docs: install, quick start, keyboard sheet, troubleshooting, **privacy page** (what is stored where, how to purge), phone bridge guide; most `docs/` today is internal (regression matrix, perplexity queries). Move internal docs under `docs/internal/`. |

---
## 8. Tests, CI, observability

| ID | Pri | Eff | Imp | Task |
|---|---|---|---|---|
| TC-145 | P1 | M | H | Test pyramid additions: UTF-8 split property test (TC-110), IPC frame fuzz (TC-119), janitor tests on temp trees with symlink-escape and protected-item cases (TC-093/097), perf budget tests (idle wakeups, render counts), soak (TC-114). CI today: build, `cargo test --lib`, rust-warnings, `verify:canvas-all` (ci.yml:49-108); no macOS/Windows jobs. |
| TC-146 | P2 | S | M | Observability: replace 38 `eprintln!/println!` with `tracing` + rolling file appender and a `RUST_LOG`-style env; correlate UI↔daemon request ids; `termfleet logs --follow`; redaction filter. (Uses TC-104 sink.) |
| TC-147 | P2 | M | M | Crash reporting that respects privacy: local report ring (TC-107) + "Copy report" button + optional upload to a user-configured endpoint; **no telemetry by default**. |

---
## 9. Product ideas for a public release (P3)

| ID | Idea |
|---|---|
| TC-148 | Session timeline/replay from persisted scrollback ("what did the agent do at 14:20"), with redaction and per-project opt-out. |
| TC-149 | Agent attention inbox: "needs input / done / failed" across all panes, push to phone (bridge `asks.mjs` exists), configurable quiet hours. |
| TC-150 | Per-agent usage and cost view (tokens/turns read from hook events), per-project budgets. Local only. |
| TC-151 | **Integrations: Brainiac epic** — see section 10. |
| TC-152 | Workspace templates / shareable layouts (`layouts/`), one-click "open project with these agents". |

---
## 10. Integrations: Brainiac in TermFleet — evaluation

### 10.1 What Brainiac is today
`devops/brainiac`: stdlib-Python read-only sweep (`scripts/sweep.py`, 761 lines) over ~143 projects → dated snapshots + JSON; diff since last snapshot; heartbeat + staleness check; systemd user timers (not installed); `BOTS.md` registry with a drift checker; human-approved overrides (`data/triage-overrides.json`); approval workflow that turns accepted suggestions into proposed `MASTER_PLAN.md` tasks. Personal parts: Hermes/Telegram delivery, the 2026-09-25 triage baseline/verdicts, `BOTS.md` contents, Hebrew/finance rules.

### 10.2 Fit with TermFleet's architecture
* **Natural fit — project index.** TermFleet already knows the user's project roots, cwd per pane (`refreshProjectRootFromActiveTerminal`, Terminal.tsx:2608), `pinnedProjects`/`projectRoot` in the store (workspace.ts:5385), reads `MASTER_PLAN.md` (`useMasterPlanTasks.ts`), shows git state (`GitMonitoringView.tsx`) and collects agent status sidecars. A "Projects" dashboard is mostly aggregation of things it already has.
* **Natural fit — janitor and registry.** The size-control engine (TC-093..098) and Brainiac's "dead folders / bloat / stale branches" are the same class of problem (a read-only scan that proposes actions with dry-run + approval). The `StoreSpec` registry and the Brainiac project registry can share one scan/plan/approve pipeline.
* **Poor fit for the core.** A 761-line Python sweep over 143 repos with `git status` per project is I/O heavy; running it inside the daemon would violate the long-uptime rules (§3) unless it is rate-limited and isolated. Bot registry/Telegram delivery has nothing to do with a terminal product.

### 10.3 What to generalize
| Area | Generalization |
|---|---|
| Discovery | Configurable roots + depth + ignore globs; detect project by marker (`.git`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `AGENTS.md`, `CLAUDE.md`, `MASTER_PLAN.md`); no hard-coded `ai-development`. |
| Agents | Reuse the agent-status contract (TC-128) and adapters (TC-129); per-project agent footprint (`.claude/`, `AGENTS.md`, `.codex/`, `GEMINI.md`, `.cursor/rules`). |
| Plan files | Pluggable readers: `MASTER_PLAN.md`, `TODO.md`, GitHub Issues/Projects, `AGENTS.md` task lists, Taskfile, Linear export. Internal model: `Task{id,title,status,priority,source,path:line}`. |
| Registry schema | `bots`/`agents`/`services` as generic "entities" (handle, kind, owner project, host, status, data owned/read) with `BOTS.md` as one renderer; JSON Schema versioned. |
| Snapshot store | Local SQLite (`~/.local/share/termfleet/index.db`, WAL, `incremental_vacuum`, retention by TC-093) + JSON export; same snapshot schema as Brainiac's JSON so the Python sweep can feed it. |
| Scheduling | No systemd dependency: in-app scheduler while running + optional OS scheduler adapters (systemd user timer, launchd, Task Scheduler) generated from one definition; "catch-up on start" replaces `Persistent=true`. |
| Verdicts | Generic labels (active / dormant / archive-candidate / duplicate) computed from rules; baseline-diff generic ("since last scan"), personal verdict history is user data. |

### 10.4 What stays personal
Hermes/Telegram delivery and cron wiring, `BOTS.md` entries, the 09-25 baseline/overrides, finance/health privacy rules, Hebrew personas. These live in a user-level *Brainiac profile* that plugs into TermFleet through the extension surface (TC-130) — not in the product repo.

### 10.5 Privacy and security model (non-negotiable if shipped)
Read-only by default; explicit **permission scopes** per root (`index`, `git-status`, `read-plan-files`, `size`, `write-suggestions`); nothing leaves the machine, no telemetry, no network in the scanner; secrets never read (skip `.env*`, key files; names/sizes only); sensitive-folder deny list; every write (e.g. appending a task to a `MASTER_PLAN.md`) is a separate, visible, one-click approval with a diff and undo; scanner runs as a separate low-priority process with a hard timeout per project; results `0600`.

### 10.6 Scope-creep risks
1) Becoming a project-management tool (kanban, estimates). 2) Cross-project writes (auto-editing other repos' plans) — keep approval-gated. 3) Duplicating Watchpost/agent-ops. 4) A second scheduler/database alongside the daemon. 5) Long-uptime regressions from scanning inside the daemon. 6) Personal conventions leaking into defaults.

### 10.7 Module / plugin / sidecar / core?
**Sidecar process with a thin core panel.** Core owns: project registry (roots, pins), the dashboard panel, the approval UI, the permission model, the Storage panel. A sidecar (`termfleet-indexer`, Rust or the existing stdlib Python/Node) owns scanning, writes only to the index DB, and talks to the app over the same Unix socket pattern with a separate protocol version. Optional adapters (Hermes/Telegram, Watchpost) are plugins. Not "core in the daemon": it must not share a failure domain with PTYs.

### 10.8 Phased roadmap
* **Phase 0 (prereq):** TC-078/093/096/124 (retention + permissions) and TC-128 (status contract). Nothing in Brainiac should ship before the data it stores is bounded.
* **Phase 1 — MVP (M):** Project index panel: configured roots, per-project last commit, dirty count, size, has MASTER_PLAN/AGENTS/CLAUDE, linked panes/agents, "open in TermFleet" action. Index in SQLite; manual *Rescan*; read-only.
* **Phase 2 (M):** Scheduled light sweep + diff since last scan (new/dirty/stale, growth); heartbeat + "scan stale" chip; scan runs as the sidecar with timeouts.
* **Phase 3 (M):** Plan aggregation (MASTER_PLAN.md reader → tasks across projects), "next task" per project, approval flow that proposes tasks (diff shown, user approves).
* **Phase 4 (L):** Registry entities (bots/agents/services) + drift check; archive/consolidation proposals queue; reuse the janitor's plan/apply/undo.
* **Phase 5:** Plugin API for delivery (Telegram/Slack/email) and custom collectors; scheduler adapters for launchd/Task Scheduler.

### 10.9 Recommendation
**Yes, integrate — but as an opt-in "Projects" module backed by a sidecar indexer, built after the size-control and security basics, and keep Brainiac the personal profile separate.** Pros: the index, git/plan/agent data and approval UX are already inside TermFleet; gives a public-release story beyond "another terminal"; lets TermFleet be the source of truth for "what is running where"; shares the janitor/plan/approve machinery with TC-093..098. Cons: scope creep toward project management, a second long-lived component to keep healthy, privacy surface (scans every repo), and more code to maintain before the core is hardened (CI is red per TC-079). Keep the standalone Python sweep as the reference implementation and test oracle until the Rust/sidecar version matches its output on the 2026-10-02 snapshot.

### 10.10 Epic: TC-151 Integrations: Brainiac
| ID | Eff | Task |
|---|---|---|
| TC-151a | S | Decision record: sidecar vs core, permission scopes, data location; link `devops/brainiac`. |
| TC-151b | M | Project index MVP (roots config, scanner sidecar, SQLite, dashboard panel, rescan). |
| TC-151c | S | Scanner permission scopes + deny list + read-only enforcement test (git index/mtimes unchanged — reuse Brainiac's `ro_check` approach). |
| TC-151d | M | Scheduled sweep + diff + heartbeat chip (in-app scheduler; OS scheduler adapters later). |
| TC-151e | M | Pluggable plan readers → unified task model; MASTER_PLAN.md first. |
| TC-151f | M | Approval workflow (suggestion → diff → proposed task in project plan) with undo. |
| TC-151g | L | Registry entities + drift check + archive/consolidation queue; reuse TC-093 plan/apply. |
| TC-151h | M | Plugin hook for delivery channels (Hermes/Telegram stays a personal plugin). |

---
## 11. Complete ranked backlog (TC-093..TC-152)
Ranking within each group is top-down. P0 = before any further feature work or public release.

| Rank | ID | Area | Pri | Eff | Imp | One line |
|---|---|---|---|---|---|---|
| 1 | TC-078 | Size | P0 | S–M | H | Retention phase 1 (amended) |
| 2 | TC-093 | Size | P0 | M | H | StoreSpec registry + retention engine |
| 3 | TC-101 | Size | P0 | S–M | H | TMPDIR containment (19 GB) |
| 4 | TC-124 | Security | P0 | S | H | `0700/0600` for persisted terminal content |
| 5 | TC-094 | Size | P0 | S | H | Release pruning (18 GB) |
| 6 | TC-095 | Size | P0 | M | H | Screenshot lifecycle + redaction (4.8 GB) |
| 7 | TC-096 | Size | P0 | M | H | Daemon janitor + metrics |
| 8 | TC-097 | Size | P0 | S–M | H | Safe-delete trash + undo |
| 9 | TC-098 | Size | P0 | M | H | Disk budget + Storage panel |
| 10 | TC-109 | Uptime | P0 | M | H | Bounded subscriber queues |
| 11 | TC-110 | Uptime | P0 | S | H | UTF-8-safe PTY reader |
| 12 | TC-099 | Size | P1 | S–M | M | Session retention by size + compress |
| 13 | TC-100 | Size | P1 | S | M | Backups + debug log caps |
| 14 | TC-102 | Size | P1 | S | M | WebKit WAL/cache compaction |
| 15 | TC-105 | Size | P1 | S | M | Cap persisted arrays |
| 16 | TC-106 | Size | P1 | S | M | Snapshot heartbeat write amplification |
| 17 | TC-104 | Size | P1 | S–M | M | Unified log sink + rotation |
| 18 | TC-107 | Size | P1 | S | M | Crash-report ring + core policy |
| 19 | TC-108 | Size | P1 | S | M | Free-space guard |
| 20 | TC-103 | Size | P1 | S | M | Dev build hygiene (13 GB) |
| 21 | TC-111 | Uptime | P1 | M | H | Poll storm → events |
| 22 | TC-112 | Uptime | P1 | M | H | Panic hook, watchdog, restart |
| 23 | TC-114 | Uptime | P1 | M | H | Soak harness |
| 24 | TC-117 | Uptime | P1 | L | H | Render hot-spots |
| 25 | TC-113 | Uptime | P1 | M | M | Bounded connection threads |
| 26 | TC-115 | Uptime | P1 | S–M | M | Adaptive GL / idle CPU |
| 27 | TC-121 | Security | P1 | S | H | Bridge TLS story |
| 28 | TC-122 | Security | P1 | S | H | Throttle spoofing + map growth |
| 29 | TC-123 | Security | P1 | S | H | Host/Origin + crash guard |
| 30 | TC-125 | Security | P1 | S | M | CSP/opener tighten (with TC-080) |
| 31 | TC-126 | Security | P1 | M | M | Phone pairing + audit |
| 32 | TC-127 | Security | P1 | S | M | Agent-config consent/diff/undo |
| 33 | TC-128 | Agents | P1 | M | H | Agent-status contract |
| 34 | TC-129 | Agents | P1 | M | H | More agent adapters |
| 35 | TC-132 | Release | P1 | M | H | Updater + signing |
| 36 | TC-133 | Release | P1 | L | H | Windows/macOS port |
| 37 | TC-135 | Release | P1 | S | M | Licence/dependency audit + SBOM |
| 38 | TC-138 | UX | P1 | S | M | Relax 1400×900 minimum |
| 39 | TC-145 | Tests | P1 | M | H | Test pyramid additions |
| 40 | TC-151b | Brainiac | P1 | M | H | Project index MVP |
| 41 | TC-116 | Uptime | P2 | M | M | Sleep/resume handling |
| 42 | TC-118 | Uptime | P2 | S | M | Crash-safe persistence |
| 43 | TC-119 | Uptime | P2 | M | M | IPC fuzz/limits |
| 44 | TC-120 | Uptime | P2 | L | H | Daemon in-place upgrade |
| 45 | TC-130 | Agents | P2 | L | H | Extension surface |
| 46 | TC-131 | Agents | P2 | S | M | Agent connect onboarding step |
| 47 | TC-134 | Release | P2 | M | M | Linux packaging matrix |
| 48 | TC-136 | Release | P2 | M | M | Bundle size/code-splitting |
| 49 | TC-137 | Release | P2 | M | M | Startup budget |
| 50 | TC-139 | UX | P2 | M | M | Accessibility |
| 51 | TC-140 | UX | P2 | M | M | Command palette + keymap |
| 52 | TC-141 | UX | P2 | S | L | Theming |
| 53 | TC-142 | UX | P2 | M | M | Settings schema + migrations |
| 54 | TC-143 | UX | P2 | M | H | First-run onboarding |
| 55 | TC-144 | Docs | P2 | S | M | End-user docs + privacy page |
| 56 | TC-146 | Obs | P2 | S | M | tracing + rolling logs |
| 57 | TC-147 | Obs | P2 | M | M | Local crash reporting |
| 58 | TC-148..150, 152 | Product | P3 | M–L | M | Replay, attention inbox, cost view, templates |
| 59 | TC-151a,c–h | Brainiac | P2–P3 | S–L | M–H | Rest of the epic |

Existing items amended (not duplicated): **TC-078** (umbrella retention), **TC-080** (+CSP details TC-125), **TC-081** (+TC-112), **TC-083** (+TC-120), **TC-086** (+TC-121..123, TC-126), **TC-087** (+TC-100, TC-118), **TC-091** (+TC-136 release profile).

## 12. Verification notes
* All numbers were measured on 2026-10-02 from this machine's live dirs; the daemon, its 22 live sessions and every file were left untouched.
* Items marked **(verify)** are inferences from file names or from the portion of code I read.
* `LIBGL_ALWAYS_SOFTWARE` etc. are launcher defaults, not Rust code; behaviour on other machines is untested.
* The 19 GB `~/.cache/termfleet/tmp` includes data created by non-TermFleet tools running in panes (npm/Playwright/Codex staging). It is *caused* by TermFleet's TMPDIR choice but not all of it is TermFleet-authored; the janitor must treat it as untrusted/child-owned data (hence trash + live-process checks).
