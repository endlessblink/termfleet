#!/usr/bin/env bash
# Real screenshots of the shipped UI for the README / showcase pages.
#
# Runs the built desktop app on a PRIVATE auto-allocated Xvfb with a throwaway
# HOME and XDG dirs, so it never touches the operator's desktop, their daemon, or
# their terminals — and nothing personal (real folder names, tasks, agent chats)
# can appear in a published image. The workspace it photographs is a made-up demo
# tree under the throwaway HOME.
#
# Usage: scripts/capture-showcase-shots.sh [output-dir]
# Default output: /tmp/tf-showcase/shots
set -uo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${SHOWCASE_WORK:-/tmp/tf-showcase}"
OUT_DIR="${1:-$WORK_DIR/shots}"
DEMO_HOME="$WORK_DIR/home"
RUN_DIR="$WORK_DIR/run"
DATA_DIR="$WORK_DIR/data"
LOG_FILE="$WORK_DIR/runtime.log"
DRIVER_LOG="$WORK_DIR/driver.log"
APP_BUDGET="${APP_BUDGET:-150}"
WIDTH="${SHOWCASE_WIDTH:-1680}"
HEIGHT="${SHOWCASE_HEIGHT:-1050}"
BINARY="$APP_ROOT/src-tauri/target/debug/terminal-workspace"
APP_RUN_PID=""

# Click targets, read off a capture at this window size: the pane header's two
# split buttons, and the left rail's view icons.
PANE_HEADER_Y="${PANE_HEADER_Y:-90}"
SPLIT_RIGHT_X="${SPLIT_RIGHT_X:-339}"
SPLIT_DOWN_X="${SPLIT_DOWN_X:-366}"
RAIL_X="${RAIL_X:-19}"
RAIL_SESSIONS_Y="${RAIL_SESSIONS_Y:-122}"
RAIL_MAP_Y="${RAIL_MAP_Y:-160}"
NEW_SESSION_X="${NEW_SESSION_X:-285}"
NEW_SESSION_Y="${NEW_SESSION_Y:-73}"
COMMAND_BAR_X="${COMMAND_BAR_X:-835}"
COMMAND_BAR_Y="${COMMAND_BAR_Y:-21}"
FIT_VIEW_X="${FIT_VIEW_X:-1425}"
FIT_VIEW_Y="${FIT_VIEW_Y:-993}"
ZOOM_OUT_X="${ZOOM_OUT_X:-1385}"
ZOOM_OUT_Y="${ZOOM_OUT_Y:-993}"
TIDY_X="${TIDY_X:-1013}"
TIDY_Y="${TIDY_Y:-77}"

if [[ ! -x "$BINARY" ]]; then
  echo "missing app binary: $BINARY (build it with: cd src-tauri && cargo build)" >&2
  exit 1
fi

