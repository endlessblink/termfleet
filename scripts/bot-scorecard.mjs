#!/usr/bin/env node
// Bot productivity scorecard (2026-10-26): the numbers the reliability plan is judged by, from the
// records themselves. Usage: node scripts/bot-scorecard.mjs [--since <ISO or ms>] [--repo <path>] [--bot <id>]
// Reads only; prints one block.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const sinceArg = flag('since', String(Date.now() - 24 * 3600_000));
const since = /^\d+$/.test(sinceArg) ? Number(sinceArg) : Date.parse(sinceArg);
const repo = flag('repo', process.cwd());
const bot = flag('bot', '');
if (!bot) {
  console.error('Usage: bot-scorecard --bot <id> [--repo <path>] [--since <ISO or ms>]');
  process.exit(2);
}
const hours = (Date.now() - since) / 3600_000;

// 1. Commits: real code vs proof/process.
const PROOF = /^(docs|test)\b|proof|provenance|record|review|receipt|evidence|preview|sweep|checkpoint|report/i;
let commits = [];
try { commits = execFileSync('git', ['-C', repo, 'log', '--all', `--since=${new Date(since).toISOString()}`, '--format=%s'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { commits = []; }
const proof = commits.filter((s) => PROOF.test(s)).length;

// 2. Requests from Noam to this bot: captured, finished, status churn.
const ev = fs.readFileSync(path.join(os.homedir(), '.local/share/termfleet/requirements/ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const mine = new Set(ev.filter((e) => e.e === 'capture' && e.source === `bot:${bot}`).map((e) => e.id));
const newItems = ev.filter((e) => e.e === 'capture' && e.source === `bot:${bot}` && e.at >= since);
const marks = ev.filter((e) => e.e === 'status' && mine.has(e.id) && e.at >= since);
const finished = new Set(marks.filter((e) => ['ready', 'done'].includes(e.status)).map((e) => e.id));
const partialMarks = marks.filter((e) => e.status === 'partial').length;

// 3. Stop-gate blocks in agent records since then (Codex rollouts and Claude transcripts of the repo).
let blocks = 0;
const scan = (dir, depth = 0) => {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && depth < 4) scan(p, depth + 1);
    else if (e.name.endsWith('.jsonl')) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.mtimeMs < since || st.size > 300e6) continue;
      const text = fs.readFileSync(p, 'utf8');
      if (!text.includes(path.basename(repo))) continue;
      for (const m of text.matchAll(/"timestamp":"([^"]+)"[^\n]*items nobody has taken yet/g)) if (Date.parse(m[1]) >= since) blocks++;
    }
  }
};
const now = new Date();
for (const d of [0, 1]) { const t = new Date(now - d * 86400_000); scan(path.join(os.homedir(), '.codex/sessions', String(t.getFullYear()), String(t.getMonth() + 1).padStart(2, '0'), String(t.getDate()).padStart(2, '0'))); }

console.log(`Bot scorecard since ${new Date(since).toLocaleString('en-GB', { timeZone: 'Asia/Jerusalem' })} (${hours.toFixed(1)} h)`);
console.log(`- commits: ${commits.length} (${(commits.length / hours).toFixed(1)}/h); proof/process ${proof} (${commits.length ? Math.round((proof / commits.length) * 100) : 0}%), code ${commits.length - proof}`);
console.log(`- Noam's new requests: ${newItems.length}; requests finished (ready/done): ${finished.size}; 'partial' re-marks: ${partialMarks}`);
console.log(`- stop-gate blocks ("items nobody has taken") in Codex agents on this repo: ${blocks}`);
