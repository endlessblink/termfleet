# TermFleet plugin system + Brainiac ↔ assembly-line interface — 2026-10-02

Read-only research. Sources read: TermFleet (`devops/termfleet`: `tauri.conf.json`, `scripts/termfleet-*-hook.mjs`, `termcontrol/bridge/adapters`, `src/lib/childRequestLoop.ts`, `useMasterPlanTasks.ts`, daemon IPC), Hermes plugin API (`devops/hermes/lifeboat-live/hermes_cli/plugins.py`), `~/.claude/skills` (215 skills, `SKILL.md` + frontmatter), `~/.codex/skills`, `~/.hermes/plugins/*`, and `devops/assembly-line` (README, AGENTS.md, PLAN.md, `assembly_line/*.py`, `projects/freelance-desk.toml`, `state/`, `reports/`). Correction applied (parent, 16:29): **Brainiac and assembly-line stay separate projects that communicate through contracts; no merge.** Nothing was changed except the append-only plan notes listed at the end.

---
# PART 1 — TermFleet plugin system

## 1.1 Why a plugin system rather than building Brainiac (and the next feature) into core
Core must stay small, hardened and long-uptime-safe (see deep dive §3, §10). Noam's useful assets are many and personal: Brainiac, the assembly line, Hermes/Telegram delivery, skills, project scanners, dashboards. Every one of them would otherwise widen the PTY daemon's failure domain or the UI's bundle. A plugin boundary gives: separate process (crash isolation), explicit permissions (privacy), versioned API (stability for public release), independent release cadence, and a place for personal vs shared code to live apart.

## 1.2 What exists today (the extension surface is implicit)
| Surface | Where | Notes |
|---|---|---|
| Agent status hooks | `scripts/termfleet-{claude,codex}-status-hook.mjs`, `termfleet-opencode-status-plugin.js`, shipped as Tauri `bundle.resources` (tauri.conf.json) | Agents call hooks → hooks write sidecar JSON into `agent-status/`. This is already a producer contract, just undocumented. |
| Status sidecars | `~/.local/share/terminal-workspace/agent-status/*.json` (1,477 files) | Consumed by UI and bridge. |
| Bridge adapters | `termcontrol/bridge/adapters/{claude,codex}.mjs` | Per-agent adapter shape; only two. |
| File-based child tasks | `child-requests/`, `child-tasks/`, `src/lib/childRequestLoop.ts` (1.5 s poll) | Agents ask TermFleet to spawn work by dropping files: a primitive RPC. |
| Plan reader | `useMasterPlanTasks.ts` (5 s poll) | Reads `MASTER_PLAN.md`: hard-coded format. |
| Layouts, config | `layouts/`, `docs/config.example.json` | Data-only. |
| Daemon IPC | Unix socket, `PROTOCOL_VERSION = 1` | Internal, not for third parties. |
| Operations units | `systemd/*`, user timers (reaper, doctor, memory-guard) | Personal-machine tuning. |
No manifest, no registry, no capability model, no UI contribution API, no versioned plugin protocol.

