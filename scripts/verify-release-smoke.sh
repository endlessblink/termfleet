#!/usr/bin/env bash
# Launch-readiness smoke for a built TermFleet AppImage or .deb, on an EMPTY profile.
#
# Like verify-fresh-install.sh it runs on a private Xvfb display with a throwaway
# HOME and private XDG dirs (its own daemon and socket), so it never touches the
# operator's desktop, daemon, or terminals. After the first-launch basics it proves:
#   1. app restart     — app killed, daemon keeps the shell + a background process alive,
#                        relaunched app re-attaches to the SAME terminal (no duplicate)
#   2. crash recovery  — daemon SIGKILLed while the app is closed; relaunch brings the
#                        terminal back with its earlier text
#   3. map zoom        — map opens and zoom in/out keeps the app responsive
#   4. soak            — SOAK_MINUTES of typed probes; fails on a probe slower than
#                        PROBE_LIMIT_S or a dead app/daemon
#
# Usage: SOAK_MINUTES=30 scripts/verify-release-smoke.sh <TermFleet_*.AppImage | .deb>
# Output: /tmp/tf-release-smoke/<artifact>/ (screenshots, soak.tsv, app logs)
set -euo pipefail

ARTIFACT="$(realpath "${1:?usage: verify-release-smoke.sh <AppImage|deb>}")"
NAME="$(basename "$ARTIFACT")"
OUT_DIR="${SMOKE_OUT:-/tmp/tf-release-smoke}/$NAME"
SOAK_MINUTES="${SOAK_MINUTES:-30}"
PROBE_LIMIT_S="${PROBE_LIMIT_S:-5}"
MARK="SMOKE_$$"

log() { printf '[release-smoke] %s\n' "$*" >&2; }

if [[ -z "${SMOKE_INNER:-}" ]]; then
  rm -rf "$OUT_DIR"
  mkdir -p "$OUT_DIR/home/.claude" "$OUT_DIR/run" "$OUT_DIR/data"
  chmod 700 "$OUT_DIR/run"
  exec xvfb-run -a -s "-screen 0 1600x1000x24" \
    env \
      SMOKE_INNER=1 \
      SMOKE_CALLER_DISPLAY="${DISPLAY:-none}" \
      SMOKE_OUT="${SMOKE_OUT:-/tmp/tf-release-smoke}" \
      SOAK_MINUTES="$SOAK_MINUTES" PROBE_LIMIT_S="$PROBE_LIMIT_S" \
      PATH="$(dirname "$(command -v node)"):/usr/local/bin:/usr/bin:/bin" \
      HOME="$OUT_DIR/home" \
      SHELL=/bin/bash \
      LANG="${LANG:-C.UTF-8}" \
      XDG_RUNTIME_DIR="$OUT_DIR/run" \
      XDG_DATA_HOME="$OUT_DIR/data" \
      XDG_CONFIG_HOME="$OUT_DIR/home/.config" \
      XDG_CACHE_HOME="$OUT_DIR/home/.cache" \
      bash "${BASH_SOURCE[0]}" "$ARTIFACT"
fi

if [[ -z "${DISPLAY:-}" || "$DISPLAY" == "$SMOKE_CALLER_DISPLAY" ]]; then
  echo "refusing to run: not on a private Xvfb display (DISPLAY=${DISPLAY:-unset})" >&2
  exit 3
fi

SOCKET="$XDG_RUNTIME_DIR/terminal-workspace/daemon.sock"
APP_PID=""
WINDOW_ID=""

daemon_status() { printf '%s\n' '{"type":"status"}' | nc -U "$SOCKET" 2>/dev/null || true; }
daemon_pid() { daemon_status | grep -o '"pid":[0-9]*' | head -1 | cut -d: -f2 || true; }
list_ids() {
  printf '%s\n' '{"type":"listSessions"}' | nc -U "$SOCKET" 2>/dev/null \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4 || true
}
all_snapshots() {
  local id
  while IFS= read -r id; do
    printf '{"type":"snapshotSession","id":"%s"}\n' "$id" | nc -U "$SOCKET" 2>/dev/null || true
  done < <(list_ids)
}
snapshot_has() { all_snapshots | grep -q "$1"; }
wait_for_text() { # <needle> <tries of 0.25s>
  for _ in $(seq 1 "$2"); do snapshot_has "$1" && return 0; sleep 0.25; done
  return 1
}
shot() { import -window root "$OUT_DIR/$1.png" 2>>"$OUT_DIR/shot.log" || true; }