# --- Demo workspace: plausible project folders, nothing from the real machine. ---
seed_demo_home() {
  rm -rf "$DEMO_HOME"
  mkdir -p "$DEMO_HOME/code/api-gateway/src" "$DEMO_HOME/code/web-app/src" \
    "$DEMO_HOME/code/docs-site/content"
  for file in server.ts routes.ts auth.ts rate-limit.ts health.ts; do
    printf 'export const placeholder = "%s";\n' "$file" \
      >"$DEMO_HOME/code/api-gateway/src/$file"
  done
  for file in App.tsx Dashboard.tsx Settings.tsx theme.css; do
    printf '// %s\n' "$file" >"$DEMO_HOME/code/web-app/src/$file"
  done
  printf '# Getting started\n' >"$DEMO_HOME/code/docs-site/content/getting-started.md"
  printf '# Deploying\n' >"$DEMO_HOME/code/docs-site/content/deploying.md"
  printf '{\n  "name": "api-gateway",\n  "version": "1.4.2"\n}\n' \
    >"$DEMO_HOME/code/api-gateway/package.json"
  printf '{\n  "name": "web-app",\n  "version": "0.9.0"\n}\n' \
    >"$DEMO_HOME/code/web-app/package.json"
  printf 'API gateway\n===========\n\nRouting, auth, and rate limiting.\n' \
    >"$DEMO_HOME/code/api-gateway/README.md"

  # A neutral prompt: the real $USER and hostname must never reach a published
  # image, and the distro's sudo lecture is noise in a screenshot.
  cat >"$DEMO_HOME/.bashrc" <<'BASHRC'
PS1='\[\e[38;5;114m\]dev\[\e[0m\]:\[\e[38;5;75m\]\w\[\e[0m\]$ '
export PS1
clear
BASHRC

  # Plausible long-running output, so a pane shows work instead of a bare prompt.
  mkdir -p "$DEMO_HOME/bin"
  cat >"$DEMO_HOME/bin/dev-server" <<'DEVSERVER'
#!/usr/bin/env bash
printf '\n  \e[38;5;114mVITE\e[0m v5.4.2  ready in 412 ms\n\n'
printf '  \e[38;5;114m➜\e[0m  Local:   \e[4mhttp://localhost:5173/\e[0m\n'
printf '  \e[38;5;114m➜\e[0m  Network: use --host to expose\n\n'
routes=("GET /api/health 200" "GET /api/orders 200" "POST /api/orders 201" \
  "GET /api/orders/8821 200" "GET /assets/index.js 200" "GET /api/session 304")
i=0
while true; do
  printf '  \e[38;5;245m%s\e[0m  %s \e[38;5;114m%sms\e[0m\n' \
    "$(date +%H:%M:%S)" "${routes[$((i % 6))]}" "$((7 + i % 23))"
  i=$((i + 1))
  sleep 1
done
DEVSERVER
  chmod +x "$DEMO_HOME/bin/dev-server"

  # A real editor gives an honest full-screen TUI shot without htop's real
  # process list (usernames and paths from this machine must never be published).
  cat >"$DEMO_HOME/code/api-gateway/src/rate-limit.ts" <<'SOURCE'
// Per-key request limiting for the orders API.
//
// A key gets a fixed budget per window; a burst may spend it early, and the
// window releases it again. Callers see a clear error, not a silent drop.
export interface Budget {
  perMinute: number;
  burst: number;
}

const budgets = new Map<string, Budget>();

export function allow(key: string, now: number): boolean {
  const budget = budgets.get(key);
  if (!budget) return true;
  const window = Math.floor(now / 60_000);
  const spent = spendOf(key, window);
  return spent < budget.perMinute + budget.burst;
}

export function limitError(key: string) {
  return {
    status: 429,
    body: { error: "rate_limited", key, retryAfterSeconds: 60 },
  };
}
SOURCE

  cat >"$DEMO_HOME/bin/suite" <<'SUITE'
#!/usr/bin/env bash
printf 'Running 24 tests using 4 workers\n\n'
names=("checkout flow keeps the cart after a refresh" \
  "expired token is refreshed once, not per request" \
  "rate limiter releases a burst after the window" \
  "order total matches the line items" \
  "settings page restores the saved theme")
for name in "${names[@]}"; do
  printf '  \e[38;5;114m✓\e[0m  %s \e[38;5;245m(%dms)\e[0m\n' "$name" $((RANDOM % 800 + 120))
  sleep 0.4
done
printf '\n  \e[38;5;114m24 passed\e[0m \e[38;5;245m(6.1s)\e[0m\n'
SUITE
  chmod +x "$DEMO_HOME/bin/suite"
}

cleanup() {
  if [[ -n "$APP_RUN_PID" ]]; then
    kill -- "-$APP_RUN_PID" >/dev/null 2>&1 || true
    wait "$APP_RUN_PID" >/dev/null 2>&1 || true
    APP_RUN_PID=""
  fi
  pkill -f "$RUN_DIR/terminal-workspace" >/dev/null 2>&1 || true
}

# Re-exec under a private auto-allocated Xvfb (own display + own auth).
if [[ -z "${SHOWCASE_INNER:-}" ]]; then
  rm -rf "$RUN_DIR" "$DATA_DIR" "$OUT_DIR"
  mkdir -p "$WORK_DIR" "$RUN_DIR" "$DATA_DIR" "$OUT_DIR"
  chmod 700 "$RUN_DIR"
  seed_demo_home
  exec xvfb-run -a -s "-screen 0 ${WIDTH}x${HEIGHT}x24" \
    env \
      SHOWCASE_INNER=1 \
      SHOWCASE_WORK="$WORK_DIR" \
      HOME="$DEMO_HOME" \
      XDG_RUNTIME_DIR="$RUN_DIR" \
      XDG_DATA_HOME="$DATA_DIR" \
      XDG_CONFIG_HOME="$DEMO_HOME/.config" \
      bash "${BASH_SOURCE[0]}" "$OUT_DIR"
fi

trap cleanup EXIT
cleanup

# Demo task rows / TASKS panel: the same sidecar files the status hooks write.
SHOWCASE_DEMO_HOME="$DEMO_HOME" node "$APP_ROOT/scripts/seed-showcase-status.mjs" \
  >>"$DRIVER_LOG" 2>&1 || echo "warning: status seeding failed (see $DRIVER_LOG)" >&2

shot() { import -window "$1" "$OUT_DIR/$2" 2>>"$DRIVER_LOG" || true; }

