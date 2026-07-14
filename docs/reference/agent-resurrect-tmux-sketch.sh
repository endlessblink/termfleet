#!/usr/bin/env bash
# Reference-only sketch moved from `bina-ve-ze` on 2026-06-30 for TermFleet
# TC-041 planning. Do not install or call this as a supported TermFleet
# launcher: TC-041 must use TermFleet's daemon/session checkpoint path, not tmux.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT/tmp/agent-instances"
PROJECT_SLUG="termfleet-reference"

usage() {
  cat <<'USAGE'
Usage:
  scripts/agent-resurrect.sh launch <name> [codex|claude] [mission-file]
  scripts/agent-resurrect.sh attach <name>
  scripts/agent-resurrect.sh resurrect <name>
  scripts/agent-resurrect.sh record <name> <codex-session-id>
  scripts/agent-resurrect.sh list

Notes:
  attach    reconnects to the original tmux-owned PTY if it is still alive.
  resurrect starts a new tmux PTY from a recorded Codex session id or mission file.
  record    stores the Codex thread/session id shown in Codex so resurrect can use `codex resume`.
USAGE
}

die() {
  echo "agent-resurrect: $*" >&2
  exit 1
}

need_tmux() {
  command -v tmux >/dev/null 2>&1 || die "tmux is required"
}

safe_name() {
  local raw="${1:-}"
  [[ -n "$raw" ]] || die "missing instance name"
  echo "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9._-]+/-/g; s/^-+//; s/-+$//'
}

manifest_path() {
  local name
  name="$(safe_name "$1")"
  echo "$STATE_DIR/$name.env"
}

launcher_path() {
  local name
  name="$(safe_name "$1")"
  echo "$STATE_DIR/$name.launch.sh"
}

tmux_name() {
  local name
  name="$(safe_name "$1")"
  echo "${PROJECT_SLUG}-agent-${name}"
}

load_manifest() {
  local file="$1"
  [[ -f "$file" ]] || die "unknown instance: $file"
  # shellcheck disable=SC1090
  source "$file"
}

write_manifest() {
  local file="$1"
  {
    printf 'NAME=%q\n' "$NAME"
    printf 'PROVIDER=%q\n' "$PROVIDER"
    printf 'CWD=%q\n' "$CWD"
    printf 'TMUX_SESSION=%q\n' "$TMUX_SESSION"
    printf 'MISSION_FILE=%q\n' "${MISSION_FILE:-}"
    printf 'CODEX_SESSION_ID=%q\n' "${CODEX_SESSION_ID:-}"
    printf 'STARTED_AT=%q\n' "$STARTED_AT"
    printf 'UPDATED_AT=%q\n' "$(date -Is)"
  } >"$file"
}

write_launcher() {
  local file="$1"
  cat >"$file" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$(printf '%q' "$CWD")"
echo "Agent instance: $NAME"
echo "Provider: $PROVIDER"
echo "Workspace: $CWD"
echo
EOF

  if [[ "${PROVIDER:-}" == "codex" && -n "${CODEX_SESSION_ID:-}" ]]; then
    cat >>"$file" <<EOF
exec codex resume "$(printf '%q' "$CODEX_SESSION_ID")"
EOF
  elif [[ -n "${MISSION_FILE:-}" ]]; then
    cat >>"$file" <<EOF
echo "Mission file: $MISSION_FILE"
echo
cat "$(printf '%q' "$MISSION_FILE")"
echo
echo "Launching $PROVIDER with the mission text..."
exec $PROVIDER "\$(cat "$(printf '%q' "$MISSION_FILE")")"
EOF
  else
    cat >>"$file" <<EOF
exec $PROVIDER
EOF
  fi

  chmod +x "$file"
}

