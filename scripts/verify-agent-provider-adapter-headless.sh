#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/codex" <<'PROVIDER'
#!/usr/bin/env sh
printf 'FAKE_CODEX_ARGS:%s\n' "$*"
test "$1" = "exec"
test "$2" = "--json"
test "$3" = "Summarize release blockers"
PROVIDER

cat > "$TMP_DIR/claude" <<'PROVIDER'
#!/usr/bin/env sh
: > "$(dirname "$0")/claude.called"
printf 'FAKE_CLAUDE_ARGS:%s\n' "$*"
test "$1" = "-p"
test "$2" = "--output-format=stream-json"
test "$3" = "Summarize release blockers"
PROVIDER

cat > "$TMP_DIR/opencode" <<'PROVIDER'
#!/usr/bin/env sh
printf 'FAKE_OPENCODE_ARGS:%s\n' "$*"
test "$1" = "run"
test "$2" = "--format"
test "$3" = "json"
test "$4" = "Summarize release blockers"
PROVIDER

chmod +x "$TMP_DIR/codex" "$TMP_DIR/claude" "$TMP_DIR/opencode"

PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" codex headless "Summarize release blockers" > "$TMP_DIR/codex.out"
grep -q '"label":"Headless adapter launched"' "$TMP_DIR/codex.out"
grep -q 'FAKE_CODEX_ARGS:exec --json Summarize release blockers' "$TMP_DIR/codex.out"
grep -q '"status":"done"' "$TMP_DIR/codex.out"

# A known provider binary exists, but policy must refuse before starting it or
# announcing readiness. Isolate the denial audit from the owner's live history.
for mode in terminal headless; do
  set +e
  HOME="$TMP_DIR/home" PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" claude "$mode" "Summarize release blockers" > "$TMP_DIR/claude-$mode.out" 2> "$TMP_DIR/claude-$mode.err"
  status=$?
  set -e
  test "$status" -eq 4
  grep -q 'Claude launch denied' "$TMP_DIR/claude-$mode.err"
  grep -q '"status":"failed"' "$TMP_DIR/claude-$mode.out"
  grep -q '"phase":"blocked"' "$TMP_DIR/claude-$mode.out"
  test ! -e "$TMP_DIR/claude.called"
  if grep -q 'FAKE_CLAUDE_ARGS\|"readiness":"provider-ready"' "$TMP_DIR/claude-$mode.out"; then
    printf '%s\n' "Claude was called or announced ready despite launch denial" >&2
    exit 1
  fi
done

PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" opencode headless "Summarize release blockers" > "$TMP_DIR/opencode.out"
grep -q '"label":"Headless adapter launched"' "$TMP_DIR/opencode.out"
grep -q 'FAKE_OPENCODE_ARGS:run --format json Summarize release blockers' "$TMP_DIR/opencode.out"
grep -q '"status":"done"' "$TMP_DIR/opencode.out"

set +e
PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" codex headless > "$TMP_DIR/missing-mission.out"
status=$?
set -e
test "$status" -eq 64
grep -q '"label":"Adapter launch failed"' "$TMP_DIR/missing-mission.out"
grep -q 'Headless launch missing mission' "$TMP_DIR/missing-mission.out"

printf '%s\n' "TERMFLEET_AGENT_ADAPTER_HEADLESS_OK"
