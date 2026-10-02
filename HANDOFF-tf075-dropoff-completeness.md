# HANDOFF — TF-075 (SessionStart provider stamp, DONE) + NEW: dropoff completeness (OPEN, not started)

Project: /media/endlessblink/data/my-projects/ai-development/devops/termfleet (branch main). Read CLAUDE.md and docs/runtime-truth.md first. House rules: run `npm run issues -- check` and `npm run issues -- list` before touching production code (show/create the matching issue first); `npm run doctor` for status-pipeline questions; before ANY command say plainly whether it kills terminals; final answer to Noam = 1-4 short plain sentences + "Next steps" list, no paths/code/headers; keep exactly one task in_progress with a plain-language activeForm; do not ask "go?" once a goal is approved.

## Noam's words (verbatim, chronological)
1. Original (earlier instances): "dropoff in the same terminal fails with codex + [Image #1] this doesnt recognized that this is a claude code session + [Image #2] this claude code session rose to 80$ before dropoffing"
2. Correction: "Handover failing with Codex: I haven't reproduced this. The uncommitted Codex pane-matching work that was already in the repo is still unverified, and I didn't change it. so fix this"
3. Earlier approval: "go" (for the SessionStart provider stamp).
4. NEW, this turn (UNADDRESSED — this is your main job): **"dropoffs are not comprehensive enough and things I write near the dropoffs dont get passed on"**

