#!/usr/bin/env bash
# Let Claude Code start in its fullscreen display mode.
#
# Claude checks CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN before the "tui": "fullscreen"
# setting, so while that env entry sits in ~/.claude/settings.json fullscreen never
# turns on (TF-059). This removes ONLY that entry, safely:
#   - backs the file up first (timestamped, same permissions),
#   - edits the text in place so the rest of the file keeps its exact formatting,
#   - proves the result is valid JSON AND identical to the original minus that one
#     entry before writing anything; otherwise it changes nothing,
#   - writes atomically, so the file is never half-written.
# Does not touch running terminals or Claude sessions; new Claude starts pick it up.
set -euo pipefail

SETTINGS="${CLAUDE_SETTINGS_FILE:-$HOME/.claude/settings.json}"

if [[ ! -f "$SETTINGS" ]]; then
  echo "No Claude settings file at $SETTINGS — nothing to do."
  exit 0
fi

BACKUP="$SETTINGS.bak-before-fullscreen-$(date +%Y%m%d-%H%M%S)-$$"
cp -p "$SETTINGS" "$BACKUP"

set +e
SETTINGS="$SETTINGS" node <<'NODE'
const fs = require("fs");
const file = process.env.SETTINGS;
const KEY = "CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN";
const original = fs.readFileSync(file, "utf8");
const before = JSON.parse(original);

if (!before.env || !(KEY in before.env)) {
  console.log("Already fine: the fullscreen-off switch is not in your Claude settings.");
  process.exit(3);
}

// Remove the one line; if it was the last entry, drop the comma it leaves behind.
const lineRe = new RegExp(`^[ \\t]*"${KEY}"[ \\t]*:[ \\t]*"[^"\\n]*"[ \\t]*,?[ \\t]*\\r?\\n`, "m");
let edited = original.replace(lineRe, "");
edited = edited.replace(/,(\s*\n\s*\})/, (match, tail, offset) =>
  // only fix a trailing comma directly inside the env block
  edited.lastIndexOf('"env"', offset) > edited.lastIndexOf("}", offset) ? tail : match,
);

let after;
try {
  after = JSON.parse(edited);
} catch (error) {
  console.error(`Stopped: the edit would break the file (${error.message}). Nothing changed.`);
  process.exit(1);
}
const expected = structuredClone(before);
delete expected.env[KEY];
if (JSON.stringify(after) !== JSON.stringify(expected)) {
  console.error("Stopped: the edit would change more than that one setting. Nothing changed.");
  process.exit(1);
}

const tmp = `${file}.tmp-${process.pid}`;
fs.writeFileSync(tmp, edited, { mode: fs.statSync(file).mode & 0o777 });
fs.renameSync(tmp, file);
console.log("Done: removed the fullscreen-off switch. Everything else is unchanged.");
console.log(`Fullscreen setting is: ${JSON.stringify(after.tui ?? "(not set)")}`);
NODE
status=$?

if [[ $status -eq 3 ]]; then
  rm -f "$BACKUP"
  exit 0
fi
if [[ $status -eq 0 ]]; then
  echo "Backup kept at: $BACKUP"
  echo "Restart Claude in each pane (quit, then: claude --continue) to use fullscreen."
else
  rm -f "$BACKUP"
fi
exit $status
