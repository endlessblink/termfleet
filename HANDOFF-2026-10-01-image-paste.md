# Handoff — 2026-10-01 — TermFleet image copy/paste "again not working well"

You are continuing a long session in `/media/endlessblink/data/my-projects/ai-development/devops/termfleet` (branch `main`, work directly on main). The previous instance ran out of context. Read this whole file first, then `CLAUDE.md`, `docs/runtime-truth.md`, and memory `image-paste-mechanism.md` + `sluggish-cockpit-diagnosis.md`.

## The current request (Noam's words)

> "copying and pasting images in termfleet is again not working well"

Noam is non-technical-facing: short plain answers (1–4 sentences + "Next steps"), no jargon. Before any command say whether it KILLS THE TERMINALS. Never hand him diagnostics to run; run them yourself. Dock-only acceptance: build with `npm run release:install`, verify with `npm run verify:installed-release`; the change reaches him only after a UI-only relaunch (stopping the `termfleet-desktop-*` user unit and running `~/.local/bin/termfleet-desktop --dock`) — that does NOT kill terminals (daemon PID 1515447 owns PTYs; never kill/restart it). Ask or tell him before relaunching his window if he is mid-work; earlier in the session he accepted the agent doing UI-only relaunches when he said "go".

## Evidence already gathered (not yet acted on)

`~/.local/share/terminal-workspace/paste-debug.log` (the app's own clipboard log, epoch-ms timestamps):

```
1790856997011 ui.corr=bbfa3f6f paste_shortcut.read_start origin=gtk tauri=true      <- read started, NEVER finished
1790856998355 ... paste_shortcut.drop origin=gtk reason=read_in_flight              <- every later Ctrl+V dropped
1790857006122 ... drop reason=read_in_flight
... 10+ more drops within ~25 s
```

Also earlier pairs `read_start` → `read_empty action=agent_ctrl_v` (empty text clipboard → forwards Ctrl+V \x16 to the agent so the AGENT reads the image clipboard — that is the designed image-paste path, see memory `image-paste-mechanism.md`).

Leading hypothesis: the backend `clipboard_read_text` (src-tauri/src/commands.rs, async, tries wl-paste → xclip → xsel) has no timeout; when an image (not text) is on the clipboard, or the clipboard owner is slow/dead, `xclip -o` can hang, the frontend's "read in flight" guard never clears, and ALL subsequent pastes are dropped until the window restarts. Check: is there a timeout on the read? does the in-flight flag clear on error/timeout? (frontend in `src/components/TerminalCanvas.tsx` around the `clipboard_read_text` invoke / `paste_shortcut` logging; decision logic `decidePasteAction` in `src/lib/keymap.ts`).

Likely fix: bound the clipboard read (e.g. 1.5 s timeout, kill the child) and always clear the in-flight guard (finally), and when the read times out or the clipboard holds an image type, fall back to forwarding Ctrl+V to the agent (agent_ctrl_v). Add a regression test (unit for the guard + Rust test for the timeout path) and record an issue via `npm run issues -- create TF-0xx ...` (next free id: check `npm run issues -- list`; TF-067 is the last one created by this session, others may have added TF-068/069).

Also check "copy" side: TF-067 (fixed and committed this session, release 0f8d5c2+) stopped reattach replays from overwriting the clipboard with old OSC 52 copies and serialized clipboard writes. Make sure image COPY isn't affected by the serialization lock (clipboard_write_text holds a tokio mutex while xclip runs; if an xclip child hangs, later writes would also block — consider a timeout there too).

Live check after a fix: `npm run verify:clipboard-paste`, then watch `paste-debug.log` while Noam pastes an image into a Claude pane: expect `read_start` followed promptly by `read_empty action=agent_ctrl_v` (image) or `read_ok`, and no `read_in_flight` drops.

## What this session already shipped (all committed on main, not pushed)

- `545ea1a` perf: JIT on main thread (`JSC_useConcurrentJIT=false`, launcher), finite quest pulse, blur-free card shadow, glyph atlas in one shared sheet, renderer work recorder (`src/lib/workAttribution.ts`, `npm run perf:work-profile`), gates `npm run verify:render-perf`, `npm run verify:boot-smoke`.
- `a940b0c` + `5c5c44b` storage governor (`src/lib/storageGovernor.ts`, every localStorage write; 200 B/s/key budget), launcher compacts WebKit localStorage WAL before each window start, doctor "Webview storage log" line. Root cause of the frozen splash: ~1 GB WAL.
- `0f8d5c2` TF-067 clipboard: history replay no longer re-runs OSC 52 copies; clipboard writes serialized.
- `3bced3e` map-card drag: one store move per animation frame; 10 large gradients → solid colours.
- Ops (not code): restarted/updated the Worlds Greatest bot's WAHA on the VPS (image backup tag `devlikeapro/waha:backup-20261001`), WhatsApp relinked and healthy. Botson amber: daily health guard fails on one unhandled Telegram NetworkError (no error handler) — offered fix, not done.

Uncommitted files in the tree belong to OTHER agents (sidebar TF-069 work etc.) — never commit or revert them; stage only your own hunks (technique used all session: build HEAD+your edits as a blob, `git hash-object -w` + `git update-index --cacheinfo`, then validate the staged snapshot via `git checkout-index -a --prefix=<tmp>` + symlinked node_modules).

## Tools/gotchas learned

- lean-ctx shell hook blocks python heredocs and sometimes reports "path escapes project root" for sed/cat while still running the command — verify file state after.
- `pkill -f <name>` can kill your own shell; kill by PID.
- Another agent may hold the release build lock ("Another TermFleet build is already running"); retry in a loop.
- Real-app paint lab + probes live in the old session scratchpad (`/media/endlessblink/data/.dev-tmp/endlessblink/claude-1000/-media-endlessblink-data-my-projects-ai-development-devops-termfleet/52de3f5c-949b-486d-92f5-07201a6860f2/scratchpad/`: `real_app_lab.py`, `boot_smoke.py`, `hitches.mjs`, `drag_windows.py`).

## First command to run

```bash
cd /media/endlessblink/data/my-projects/ai-development/devops/termfleet && grep -a -n "paste_shortcut\|backend.read" ~/.local/share/terminal-workspace/paste-debug.log | tail -30 && grep -n "read_in_flight\|clipboard_read_text" src/components/TerminalCanvas.tsx src-tauri/src/commands.rs | head -20
```