launch_instance() {
  need_tmux
  mkdir -p "$STATE_DIR"

  NAME="$(safe_name "$1")"
  PROVIDER="${2:-codex}"
  MISSION_FILE="${3:-}"
  [[ "$PROVIDER" == "codex" || "$PROVIDER" == "claude" ]] || die "provider must be codex or claude"
  command -v "$PROVIDER" >/dev/null 2>&1 || die "$PROVIDER is not on PATH"

  if [[ -n "$MISSION_FILE" ]]; then
    [[ "$MISSION_FILE" = /* ]] || MISSION_FILE="$ROOT/$MISSION_FILE"
    [[ -f "$MISSION_FILE" ]] || die "mission file not found: $MISSION_FILE"
  fi

  CWD="$ROOT"
  TMUX_SESSION="$(tmux_name "$NAME")"
  CODEX_SESSION_ID=""
  STARTED_AT="$(date -Is)"

  local manifest launcher
  manifest="$(manifest_path "$NAME")"
  launcher="$(launcher_path "$NAME")"

  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    die "tmux session already exists: $TMUX_SESSION"
  fi

  write_manifest "$manifest"
  write_launcher "$launcher"
  tmux new-session -d -s "$TMUX_SESSION" -n "$NAME" -c "$ROOT" "$launcher"

  echo "Launched $NAME in tmux session $TMUX_SESSION"
  echo "Attach: scripts/agent-resurrect.sh attach $NAME"
}

attach_instance() {
  need_tmux
  local name session
  name="$(safe_name "$1")"
  session="$(tmux_name "$name")"
  tmux has-session -t "$session" 2>/dev/null || die "tmux session is not alive: $session"
  exec tmux attach -t "$session"
}

resurrect_instance() {
  need_tmux
  local name manifest launcher
  name="$(safe_name "$1")"
  manifest="$(manifest_path "$name")"
  launcher="$(launcher_path "$name")"
  load_manifest "$manifest"

  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "Original PTY is alive; attaching to $TMUX_SESSION"
    exec tmux attach -t "$TMUX_SESSION"
  fi

  [[ -n "${CODEX_SESSION_ID:-}" || -n "${MISSION_FILE:-}" ]] || {
    die "no recorded Codex session id or mission file; cannot reconstruct this instance"
  }

  UPDATED_AT="$(date -Is)"
  write_manifest "$manifest"
  write_launcher "$launcher"
  tmux new-session -d -s "$TMUX_SESSION" -n "$NAME" -c "$CWD" "$launcher"
  echo "Resurrected $NAME in new tmux session $TMUX_SESSION"
  echo "Attach: scripts/agent-resurrect.sh attach $NAME"
}

record_session() {
  local name id manifest
  name="$(safe_name "$1")"
  id="${2:-}"
  [[ "$id" =~ ^[0-9a-fA-F-]{20,}$ ]] || die "session id does not look valid: $id"
  manifest="$(manifest_path "$name")"
  load_manifest "$manifest"
  CODEX_SESSION_ID="$id"
  write_manifest "$manifest"
  write_launcher "$(launcher_path "$name")"
  echo "Recorded Codex session id for $name: $id"
}

list_instances() {
  mkdir -p "$STATE_DIR"
  local file alive
  printf '%-24s %-8s %-8s %s\n' "NAME" "PROVIDER" "PTY" "RESUME"
  for file in "$STATE_DIR"/*.env; do
    [[ -e "$file" ]] || return 0
    load_manifest "$file"
    alive="dead"
    tmux has-session -t "$TMUX_SESSION" 2>/dev/null && alive="alive"
    printf '%-24s %-8s %-8s %s\n' "$NAME" "$PROVIDER" "$alive" "${CODEX_SESSION_ID:-${MISSION_FILE:-}}"
  done
}

cmd="${1:-}"
case "$cmd" in
  launch)
    [[ $# -ge 2 ]] || { usage; exit 2; }
    launch_instance "${2:-}" "${3:-codex}" "${4:-}"
    ;;
  attach)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    attach_instance "$2"
    ;;
  resurrect)
    [[ $# -eq 2 ]] || { usage; exit 2; }
    resurrect_instance "$2"
    ;;
  record)
    [[ $# -eq 3 ]] || { usage; exit 2; }
    record_session "$2" "$3"
    ;;
  list)
    list_instances
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    usage
    exit 2
    ;;
esac