cleanup() {
  local dp; dp="$(daemon_pid)"
  [[ -n "$APP_PID" ]] && { kill -- "-$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true; }
  [[ -n "$dp" ]] && kill "$dp" 2>/dev/null || true
}
trap cleanup EXIT

case "$NAME" in
  *.AppImage) APP_CMD=(env APPIMAGE_EXTRACT_AND_RUN=1 "$ARTIFACT") ;;
  *.deb)
    dpkg-deb -x "$ARTIFACT" "$OUT_DIR/pkg"
    APP_CMD=("$OUT_DIR/pkg/usr/bin/terminal-workspace")
    export PATH="$OUT_DIR/pkg/usr/bin:$PATH"
    ;;
  *) echo "unsupported artifact: $NAME" >&2; exit 2 ;;
esac

launch_app() { # <label>
  setsid "${APP_CMD[@]}" >"$OUT_DIR/app-$1.log" 2>&1 &
  APP_PID=$!
  WINDOW_ID=""
  for _ in {1..150}; do
    kill -0 "$APP_PID" 2>/dev/null || { log "app exited early ($1)"; tail -30 "$OUT_DIR/app-$1.log" >&2; exit 1; }
    WINDOW_ID="$(xdotool search --name "TermFleet" 2>/dev/null | head -1 || true)"
    [[ -n "$WINDOW_ID" ]] && break
    sleep 0.2
  done
  [[ -n "$WINDOW_ID" ]] || { log "no window ($1)"; exit 1; }
  xdotool windowsize "$WINDOW_ID" 1600 1000 2>/dev/null || true
  xdotool windowactivate "$WINDOW_ID" 2>/dev/null || true
  sleep 7
}
type_in_terminal() { # <text>
  xdotool mousemove --window "$WINDOW_ID" 820 300 click 1
  sleep 0.4
  xdotool type --clearmodifiers --delay 12 "$1"
  xdotool key --clearmodifiers Return
}
stop_app() {
  kill -- "-$APP_PID" 2>/dev/null || kill "$APP_PID" 2>/dev/null || true
  for _ in {1..40}; do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.25; done
  APP_PID=""
}

# ---- 0. first launch + first terminal -------------------------------------------
log "launching $NAME (empty profile)"
launch_app first
shot 01-first-launch
xdotool mousemove --window "$WINDOW_ID" 280 28 click 1   # sessions header: new terminal
sleep 3
for _ in {1..50}; do daemon_status | grep -q '"externalDaemon"' && break; sleep 0.2; done
daemon_status | grep -q '"externalDaemon"' || { log "FAIL: no background service"; exit 1; }
type_in_terminal "echo ${MARK}_A; sleep 99999 & echo ${MARK}_PID=\$!"
wait_for_text "${MARK}_A" 60 || { log "FAIL: first command did not reach a shell"; exit 1; }
wait_for_text "${MARK}_PID=" 40 || { log "FAIL: background process marker missing"; exit 1; }
BG_PID="$(all_snapshots | grep -o "${MARK}_PID=[0-9]*" | tail -1 | cut -d= -f2)"
[[ -n "$BG_PID" ]] && kill -0 "$BG_PID" 2>/dev/null || { log "FAIL: could not read the background process id"; exit 1; }
SESSIONS_BEFORE="$(list_ids | wc -l)"
DAEMON1="$(daemon_pid)"
log "first terminal ok; background process $BG_PID; $SESSIONS_BEFORE session(s); daemon $DAEMON1"
shot 02-first-terminal

# ---- 1. app restart --------------------------------------------------------------
stop_app
sleep 2
[[ "$(daemon_pid)" == "$DAEMON1" ]] || { log "FAIL: daemon did not survive the app closing"; exit 1; }
kill -0 "$BG_PID" 2>/dev/null || { log "FAIL: the terminal's background process died with the app"; exit 1; }
launch_app restart
shot 03-after-app-restart
[[ "$(list_ids | wc -l)" == "$SESSIONS_BEFORE" ]] || { log "FAIL: restart changed the session count ($SESSIONS_BEFORE -> $(list_ids | wc -l))"; exit 1; }
type_in_terminal "echo ${MARK}_B"
wait_for_text "${MARK}_B" 60 || { log "FAIL: terminal not usable after app restart"; exit 1; }
snapshot_has "${MARK}_A" || { log "FAIL: earlier text lost after app restart"; exit 1; }
log "PASS app restart: same daemon, same terminal, process $BG_PID still alive"

