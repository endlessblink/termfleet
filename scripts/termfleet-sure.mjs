#!/usr/bin/env node
// Records an agent's /sure answer where the sure gate can always see it (TF-096).
// Agents write their answer as the command's text, so it lands in the conversation
// record as a tool call even when a plain text reply is not saved before the next
// tool runs (seen 2026-10-16).
//
//   termfleet-sure "1. Root cause: … 2. Confidence: HIGH 3. - 4. Fix: … 5. Side effects: …"
//   termfleet-sure --file answer.md
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sureVerdict } from './termfleet-sure-gate.mjs';

export function check(text) {
  const verdict = sureVerdict(text);
  if (!verdict) return { ok: false, message: 'Not a /sure answer: include "Root cause:" and "Confidence: HIGH|MEDIUM|LOW", plus the fix and side effects.' };
  if (verdict !== 'HIGH') return { ok: true, verdict, message: `Recorded ${verdict}. Code changes stay locked: do the research you listed, then record /sure again.` };
  return { ok: true, verdict, message: 'Recorded HIGH. Code changes are unlocked until the operator writes again.' };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const args = process.argv.slice(2);
  const text = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args.join(' ');
  const result = check(text);
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