## 1.3 How Noam's existing extension ecosystems map
| Ecosystem | Native shape | Maps to TermFleet as | Reuse? |
|---|---|---|---|
| Claude skills (`~/.claude/skills/<n>/SKILL.md`, frontmatter `name`, `description`, `user-invocable`, `args[]`) | Prompt packages invoked by name | **Prompt-command contribution**: palette entry `/adapt <target>` that sends the skill invocation text to the focused agent pane (Claude, Codex). Importer reads SKILL.md frontmatter; no code runs in TermFleet. | Reuse the format as-is (importer). |
| Codex skills (`~/.codex/skills`) | Same idea | Same contribution kind, target agent = Codex | Reuse. |
| Claude plugins (`~/.claude/plugins`, marketplace/blocklist) | Bundles of skills/commands/hooks | Treated as a **bundle**: TermFleet can list them and import their commands; not executed | Interop only. |
| Hermes plugins (`plugin.yaml` + `register(ctx)`: `register_hook`, `register_command(name, handler)`, `register_tool`, `register_cli_command`, `register_platform` …) | In-process Python in the gateway | The **closest analogue to a TermFleet sidecar plugin**; manifest style (`name/version/description/provides_*`) is a good minimal base. Hermes plugins stay Hermes plugins; a TermFleet plugin can *talk to* Hermes through its CLI/cron (delivery plugin). | Copy the manifest minimalism, not the in-process model. |
| MCP servers (`mcp_servers:` in Hermes config, lean-ctx) | Tool/resource servers over stdio/HTTP | **Tool provider** contribution; TermFleet acts as MCP *client* for plugin tools, and exposes itself as a (read-only) MCP *server* so agents in panes can ask "which panes/projects/tasks exist" | Reuse the protocol; do not invent a tool schema. |
| VS Code extensions | `package.json` `contributes` (commands, views, statusBar, configuration, keybindings, menus) | **Naming and structure of UI contribution points** | Reuse vocabulary; do **not** try to host the VS Code API (huge, Node extension host). |

## 1.4 Options considered
| Option | Verdict |
|---|---|
| A. VS Code extension compatibility | Reject: enormous API surface, license/ecosystem coupling, not terminal-shaped. |
| B. MCP only | Good for tools, **no UI/lifecycle/permissions** → use as the tool layer, not the whole system. |
| C. Custom sidecar + JSON-RPC 2.0 + MCP for tools + VS Code-style `contributes` | **Recommended.** |
| D. WASM/WASI components | Best sandbox, but poor fit for Noam's Python/Node scripts; keep as a future tier for untrusted third-party plugins. |
| E. Rust/Tauri compile-time plugins | Reject for third parties (rebuild, no isolation); fine for first-party built-ins. |
| F. Hermes-style in-process plugins | Reject for TermFleet (a plugin bug would take the UI/daemon down — contradicts the long-uptime rules). |

## 1.5 Manifest format (`termfleet-plugin.json`, JSON Schema published)
```json
{
  "$schema": "https://termfleet.dev/schemas/plugin-1.json",
  "id": "brainiac",                      "name": "Brainiac",   "version": "0.1.0",
  "publisher": "noam",                    "license": "Apache-2.0",
  "engines": { "termfleet": ">=0.4.0", "pluginApi": "1" },
  "runtime": { "kind": "sidecar", "command": ["python3", "plugin/host.py"], "cwd": ".",
               "transport": "unix-socket", "env_allow": ["HOME"], "limits": {"memoryHigh": "256M", "cpuWeight": 20, "ioWeight": 10} },
  "activation": ["onStartup", "onCommand:brainiac.rescan", "onSchedule:nightly"],
  "permissions": {
    "projects.read": { "roots": ["~/my-projects/ai-development"] },
    "git.read": true, "fs.read": { "paths": ["~/my-projects/ai-development"], "deny": ["**/.env*", "**/*.pem"] },
    "storage": { "maxBytes": "200M" },
    "panes.read": false, "panes.input": false, "net": false, "plan.append": "approval-per-item"
  },
  "contributes": {
    "commands":   [ { "id": "brainiac.rescan", "title": "Brainiac: Rescan projects", "keybinding": "ctrl+alt+b" } ],
    "views":      [ { "id": "brainiac.projects", "location": "sidebar", "title": "Projects", "kind": "declarative|webview", "entry": "ui/projects.json" } ],
    "statusItems":[ { "id": "brainiac.scan", "alignment": "right", "priority": 40 } ],
    "canvasNodes":[ { "id": "brainiac.project-card", "schema": "ui/project-card.schema.json", "view": "ui/project-card.json" } ],
    "configuration": [ { "id": "brainiac.roots", "schema": "config.schema.json" } ],
    "menus":      [ { "where": "project.context", "command": "brainiac.openPlan" } ],
    "tools":      [ { "mcp": "stdio", "command": ["python3", "plugin/mcp.py"] } ],
    "skills":     [ { "dir": "skills" } ],
    "data":       [ { "id": "project-index", "schema": "contracts/project-index-1.0.schema.json" } ]
  },
  "signature": "minisign:…"
}
```
Rules: unknown keys ignored with a warning (forward compatibility); every contribution id is namespaced by plugin id; `permissions` are the **maximum** the plugin may ask for; the user grants a subset.

