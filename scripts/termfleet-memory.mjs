#!/usr/bin/env node
// A bot's lasting memory, for the bot itself (TF-096 part 3). Runs inside a bot's
// brain, which knows its bot from TERMFLEET_BOT_ID.
//
//   termfleet-memory search "<words>"          past conversations with Noam, verbatim
//   termfleet-memory propose "<text>" [--kind preference|decision|fact|lesson]
//                                              suggest a memory; Noam approves it
//   termfleet-memory card                      what is approved (always given to you)
//   termfleet-memory profile --job "<few words>" --rules "<rules>"
//                                              offer your job and standing rules; Noam approves
import { readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BotMemory, searchChat, KINDS } from '../termcontrol/bridge/memory.mjs';

export function botFolder(env = process.env) {
  const id = String(env.TERMFLEET_BOT_ID || '');
  if (!/^[0-9a-f]{12}$/.test(id)) return null;
  return path.join(env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'bots', id);
}

export function run(args, env = process.env) {
  const folder = botFolder(env);
  if (!folder) return { ok: false, message: 'termfleet-memory works inside a bot (no bot id here).' };
  const [command, ...rest] = args;
  const memory = new BotMemory(folder);
  if (command === 'search') {
    const query = rest.join(' ').trim();
    if (!query) return { ok: false, message: 'Say what to look for.' };
    let messages = [];
    try { messages = readFileSync(path.join(folder, 'chat.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { /* new bot */ }
    const hits = searchChat(messages, query);
    if (!hits.length) return { ok: true, message: 'Nothing in past conversations matches that.' };
    return { ok: true, message: hits.map((h) => `[${h.at ? new Date(h.at).toISOString().slice(0, 16).replace('T', ' ') : '?'} ${h.who}] ${h.snippet}`).join('\n\n') };
  }
  if (command === 'propose') {
    let kind = 'fact';
    const words = [];
    for (let i = 0; i < rest.length; i++) { if (rest[i] === '--kind') { kind = rest[i + 1]; i++; } else words.push(rest[i]); }
    if (!KINDS.includes(kind)) return { ok: false, message: `Kind must be one of: ${KINDS.join(', ')}.` };
    const made = memory.propose({ text: words.join(' '), kind, source: 'bot' });
    if (made.error) return { ok: false, message: made.error };
    return { ok: true, message: made.duplicate ? 'Already remembered or waiting for Noam.' : 'Suggested. It is used only after Noam approves it.' };
  }
  if (command === 'card') return { ok: true, message: memory.card() || 'Nothing approved yet.' };
  if (command === 'profile') {
    const flags = {};
    for (let i = 0; i < rest.length; i++) if (rest[i].startsWith('--')) { flags[rest[i].slice(2)] = rest[i + 1] || ''; i++; }
    const job = String(flags.job || '').trim().slice(0, 80);
    const rules = String(flags.rules || '').trim().slice(0, 4000);
    if (!job) return { ok: false, message: 'Give your job in a few words with --job.' };
    const file = path.join(folder, 'bot.json');
    let bot;
    try { bot = JSON.parse(readFileSync(file, 'utf8')); } catch { return { ok: false, message: 'Could not read this bot.' }; }
    bot.proposedProfile = { job, rules, at: Date.now() };
    writeFileSync(`${file}.${process.pid}.tmp`, JSON.stringify(bot, null, 1), { mode: 0o600 });
    renameSync(`${file}.${process.pid}.tmp`, file);
    return { ok: true, message: 'Offered to Noam. It becomes your job and rules once he accepts.' };
  }
  return { ok: false, message: readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') };
}

const startedAsCommand = (() => {
  try { return realpathSync(process.argv[1] ?? '') === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
})();
if (startedAsCommand) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.message + '\n');
  process.exit(result.ok ? 0 : 1);
}