## Interpretation of the NEW request (confirm with evidence, don't assume)
- (a) The HANDOFF.md that agents write at the 40%-context handover is too thin: it skips relevant things.
- (b) Messages Noam types around/just before/after the dropoff trigger (e.g. corrections, extra instructions typed near the handover reminder) never reach the successor. Likely cause to check: the successor only receives the HANDOFF file the dying agent wrote; the dying agent may not include later user messages, and anything Noam types AFTER spawn into the old card/new card boundary may be lost. Investigate how `termfleet-child spawn --dropoff` seeds the new session (what exact prompt/text is injected, whether it embeds the file or just a path, whether recent user prompts are captured), and `scripts/context-handoff-hook.mjs` (UserPromptSubmit hook, env TERMFLEET_CONTEXT_HANDOFF=off|ask|auto) — what its injected reminder says about content. Candidate fixes to evaluate: (1) make the hook's reminder/template mandate sections (original words verbatim + every later correction, done/evidence, files + uncommitted state, decisions/rejected, running state, next steps, first command) — it already lists these, so check whether agents actually obey and whether a verifier can enforce; (2) have the spawn tooling/hook automatically append a machine-collected "verbatim recent user messages" block (from the vendor session record — Claude `~/.claude/projects/.../*.jsonl`, Codex rollout; see memory task-line-vendor-transcripts) to the dropoff so Noam's words near the handover can't be dropped by the agent; (3) have the spawn command reject/warn on a dropoff missing required sections. Rejected-up-front: relying on the agent to remember. Prefer (2)+(3). Ask Noam only if the interpretation is truly ambiguous; otherwise act.
- Reproduce first: read the last few real handoffs (HANDOFF-*.md in repo root, docs) and compare with what the successor actually received (spawn logs in `child-requests/`, the app's spawn path in `scripts/` and `src-tauri` — find via `grep -rn dropoff scripts src-tauri/src src`).

## Done this session (evidence)
- Commit **0124bd4** `fix(status): Claude SessionStart stamps the provider so a fresh pane is not SHELL (TF-075)`:
  - `scripts/termfleet-claude-status-hook.mjs`: new exported `stampProviderAtSessionStart({payload,cwd,paneId})`; on SessionStart with a pane id it writes a minimal pane-keyed sidecar `{cwd,sessionId,updatedAt,source:"session-start",todos:[],provider:"claude",paneId}` (NO task/goal/turn/now text); if a sidecar already exists (resume/compact) it only sets `provider:"claude"` and `paneId`, preserving everything else. Atomic temp+rename across `statusFilePaths`.
  - `tests/claude-sessionstart-provider.spec.ts` (new, 2 tests: fresh = provider only, no invented text; resume keeps mainTask/turn). With `tests/agent-status-end-to-end.spec.ts`: 5 passed.
  - `npm run doctor`: Claude hook registered from the repo path => takes effect on the NEXT Claude session start, no release/restart needed (no frontend change). `src/lib/agentStatusSidecar.ts` carries `provider` through even with empty tasks (line ~641), so the header should show CLAUDE not SHELL.
- Earlier: 76bb5d5 (Codex pane matching rules out windows resumed with other chats), b181d15 (handover reminder re-fires every 15 context points; cause of the "$80" part).

## NOT verified / open
1. **NEW dropoff-completeness work** — nothing done yet beyond writing this plan. Needs issue entry (TF-076 suggested; check `npm run issues -- list` for next id), failing test first, fix, source + focused-test evidence; installed-release/live-desktop evidence only if app code changes (then `npm run release:install`, `npm run verify:installed-release`, tell Noam "restart" — relaunch WITHOUT killing the daemon). Note memory: user launches from the DOCK in dev mode; check doctor "How it is launched" before saying anything about rebuild.
2. SessionStart stamp is unproven LIVE: needs a genuinely fresh Claude pane (new hook run) to see CLAUDE badge before first prompt. Ask Noam to open a fresh Claude terminal, or check `~/.local/share/terminal-workspace/agent-status/pane-*.json` for `"source":"session-start"` after the next fresh start.
3. Codex same-terminal handover (TF-074): code + unit tests done, NO live proof. Reported pane: codex pid 1222622, folder bots+automation/claude-and-conquer, unbound but only Codex window in its folder, should match by same-folder fallback. Needs Noam to run the handover from that terminal (or a harness). Don't mark TF-074 resolved without evidence kinds: source, focused-test, installed-release, live-desktop.
4. `npm run audit:panes` fails with 4 offenders: panes 15740e90 and d81f5898 (old Codex sidecars dated Sep 24, flow-state folder, "placeholder Task while record holds a goal/request/list -> Task not captured"). NOT caused by my change (my tests use temp XDG dirs). Pre-existing; chase only if relevant.
5. `tests/status-provider-authority.spec.ts` (another agent's UNTRACKED file) has 6 failing tests (expects `pane_agent_provider` call for "actual-codex-pty"). Not mine; do not fix/commit unless asked.
6. Image 2 ("Task not captured" on rough-cut-mvp Claude pane): separate class; quick check only via `npm run cockpit:why`.

## Uncommitted state / other agents (do NOT commit these)
Mine: only this handoff file (untracked, being committed with the handoff). Other agents' uncommitted: MASTER_PLAN.md, docs/issue-registry.json, docs/visual-baselines/tc-008*.png + tc-009*.png, scripts/verify-clipboard-paste.sh, .kilo/, HANDOFF-feature-64.md, HANDOFF-tf073-codex-handover.md, HANDOFF-tf074-claude-sessionstart.md, docs/reviews/, tests/scratch-eval.spec.ts, tests/status-provider-authority.spec.ts. There is also `git stash@{0}` "codex recovery backup before restoring verified commits" — leave it. Several agents work concurrently: `git status` and stage only your own files.

## Constraints / decisions
- Handover continues in the SAME agent kind (Claude stays Claude). Never tmux/nohup/Konsole; `termfleet-child spawn`; if shell blocks: `lean-ctx allow termfleet-child`.
- Do NOT restart the daemon (pid 1515447, ~32 live panes) or resume provider sessions. No cloud LLM calls for testing. No optimistic echo.
- Editing existing .ts/.tsx with Edit/Write reformats whole files and breaks source verifiers (verify-map-terminals): use a surgical python replace SCRIPT FILE written to the scratchpad (inline `python3 -c`/`node -e` are blocked by lean-ctx). .mjs edits via Edit are fine.
- Native Read/Grep may be denied; use ctx_* tools or Bash (Bash worked).
- Scratchpad: /media/endlessblink/data/.dev-tmp/endlessblink/claude-1000/-media-endlessblink-data-my-projects-ai-development-devops-termfleet/2ee422d7-6c57-4afa-bfe7-538753eea54d/scratchpad
- Commit trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Rejected
- Claiming Codex handover fixed without live proof; writing an early sidecar with invented task text; "SHELL is transient"; relying on the dying agent to remember user words near the handover.

## Running state
No builds/servers/ports started by me. Daemon pid 1515447 live — don't touch.

## First command
`cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && git status --short && git log --oneline -3 && npm run issues -- list | tail -15 && grep -rn "dropoff" scripts src-tauri/src --include=*.mjs --include=*.rs -l`
Then reproduce the thin-dropoff / lost-user-words problem before fixing, and reply to Noam first with one plain sentence confirming you understood the NEW request.