## 1.6 Capability / permission model (read-only by default)
* **Deny by default.** A plugin with no grants can only render its own declared views from its own data and use its private `storage`.
* Scopes (host-brokered API calls): `projects.read{roots}`, `git.read`, `fs.read{paths,deny}`, `fs.write{paths}` (never default), `panes.read` (list/status/last-seen), `panes.output.read` (terminal content — **separate, scary**), `panes.input` (typing into terminals — separate, scary, per-pane confirmation), `agents.status.read`, `notify`, `net{hosts}`, `exec{commands}`, `plan.append` (**always** host-mediated: shows diff + provenance and needs a click per item), `schedule`, `clipboard`.
* **Grants** are stored per plugin id + manifest hash; a new/changed permission re-prompts; revocation takes effect immediately; an audit log (`plugins/audit.jsonl`, size-capped by the janitor) records every brokered call that touches `fs.write`, `panes.input`, `net`, `plan.append`.
* **Honesty about enforcement.** A sidecar is a normal OS process running as the user; host brokering protects the *host API*, not the process's own syscalls. So three tiers: **T0 declarative-only** (no process; safest; most dashboards), **T1 brokered sidecar** (default; trusted/personal plugins; permissions enforced on host API; the UI says "not OS-sandboxed"), **T2 OS-sandboxed sidecar** (bubblewrap/Landlock on Linux, sandbox-exec on macOS, AppContainer on Windows; filesystem and network actually restricted to the grants). Third-party public plugins should require T0 or T2.
* Private data rule: plugins never receive terminal output or keystrokes unless `panes.output.read`/`panes.input` is granted for the specific pane; the janitor and the privacy page list these grants.

## 1.7 Process isolation and protocol
* Host spawns each sidecar as its own transient user unit (`systemd-run --user`, same pattern as the daemon in `platform_process.rs:72-135`; `MemoryHigh`, `TasksMax`, low `CPUWeight`/`IOWeight`); fallback to a plain child with `setsid` on non-systemd systems, Job Objects on Windows, launchd on macOS.
* **Transport:** a Unix domain socket per plugin (named pipe on Windows), peer-credential check (same mechanism as `daemon_ipc.rs`), length-prefixed **JSON-RPC 2.0** frames with `pluginApi` negotiated in `initialize` (LSP-style: capabilities exchanged both ways). Never in the PTY daemon; a separate `termfleet-plugin-host` process owned by the UI, so a plugin cannot hurt PTYs.
* Requests the host sends: `initialize`, `activate(event)`, `command.run`, `view.render`, `config.changed`, `shutdown`. Requests plugins send (brokered): `projects.list`, `git.status`, `fs.read`, `notify`, `storage.get/put`, `panes.list`, `ui.setStatus`, `ui.setData`, `plan.proposeAppend` (never writes directly).
* **Supervision:** heartbeat every 10 s (not a poll storm: one multiplexed timer), restart with exponential backoff, disable after N crashes/hour with a visible reason, kill on unresponsive `shutdown`, bounded message size and queue (applies TC-109 lessons).
* Tools: if the plugin contributes `tools`, the host speaks MCP to it (stdio) and can surface the tools to agent panes (opt-in).