# ---- 2. crash recovery (daemon killed while the app is closed) --------------------
stop_app
kill -9 "$DAEMON1" 2>/dev/null || true
for _ in {1..40}; do [[ -z "$(daemon_pid)" ]] && break; sleep 0.25; done
launch_app recovery
shot 04-after-daemon-crash
for _ in {1..60}; do daemon_status | grep -q '"externalDaemon"' && break; sleep 0.25; done
daemon_status | grep -q '"externalDaemon"' || { log "FAIL: no background service after the crash"; exit 1; }
wait_for_text "${MARK}_A" 80 || { log "FAIL: terminal text did not come back after a daemon crash"; shot 04b-recovery-fail; exit 1; }
[[ "$(list_ids | wc -l)" == "$SESSIONS_BEFORE" ]] || log "WARN: session count after crash $(list_ids | wc -l) vs $SESSIONS_BEFORE"
type_in_terminal "echo ${MARK}_C"
wait_for_text "${MARK}_C" 60 || { log "FAIL: recovered terminal does not accept input"; exit 1; }
log "PASS crash recovery: text replayed, terminal accepts input"

# ---- 3. map + zoom -----------------------------------------------------------------
xdotool mousemove --window "$WINDOW_ID" 19 160 click 1   # left rail: Map
sleep 3
shot 05-map-100
# Zoom controls sit bottom-right of the map: "−" at (1305,944), "+" at (1443,944).
for _ in 1 2 3 4; do xdotool mousemove --window "$WINDOW_ID" 1305 944 click 1; sleep 0.5; done
sleep 2
shot 06-map-zoomed-out
for _ in 1 2 3 4 5 6 7 8; do xdotool mousemove --window "$WINDOW_ID" 1443 944 click 1; sleep 0.5; done
sleep 2
shot 07-map-zoomed-in
for _ in 1 2 3 4; do xdotool mousemove --window "$WINDOW_ID" 1305 944 click 1; sleep 0.5; done
sleep 1
shot 07b-map-back
kill -0 "$APP_PID" 2>/dev/null || { log "FAIL: app died while zooming the map"; exit 1; }
log "PASS map zoom: app alive through zoom out/in (inspect 05-07 screenshots for card quality)"

# ---- 4. soak -----------------------------------------------------------------------
xdotool mousemove --window "$WINDOW_ID" 19 122 click 1   # back to the terminal list
sleep 2
printf 'minute\tprobe_s\tapp_rss_mb\tdaemon_rss_mb\n' > "$OUT_DIR/soak.tsv"
END=$(( $(date +%s) + SOAK_MINUTES * 60 ))
n=0; worst=0
while (( $(date +%s) < END )); do
  n=$((n + 1))
  kill -0 "$APP_PID" 2>/dev/null || { log "FAIL: app died during the soak at minute $n"; exit 1; }
  dp="$(daemon_pid)"; [[ -n "$dp" ]] || { log "FAIL: daemon died during the soak at minute $n"; exit 1; }
  t0=$(date +%s.%N)
  type_in_terminal "echo ${MARK}_S$n"
  wait_for_text "${MARK}_S$n" 120 || { log "FAIL: probe $n never reached the terminal (freeze?)"; shot 99-soak-freeze; exit 1; }
  dt=$(awk -v a="$t0" -v b="$(date +%s.%N)" 'BEGIN{printf "%.2f", b-a}')
  arss=$(( $(ps -o rss= -p "$APP_PID" 2>/dev/null | tr -d ' ' || echo 0) / 1024 ))
  drss=$(( $(ps -o rss= -p "$dp" 2>/dev/null | tr -d ' ' || echo 0) / 1024 ))
  printf '%s\t%s\t%s\t%s\n' "$n" "$dt" "$arss" "$drss" >> "$OUT_DIR/soak.tsv"
  if awk -v d="$dt" -v w="$worst" 'BEGIN{exit !(d>w)}'; then worst="$dt"; fi
  if awk -v d="$dt" -v l="$PROBE_LIMIT_S" 'BEGIN{exit !(d>l)}'; then
    log "FAIL: probe $n took ${dt}s (limit ${PROBE_LIMIT_S}s)"; shot 99-soak-slow; exit 1
  fi
  if (( n % 10 == 0 )); then shot "08-soak-minute-$n"; fi
  sleep 45
done
shot 09-soak-end
log "PASS soak: $n probe(s) over ${SOAK_MINUTES} min, worst ${worst}s"
echo "RELEASE_SMOKE_OK $NAME soak_min=$SOAK_MINUTES worst_probe_s=$worst out=$OUT_DIR"
