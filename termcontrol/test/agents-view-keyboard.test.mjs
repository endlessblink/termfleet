// Noam 2026-10-20: "cant paste anything again (images or text)" in the Agents view of the desktop app.
// Cause: the window-level Ctrl+V claim for the last focused terminal was never released
// when the Agents view opened, so the paste went into that terminal. Guard the release.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const src = fs.readFileSync(path.resolve('src/components/AgentsView.tsx'), 'utf8');
test('the Agents view releases the terminal keyboard claim so Ctrl+V reaches the chat box', () => {
  assert.match(src, /invoke\("set_focused_terminal", \{ id: null \}\)/);
  // on arrival and whenever the window loses focus to the chat page
  assert.match(src, /release\(\);\s*window\.addEventListener\("blur", release\)/);
  assert.match(src, /removeEventListener\("blur", release\)/);
});
test('the Rust side still swallows Ctrl+V only while a terminal is claimed', () => {
  const rust = fs.readFileSync(path.resolve('src-tauri/src/gtk_keys.rs'), 'utf8');
  assert.match(rust, /reason=no_focused_terminal/);
});