## 1.8 UI contribution points
Commands (palette + keybinding), views (sidebar/bottom panel; **declarative first**: JSON describing lists/tables/cards/charts/forms rendered by the host with the app theme and accessibility; **webview** only for T2/trusted, served from a `tf-plugin://<id>/` origin with a strict CSP and a postMessage bridge), status items (text, icon, tooltip, severity, click command), pane decorators (badge on a pane header, e.g. "plan task BRN-007"), canvas nodes (Magic Canvas node types with a JSON schema for data and a declarative or webview renderer), project context menu, settings sections (rendered from JSON Schema), notifications, data providers (typed feeds like `project-index-1.0` that other plugins can subscribe to). Accessibility and theming are the host's responsibility for declarative views — a reason to prefer them.

## 1.9 Lifecycle, versioning, distribution
* **States:** discovered → installed → enabled → activating → active → idle (activation events) → crashed/disabled → uninstalled. `termfleet plugin list|enable|disable|logs|dev|validate|pack`.
* **Versioning:** `pluginApi` integer (breaking) + semver of each API method; host supports N and N-1; manifest `engines` checked on install; deprecation warnings in the Plugin Manager.
* **Data:** plugin storage under `plugins/<id>/` is registered with the retention engine (TC-093) with a manifest-declared `maxBytes`; uninstall keeps data 30 days in the trash (TC-097).
* **Distribution:** (1) local folder / `git clone` into `~/.local/share/termfleet/plugins` (personal ones: Brainiac, Hermes delivery), (2) a curated JSON **index** repo with signed (minisign) archives for public ones, (3) later a browsable catalog. No automatic updates for plugins with elevated scopes.
* **Dev experience:** `termfleet plugin dev <dir>` hot-reloads, shows the RPC trace, validates the manifest against the schema, runs a conformance suite.

## 1.10 Brainiac as the first plugin
| Aspect | Brainiac plugin |
|---|---|
| Runtime | Existing stdlib-Python sweep wrapped by a small `plugin/host.py` that implements the JSON-RPC subset; no rewrite. |
| Permissions | `projects.read`, `git.read`, `fs.read` (deny `.env*`, keys), `storage`; `plan.append` only in Phase 2 and always host-mediated. No `panes.*`, no `net`. |
| Contributes | Sidebar view "Projects" (declarative table from `project-index`), status item "scan age / dirty count", commands Rescan / Show suggestions / Approve…, canvas node "Project card", data provider `project-index-1.0` and `suggestion-1.0`. |
| Personal split | The *generic* sweep + registry + approval UI ship as `brainiac-core`; Noam's Hermes/Telegram delivery, the 09-25 baseline and BOTS.md content live in a second personal plugin (`brainiac-noam`) that depends on `brainiac-core`'s data provider. |
| Compatibility | The standalone `devops/brainiac` CLI/systemd route remains and writes the same files; the plugin is a *viewer/driver*, so uninstalling it loses nothing. |

Second and third plugins to prove the API: **assembly-line status panel** (reads its `reports/`, shows queue state), **Hermes delivery** (a `notify` sink calling Hermes cron/CLI).

## 1.11 Risks
Scope (platform building before product), security (T1 is not a sandbox — say so), API churn (freeze v1 small: commands, status items, declarative views, storage, projects.read), ecosystem fragmentation (reuse MCP + SKILL.md instead of new formats), performance (every plugin is a process: cap count, lazy activation), and privacy (clear separate scary scopes). Build order: manifest + host + status items + commands first (a week), declarative views next, canvas nodes and webviews last.

