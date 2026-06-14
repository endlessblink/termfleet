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
printf 'FAKE_CLAUDE_ARGS:%s\n' "$*"
test "$1" = "-p"
test "$2" = "--output-format=stream-json"
test "$3" = "Summarize release blockers"
PROVIDER

cat > "$TMP_DIR/opencode" <<'PROVIDER'
#!/usr/bin/env sh
printf 'FAKE_OPENCODE_ARGS:%s\n' "$*"
exit 0
PROVIDER

chmod +x "$TMP_DIR/codex" "$TMP_DIR/claude" "$TMP_DIR/opencode"

PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" codex headless "Summarize release blockers" > "$TMP_DIR/codex.out"
grep -q '"label":"Headless adapter launched"' "$TMP_DIR/codex.out"
grep -q 'FAKE_CODEX_ARGS:exec --json Summarize release blockers' "$TMP_DIR/codex.out"
grep -q '"status":"done"' "$TMP_DIR/codex.out"

PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" claude headless "Summarize release blockers" > "$TMP_DIR/claude.out"
grep -q '"label":"Headless adapter launched"' "$TMP_DIR/claude.out"
grep -q 'FAKE_CLAUDE_ARGS:-p --output-format=stream-json Summarize release blockers' "$TMP_DIR/claude.out"
grep -q '"status":"done"' "$TMP_DIR/claude.out"

set +e
PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" opencode headless "Summarize release blockers" > "$TMP_DIR/opencode.out"
status=$?
set -e
test "$status" -eq 64
grep -q '"label":"Headless adapter unavailable"' "$TMP_DIR/opencode.out"

set +e
PATH="$TMP_DIR:$PATH" sh "$ROOT_DIR/scripts/agent-provider-adapter.sh" codex headless > "$TMP_DIR/missing-mission.out"
status=$?
set -e
test "$status" -eq 64
grep -q '"label":"Adapter launch failed"' "$TMP_DIR/missing-mission.out"
grep -q 'Headless launch missing mission' "$TMP_DIR/missing-mission.out"

printf '%s\n' "TERMFLEET_AGENT_ADAPTER_HEADLESS_OK"
