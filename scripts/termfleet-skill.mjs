#!/usr/bin/env node
// Save a process that worked as a skill everyone can reuse (TF-096 part 8). It is a
// suggestion until Noam approves it in the agents app; then Claude, Codex, OpenCode
// and every bot get it.
//
//   termfleet-skill save <name> --description "<when to use it>" --body "<steps, checks, what needs Noam's OK>"
//   termfleet-skill list
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { suggestSkill, listSkills } from '../termcontrol/bridge/skills.mjs';

export function run(args, env = process.env) {
  const [command, name, ...rest] = args;
  if (command === 'list') {
    const all = listSkills();
    return { ok: true, message: all.length ? all.map((s) => `${s.name}${s.status === 'suggested' ? ' (waiting for Noam)' : ''} — ${s.description}`).join('\n') : 'No skills yet.' };
  }
  if (command === 'save') {
    const flags = {};
    for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1] || ''; i++; }
    const by = env.TERMFLEET_BOT_NAME ? `bot ${env.TERMFLEET_BOT_NAME}` : env.TERMFLEET_PANE_ID ? 'a terminal agent' : 'Noam';
    const made = suggestSkill({ name, description: flags.description, body: flags.body, by });
    return made.error ? { ok: false, message: made.error } : { ok: true, message: `Suggested as "${made.name}". Noam approves it in the agents app; then every agent can use it.` };
  }
  return { ok: false, message: 'Use: termfleet-skill save <name> --description "<when to use it>" --body "<steps>" | termfleet-skill list' };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
