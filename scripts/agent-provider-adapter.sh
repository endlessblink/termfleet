#!/usr/bin/env sh
set -eu

emit() {
  printf '%s\n' "$1"
}

provider="${1:-}"
if [ -z "$provider" ]; then
  emit '[[TERMFLEET_AGENT_EVENT {"status":"failed","phase":"blocked","activity":"Provider adapter missing provider id","activityKind":"blocked","summary":"Provider adapter missing provider id","nextAction":"Check workstream launch configuration","label":"Adapter launch failed"}]]'
  exit 64
fi

case "$provider" in
  codex|claude|opencode)
    ;;
  *)
    emit '[[TERMFLEET_AGENT_EVENT {"status":"failed","phase":"blocked","activity":"Unsupported provider","activityKind":"blocked","summary":"Unsupported provider","nextAction":"Use codex, claude, or opencode","label":"Adapter launch failed"}]]'
    exit 64
    ;;
esac

if ! command -v "$provider" >/dev/null 2>&1; then
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"failed\",\"phase\":\"blocked\",\"readiness\":\"unknown\",\"activity\":\"$provider is not on PATH\",\"activityKind\":\"blocked\",\"summary\":\"$provider is not on PATH\",\"nextAction\":\"Install or configure the provider CLI\",\"label\":\"Provider unavailable\"}]]"
  exit 127
fi

child_pid=""
cancel_requested=0

request_cancel() {
  cancel_requested=1
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"running\",\"phase\":\"cancelling\",\"readiness\":\"provider-ready\",\"activity\":\"Cancellation requested\",\"activityKind\":\"waiting\",\"summary\":\"Cancellation requested\",\"nextAction\":\"Waiting for $provider to acknowledge cancellation\",\"label\":\"Adapter cancellation requested\",\"detail\":\"TermFleet forwarded an interrupt signal to the provider process.\"}]]"
  if [ -n "$child_pid" ]; then
    kill -INT "$child_pid" 2>/dev/null || true
  fi
}

terminate_provider() {
  cancel_requested=1
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"running\",\"phase\":\"cancelling\",\"readiness\":\"provider-ready\",\"activity\":\"Termination requested\",\"activityKind\":\"waiting\",\"summary\":\"Termination requested\",\"nextAction\":\"Waiting for $provider to exit\",\"label\":\"Adapter termination requested\",\"detail\":\"TermFleet forwarded a termination signal to the provider process.\"}]]"
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null || true
  fi
}

trap request_cancel INT
trap terminate_provider TERM HUP

emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"running\",\"phase\":\"active\",\"readiness\":\"provider-ready\",\"activity\":\"$provider adapter launched\",\"activityKind\":\"starting\",\"summary\":\"$provider adapter launched\",\"nextAction\":\"Watch provider response\",\"label\":\"Adapter launched\",\"detail\":\"Provider command found on PATH and started through TermFleet adapter.\"}]]"

"$provider" &
child_pid=$!
set +e
while kill -0 "$child_pid" 2>/dev/null; do
  sleep 1
done
wait "$child_pid"
status=$?
set -e
trap - INT TERM HUP

if [ "$cancel_requested" -eq 1 ]; then
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"stopped\",\"phase\":\"interrupted\",\"readiness\":\"provider-ready\",\"exitCode\":$status,\"activity\":\"$provider acknowledged cancellation\",\"activityKind\":\"idle\",\"summary\":\"$provider acknowledged cancellation\",\"nextAction\":\"Review output or restart\",\"label\":\"Provider cancellation acknowledged\"}]]"
elif [ "$status" -eq 0 ]; then
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"done\",\"phase\":\"complete\",\"readiness\":\"provider-ready\",\"exitCode\":0,\"activity\":\"$provider exited cleanly\",\"activityKind\":\"complete\",\"summary\":\"$provider exited cleanly\",\"nextAction\":\"Review output or restart\",\"label\":\"Provider exited\"}]]"
else
  emit "[[TERMFLEET_AGENT_EVENT {\"status\":\"failed\",\"phase\":\"blocked\",\"exitCode\":$status,\"activity\":\"$provider exited with status $status\",\"activityKind\":\"blocked\",\"summary\":\"$provider exited with status $status\",\"nextAction\":\"Inspect output and send recovery prompt\",\"label\":\"Provider exited with error\"}]]"
fi

exit "$status"
