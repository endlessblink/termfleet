#!/usr/bin/env bash
# verify:daemon-restart — prove that the terminal keeper survives an app relaunch.
#
# The operator's fear: "my terminals die when the app restarts." The fix gives the
# daemon its OWN systemd transient unit (termfleet-daemon-<pid>) instead of leaving
# it in the app's unit, where the app unit's teardown would take it — and every
# shell and agent — down with it.
#
# This script proves the mechanism deterministically and SAFELY:
#   * It never spawns a real termfleet daemon and never touches the operator's
#     socket, data, or running terminals. It uses throwaway systemd units with
#     unique names and a plain `sleep` standing in for each process.
#   * Piece 1 (Rust unit test `daemon_argv_uses_a_transient_unit_...`) already
#     proves our code emits exactly the systemd-run invocation used below.
#   * This script proves the OTHER half: given that invocation, systemd isolates
#     the daemon into its own cgroup that survives the app unit's teardown — while
#     a process left inside the app unit dies. Same stop action, opposite outcomes.
set -euo pipefail

if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user show-environment >/dev/null 2>&1; then
  echo "verify:daemon-restart: SKIP — no systemd --user manager (this fix is Linux/systemd only)"
  exit 0
fi

NONCE="$$-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
DAEMON_UNIT="termfleet-daemon-verify-${NONCE}.service"   # stands in for the real termfleet-daemon-<pid>
APP_UNIT="termfleet-verify-app-${NONCE}.service"         # stands in for the app's desktop unit

cleanup() {
  systemctl --user stop "$DAEMON_UNIT" >/dev/null 2>&1 || true
  systemctl --user stop "$APP_UNIT" >/dev/null 2>&1 || true
  systemctl --user reset-failed "$DAEMON_UNIT" "$APP_UNIT" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "verify:daemon-restart: FAIL — $1" >&2; exit 1; }

main_pid() { systemctl --user show "$1" -p MainPID --value 2>/dev/null; }
alive()    { [ -n "$1" ] && [ "$1" != "0" ] && kill -0 "$1" 2>/dev/null; }

own_cgroup="$(awk -F: '/^0::/{print $NF}' /proc/self/cgroup)"

# --- 1. The daemon lands in its OWN cgroup, isolated from the caller ------------
# This is the exact shape daemon_spawn_argv() emits (see the Rust unit test).
systemd-run --user --collect \
  --unit="$DAEMON_UNIT" \
  --property=KillMode=mixed \
  --quiet \
  /usr/bin/sleep 600

for _ in $(seq 1 40); do
  dpid="$(main_pid "$DAEMON_UNIT")"; alive "$dpid" && break; sleep 0.05
done
alive "$dpid" || fail "daemon unit never came up"

dcg="$(awk -F: '/^0::/{print $NF}' "/proc/${dpid}/cgroup")"
case "$dcg" in
  *"/${DAEMON_UNIT}") : ;;  # good: its own unit's cgroup
  *) fail "daemon is not in its own unit cgroup (got: $dcg)" ;;
esac
[ "$dcg" != "$own_cgroup" ] || fail "daemon shares the caller's cgroup — no isolation"
echo "  ✓ terminal keeper is in its own slot ($DAEMON_UNIT)"

# --- 2. A/B: stop the 'app' unit; daemon survives, an in-app process dies -------
# The app's desktop unit uses the default control-group kill: stopping it kills
# everything in its cgroup. We put a marker process (the stand-in for a shell/agent
# that WOULD be co-located under the old bug) directly in the app unit.
systemd-run --user --collect \
  --unit="$APP_UNIT" \
  --property=KillMode=control-group \
  --quiet \
  /usr/bin/sleep 600

for _ in $(seq 1 40); do
  apid="$(main_pid "$APP_UNIT")"; alive "$apid" && break; sleep 0.05
done
alive "$apid" || fail "app unit never came up"

# The relaunch: tear down the old app unit exactly as the desktop launcher does.
systemctl --user stop "$APP_UNIT"

for _ in $(seq 1 40); do alive "$apid" || break; sleep 0.05; done
alive "$apid" && fail "app unit process survived its own unit stop (test harness wrong)"
echo "  ✓ tearing down the app unit killed the process inside it (this is the old failure mode)"

alive "$dpid" || fail "TERMINALS WOULD DIE — daemon did not survive the app unit teardown"
# And prove the daemon's cgroup is untouched, not merely the leader pid.
[ "$(awk -F: '/^0::/{print $NF}' "/proc/${dpid}/cgroup")" = "$dcg" ] \
  || fail "daemon cgroup changed after app teardown"
echo "  ✓ terminal keeper survived the app relaunch — terminals live"

echo "verify:daemon-restart: PASS"