# Type into the focused pane, then run it.
run_in_pane() {
  xdotool type --clearmodifiers --delay 12 "$1"
  xdotool key Return
  sleep "${2:-1.2}"
}

drive() {
  local wid=""
  for ((i = 1; i <= APP_BUDGET * 2; i += 1)); do
    wid="$(xdotool search --name "TermFleet" 2>/dev/null | head -1)"
    [[ -n "$wid" ]] && break
    sleep 0.5
  done
  if [[ -z "$wid" ]]; then
    echo "driver: no window" >>"$DRIVER_LOG"
    return 1
  fi
  echo "driver: window=$wid" >>"$DRIVER_LOG"
  xdotool windowsize "$wid" "$WIDTH" "$HEIGHT"
  xdotool windowactivate "$wid"
  sleep 6
  shot "$wid" "00-first-paint.png"

  # A focused terminal forwards every keystroke to the PTY (by design — no key
  # stealing), so the app's own actions are driven with the MOUSE here.
  click() { xdotool mousemove --window "$wid" "$1" "$2" click --clearmodifiers 1; sleep "${3:-1}"; }

  # Split into three panes first, while the shells are still idle.
  click "$SPLIT_RIGHT_X" "$PANE_HEADER_Y" 2.5
  click "$SPLIT_DOWN_X" "$PANE_HEADER_Y" 2.5
  shot "$wid" "01-after-splits.png"

  # Left column, top: a dev server, so the cockpit shows live work.
  click $((WIDTH / 4)) $((HEIGHT / 4)) 0.6
  run_in_pane "cd ~/code/api-gateway && clear && ls --color=always" 1.2
  run_in_pane "~/bin/dev-server" 3

  # Left column, bottom: a test suite finishing.
  click $((WIDTH / 4)) $((HEIGHT * 3 / 4)) 0.6
  run_in_pane "cd ~/code/web-app && clear && ~/bin/suite" 5

  # Right column: a real editor — a full-screen TUI with no host data in it.
  click $((WIDTH * 3 / 4)) $((HEIGHT / 2)) 0.6
  run_in_pane "cd ~/code/api-gateway && vim -u NONE -c 'syntax on' -c 'set number' src/rate-limit.ts" 4
  shot "$wid" "02-three-panes.png"

  # Two more sessions, so the map reads as a fleet rather than a single card.
  click "$NEW_SESSION_X" "$NEW_SESSION_Y" 3
  click $((WIDTH / 2)) $((HEIGHT / 2)) 0.6
  run_in_pane "cd ~/code/docs-site && clear && ls --color=always content" 1.5
  click "$NEW_SESSION_X" "$NEW_SESSION_Y" 3
  click $((WIDTH / 2)) $((HEIGHT / 2)) 0.6
  run_in_pane "cd ~/code/web-app && clear && ~/bin/suite" 4
  shot "$wid" "03-sessions.png"

  # The command bar: the keyboard-first way into every action.
  click "$COMMAND_BAR_X" "$COMMAND_BAR_Y" 1.5
  shot "$wid" "04-command-bar.png"
  xdotool type --clearmodifiers --delay 25 "split"
  sleep 1.5
  shot "$wid" "05-command-bar-typed.png"
  xdotool key Escape
  sleep 1

  # The operations map, framed so every session node is in view.
  click "$RAIL_X" "$RAIL_MAP_Y" 6
  shot "$wid" "06-map.png"
  click "$TIDY_X" "$TIDY_Y" 3
  shot "$wid" "07-map-tidy.png"
  click "$ZOOM_OUT_X" "$ZOOM_OUT_Y" 1.5
  click "$ZOOM_OUT_X" "$ZOOM_OUT_Y" 2.5
  shot "$wid" "08-map-fleet.png"
  click "$FIT_VIEW_X" "$FIT_VIEW_Y" 3
  shot "$wid" "09-map-fit.png"

  echo "driver: done" >>"$DRIVER_LOG"
}

drive >>"$DRIVER_LOG" 2>&1 &
DRIVER_PID=$!

cd "$APP_ROOT"
setsid timeout "$APP_BUDGET" env \
  LIBGL_ALWAYS_SOFTWARE=1 \
  WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  WEBKIT_DISABLE_DMABUF_RENDERER=1 \
  "$BINARY" >>"$LOG_FILE" 2>&1 &
APP_RUN_PID=$!

wait "$DRIVER_PID"
DRIVER_STATUS=$?
cleanup

echo "screenshots in $OUT_DIR:"
ls -1 "$OUT_DIR" 2>/dev/null
exit "$DRIVER_STATUS"