## 1.12 Plugin-system tasks (new, TC-153 … TC-169; also appended to termfleet's MASTER_PLAN.md)
| ID | Pri | Eff | Task |
|---|---|---|---|
| TC-153 | P1 | L | **Epic: Plugin system** (children below). Supersedes the "module vs sidecar" open point in TC-151. |
| TC-154 | P1 | M | ADR + `termfleet-plugin.json` v1 JSON Schema (manifest, contribution points, permission names). |
| TC-155 | P1 | M | `termfleet-plugin-host` process: spawn/supervise sidecars (systemd-run transient units, cgroup limits, backoff, crash-loop disable), heartbeat, logs. |
| TC-156 | P1 | M | JSON-RPC 2.0 over Unix socket, peer-cred check, `initialize` capability/version negotiation, bounded frames/queues. |
| TC-157 | P1 | M | Capability broker: deny-by-default grants store, consent UI, revocation, audit log; `plan.append` host-mediated with diff. |
| TC-158 | P1 | M | UI contributions v1: commands, status items, settings sections (JSON Schema), notifications. |
| TC-159 | P2 | L | Declarative views (list/table/card/form) then canvas node types; webview tier behind T2. |
| TC-160 | P1 | S | Plugin storage under the retention engine (TC-093) + uninstall-to-trash (TC-097). |
| TC-161 | P2 | M | MCP bridge: host as MCP client of plugin tools; TermFleet as a read-only MCP server (panes, projects, tasks) for agents. |
| TC-162 | P2 | S | Skill/command importer (Claude/Codex `SKILL.md` frontmatter → palette prompt-commands). |
| TC-163 | P2 | S | `termfleet plugin dev|validate|pack` CLI and RPC trace viewer. |
| TC-164 | P2 | L | T2 sandbox tier (bubblewrap/Landlock first). |
| TC-165 | P2 | M | Plugin Manager UI (list, enable, grants, logs, health, version). |
| TC-166 | P3 | M | Signed index + install-from-git/archive; update policy. |
| TC-167 | P1 | M | Conformance suite + fake plugins (crash loop, slow, oversized frame, permission violation) as CI tests. |
| TC-168 | P1 | M | **Brainiac as first plugin** (`brainiac-core` + `brainiac-noam`); TC-151b becomes its implementation. |
| TC-169 | P2 | S | assembly-line status panel plugin (reads `reports/`, `state/` read-only). |

---
# PART 2 — Brainiac ↔ assembly-line interface (separate projects, communicating)

