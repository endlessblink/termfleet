#!/usr/bin/env node
// Answer Noam right away while you keep working (TF-096). A plain reply written in the
// middle of a long task is often not saved before the next step runs, so the phone
// never shows it; this command's text is always saved, and the agents app shows it as
// your message.
//
//   termfleet-say "<a short answer in plain words>"
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const text = process.argv.slice(2).join(' ').trim();
  process.stdout.write(text ? 'Shown to Noam.\n' : 'Say something: termfleet-say "<text>"\n');
  process.exit(text ? 0 : 1);
}