## 2.1 What the assembly line is (found: `devops/assembly-line`)
* Own project, **not yet committed** (no commits, git status shows only `.gitignore`, `AGENTS.md`, `CLAUDE.md` untracked-new), ~640 lines of Python + 142 lines of tests, **stub agents only** (`NotWiredYet`); README says `run` needs real agents "next step". It has `PLAN.md` (Noam's decisions) and `AGENTS.md`, no `MASTER_PLAN.md`.
* Purpose (AGENTS.md): read a project's plan, fix tasks one after another with Codex workers in an isolated copy, have other agents review each fix, park what it cannot finish, report in plain language, one yes/no per batch, apply locally only, a later separate "ship" step.
* Code: `plan_reader.py` (rows `| ID | Status | Effort | Task | Depends |` and `### ID:` blocks with `Evidence/Do/Validation`), `eligibility.py` (`classify` → ready/done/waiting_on_noam/blocked/already_handled using `needs_noam_markers`, `protected_paths`, dependency ids), `ledger.py` (`pending, done, stuck, disputed, waiting_on_noam, parked_question, blocked`; inbox of newly found problems, de-duplicated), `loop.py` (2 attempts, protected-path auto-fail, reviewers), `summary.py`, per-project settings `projects/freelance-desk.toml` (`plan`, `project_dir`, `check_command`, `max_tasks=5`, `max_minutes=120`, protected paths, needs-Noam markers), outputs in `reports/<project>/latest.{json,md}` and `state/<project>/*-ledger.json`.
* **It already states the intended relationship** (AGENTS.md): "brainiac is the cross-project overseer. Hand-offs are through files only… neither edits the other. Approved brainiac suggestions reach a project's plan as new, append-only tasks; assembly-line works those tasks." This design builds on that and does not contradict it.

## 2.2 Overlap and gaps
| Area | Brainiac | assembly-line | Overlap / risk |
|---|---|---|---|
| Reads plans | `MASTER_PLAN.md` presence and tasks (sweep, planned plan aggregation) | `plan_reader.py` (two formats) | Two parsers drifting apart. |
| Task state | Suggestions (proposed/approved…) | Ledger statuses | Two vocabularies; the plan's own Status column is a third source of truth. |
| New problems | Suggestions queue | Its own inbox | Two inboxes unless one is the queue of record. |
| Approvals | Per-suggestion approval (BRN-008) | One yes/no per batch | Different granularity; must not be conflated. |
| Writes to plans | Phase 2: append approved tasks | "Only append dated sections" | **Two writers to the same file**: concurrency and provenance. |
| Working copies | Sweeps every folder and flags dirty/odd ones | Edits "an isolated copy" of the project | The sweep will see assembly-line worktrees as dirty/orphans. |
| Reports | Morning report | Plain-language run summary | Duplicate messages to Noam. |
| Kill / pause | (none yet) | (none yet) | Needs one convention. |
Gaps: Brainiac does not implement; assembly-line does not observe/triage. That asymmetry is the right split.

## 2.3 Division of responsibility
| Brainiac (observe · triage · suggest · govern) | assembly-line (queue · implement · review · apply locally) |
|---|---|
| Sweeps all projects, project index, verdicts, bloat/dead/duplicate detection | Reads **only** projects listed in its `projects/*.toml` |
| Produces `suggestion-1.0` records, holds the single approval queue and the approval records + audit log | Consumes **approved** hand-offs; never invents approvals |
| The **only** component that appends tasks to other projects' plans on behalf of automation (Phase 2+, per-item approval, provenance) | Never edits plan entries; records progress in its ledger/reports (optional dated status section is written *through* Brainiac or not at all — decision D1 below) |
| Archive/consolidation/cleanup actions (Phase 3, undo manifest) | No archive/cleanup powers |
| Reads assembly-line reports/inbox read-only; shows them in the morning report | Reads Brainiac's project index/approval records read-only; never writes into `brainiac/` |
| Knows where assembly workspaces are (so it does not flag them) | Registers its isolated copies in `state/workspaces.json` |

## 2.4 Shared data contracts (JSON, versioned, JSON-Schema files owned by Brainiac in `brainiac/contracts/`, vendored/validated by assembly-line)
1. **`project-index-1.0`** — produced by Brainiac's sweep at `brainiac/reports/project-index.json`: `schema_version, generated_at, projects[]` with `id` (stable slug), `path`, `remotes[]`, `verdict`, `last_commit`, `dirty_count`, `unpushed`, `size_bytes`, `plan: {path, format: "masterplan-table|heading-blocks|none", last_task_id}`, `flags[]`, `assembly: {covered: bool, settings_path}` (from reading `assembly-line/projects/*.toml`). Consumers: assembly-line (to find plan paths), TermFleet plugin.
2. **`suggestion-1.0`** — `brainiac/state/suggestions/<id>.json`: `id` (`BRN-S-YYYYMMDD-NNN`), `source` (`brainiac|assembly-line-inbox|human`), `project`, `kind` (`task|archive|cleanup|consolidate|investigate`), `title`, `body`, `evidence[]` (file:line or report refs), `risk` (`low|med|high`), `effort`, `content_sha256`, `created_at`, `expires_at`, `status` (`proposed|approved|rejected|applied|withdrawn|expired`).
3. **`approval-record-1.0`** — append-only `brainiac/state/approvals.jsonl`: `approval_id, suggestion_id, content_sha256` (approval binds to the exact text), `decision` (`approve|reject|defer`), `scope` (`plan-append|handoff-implementation|archive|cleanup`), `decided_by` (`noam`), `decided_at`, `channel` (`cli|termfleet|telegram`), `expires_at`, `revoked_at`, `prev_hash` (hash-chain so tampering is visible).
4. **`plan-provenance-1`** — the line appended with any automated task: `<!-- provenance: BRN-S-… approval=<approval_id> sha256=<…> by=noam on=<date> via=brainiac -->` immediately above the new section; assembly-line refuses tasks lacking a valid provenance chain when `require_provenance=true`.
5. **`task-queue-1.0`** — produced by assembly-line at `assembly-line/state/<project>/queue.json` (read-only to others): per task `id, project, source` (`plan-line|suggestion:<id>`), `state`, `attempts`, `updated_at`, `reason`, `plan_ref {path, line}`. **State machine** (single vocabulary; maps the existing ledger statuses): `proposed → approved → queued → working → in_review → applied_local → (shipped, later)`, with side states `blocked`, `waiting_on_noam`, `parked_question`, `stuck`, `disputed`, `rejected`, `cancelled`. Owners: Brainiac owns `proposed→approved` (via the approval record); assembly-line owns everything from `queued`.
6. **`run-report-1.0`** — existing `assembly-line/reports/<project>/latest.json`, formalised: `run_id, started_at, ended_at, counts{done,stuck,disputed,waiting,parked}, tasks[], inbox[], limits_hit, stub: bool, errors[]`. Brainiac consumes it in the morning report.
7. **`workspace-registry-1.0`** — `assembly-line/state/workspaces.json`: active isolated copies `{path, project, task_id, created_at, branch}`. The sweep marks them `assembly_workspace` (not "dirty"/"orphan") and Phase 3 refuses to touch them.
8. **`control-flags-1.0`** — `brainiac/config/flags.json` (phase switches, off by default) and kill-switch files `brainiac/state/KILL` and `assembly-line/state/PAUSE`; each side checks its own and the other's before any write/hand-off.

## 2.5 How messages flow (v1: files + CLI, no sockets)
* Producers write **atomically** (tmp + rename) into their own dir; consumers read only. Events go to append-only `events.jsonl` per producer (`suggestion.created`, `approval.recorded`, `handoff.requested`, `task.state_changed`, `run.finished`) so consumers tail with a stored offset and nothing needs polling a database.
* Explicit actions are CLI verbs, not hidden coupling: `brainiac suggest|list|approve <id>|reject <id>`, `brainiac handoff <approval_id>` (writes a `handoff-1.0` file into `assembly-line/inbox/handoffs/` — the one place Brainiac writes inside assembly-line, an inbox directory that assembly-line owns and declares), `assembly-line status|queue|ack <handoff>`.
* Delivery to Noam (Telegram/TermFleet) is one component's job: Brainiac's morning report includes a one-paragraph assembly-line section; assembly-line does not send its own second summary unless something needs a decision (matches its AGENTS.md alert rule).
* A local socket is only introduced by the TermFleet plugin host (TC-153), reading the same files; the files remain the source of truth.

## 2.6 Approval and safety gates (autonomous code changes are the dangerous part)
| Gate | Rule |
|---|---|
| G0 Kill switches | `KILL`/`PAUSE` files and flags; checked before every write; presence stops both sides within one step. |
| G1 Per-item approval | Phase 2 and 4 need an approval record per suggestion bound to `content_sha256`; edits to the text invalidate it. No blanket "approve all". |
| G2 Allow-list | Only projects listed in assembly-line `projects/*.toml` **and** flagged `autonomy >= 2` in `brainiac/config/flags.json` can receive implementation hand-offs; default autonomy 0. |
| G3 Isolation | Implementation only in a registered isolated worktree/copy, never the main checkout; refuses if the repo has uncommitted/unpushed work in the target paths; no push/merge/publish/message/spend/delete (assembly-line hard rules). |
| G4 Budget | Max tasks/minutes/diff size/files per run (existing `max_tasks`, `max_minutes`) plus token spend cap; stop on first error class "protected path" or "secret detected". |
| G5 Review | Different agent reviews the author's change; tests and a new check per fix; protected-path and secret scanners on the diff; auto-fail on touching protected rules. |
| G6 Human batch yes | One yes/no per batch before anything is applied locally; "ship" is a separate later yes (assembly-line decision). |
| G7 Audit + undo | Append-only hash-chained audit log (`brainiac/state/audit.jsonl`, assembly-line `state/*/audit.jsonl`); every apply produces an undo manifest; plan appends can be reverted by removing the provenance-delimited block. |
| G8 Provenance | Every automated line in a plan carries its provenance comment; assembly-line can trace a code change to a task to an approval. |
| G9 Single writer | Plan appends happen only via Brainiac using `flock` on `<plan>.lock` and an "append only if the file's tail hash is unchanged" check, so concurrent humans/agents cannot interleave. |

## 2.7 Risks
Autonomous code changes (mitigations G2–G7); approval fatigue → rubber-stamping (batch summaries in plain language, expiry, risk labels); stale approvals (expiry + content hash); plan parser drift (shared fixtures in `contracts/fixtures/`, contract tests in both repos); working-copy confusion (workspace registry); duplicate notifications (single delivery owner); scope creep of Brainiac into implementation (hard rule: Brainiac never changes code); assembly-line growing its own observer (hard rule: it never scans projects it is not configured for); TermFleet integration making a third coordinator (it only renders files via plugins).

## 2.8 Recommendation: layered, not merged
```
Observe  (Brainiac sweep)  ->  Suggest (suggestion-1.0)  ->  Decide (Noam: approval-record-1.0)
       ->  Hand off (handoff-1.0 file)  ->  Execute (assembly-line queue, isolated worktree, agent review)
       ->  Report (run-report-1.0)  ->  Brainiac morning report / TermFleet plugin panels
```
Reasons: different blast radius (read-only observer vs code-changing worker), different cadence and tooling, independent kill switches, and both projects are young enough that fixing a contract now is cheap. Build order: (1) contracts + fixtures, (2) Brainiac reads assembly-line reports and tags workspaces (read-only, no new powers), (3) suggestion/approval record formats and CLI, (4) Phase 2 plan append behind a flag, (5) hand-off file + assembly-line ack, (6) real-agent runs only on projects with `autonomy>=2` and Noam's go. Decisions needed from Noam: **D1** may assembly-line append dated status sections to plans directly, or only through Brainiac (recommended: only through Brainiac)? **D2** should assembly-line's own inbox items become Brainiac suggestions (recommended: yes, promotion needs approval)? **D3** rename `PLAN.md` to the `MASTER_PLAN.md` convention (recommended: yes, as an append-only new file first)? **D4** location of the contracts (recommended: `brainiac/contracts/`).

## 2.9 Tasks
**Brainiac plan (BRN-014 … BRN-018 here; phase tasks BRN-019+ are in the Job E section of its plan):**
| ID | Pri | Eff | Task |
|---|---|---|---|
| BRN-014 | P1 | S | `contracts/` directory: JSON Schemas + fixtures for `project-index-1.0`, `suggestion-1.0`, `approval-record-1.0`, `handoff-1.0`, `task-queue-1.0`, `run-report-1.0`, `workspace-registry-1.0`, `control-flags-1.0`; contract tests. |
| BRN-015 | P1 | S | Emit `reports/project-index.json` from the sweep, including plan path/format and `assembly.covered`. |
| BRN-016 | P1 | S | Read-only reader for `assembly-line/reports/*/latest.json` and `state/*/queue.json`; add an assembly-line section to the morning report. |
| BRN-017 | P1 | S | Workspace-registry awareness: sweep labels `assembly_workspace`, never flags or touches them. |
| BRN-018 | P2 | S | Interface decision record (D1–D4) and the division-of-responsibility table in `AGENTS.md`. |
**assembly-line (proposed IDs AL-1…AL-6; no MASTER_PLAN.md exists, appended as a pointer to `PLAN.md`):** AL-1 adopt `contracts/` schemas and validate on read; AL-2 `state/<project>/queue.json` in `task-queue-1.0` state machine; AL-3 `state/workspaces.json`; AL-4 `inbox/handoffs/` consumer with provenance check and ack; AL-5 export inbox as `inbox.json` for Brainiac promotion; AL-6 honour `PAUSE`/flags and `autonomy` level.
