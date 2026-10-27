#!/usr/bin/env node
// termfleet-session-digest: what earlier agent sessions in a folder said (complaint #6).
//   termfleet-session-digest recent [--cwd DIR] [--days 14] [--limit 8]
//   termfleet-session-digest search <words...> [--cwd DIR] [--days 60] [--limit 12]
//   termfleet-session-digest show <session-id-start> [--cwd DIR] [--tail 20]
// Read-only: it reads the Claude and Codex records already on this computer and copies nothing.
import { pathToFileURL } from 'node:url';
import { recentDigest, searchSessions, showSession } from './lib/session-digest.mjs';

export function parseArgs(argv) {
  const positional = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { flags[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else positional.push(argv[i]);
  }
  return { positional, flags };
}

export function run(argv, { cwd = process.cwd(), out = (s) => console.log(s) } = {}) {
  const { positional, flags } = parseArgs(argv);
  const [command, ...rest] = positional;
  const dir = typeof flags.cwd === 'string' ? flags.cwd : cwd;
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  if (command === 'recent') {
    const lines = recentDigest(dir, { days: num(flags.days, 14), limit: num(flags.limit, 8) });
    out(lines.length ? `Earlier agent sessions in ${dir} (newest first):\n${lines.join('\n')}` : `No earlier agent sessions found for ${dir}.`);
    return lines.length ? 0 : 1;
  }
  if (command === 'search' && rest.length) {
    const hits = searchSessions(dir, rest.join(' '), { days: num(flags.days, 60), limit: num(flags.limit, 12) });
    out(hits.length ? hits.join('\n') : `Nothing in earlier sessions in ${dir} mentions: ${rest.join(' ')}`);
    return hits.length ? 0 : 1;
  }
  if (command === 'show' && rest[0]) {
    const lines = showSession(dir, rest[0], { tail: num(flags.tail, 20) });
    out(lines.length ? lines.join('\n') : `No session starting with ${rest[0]} in ${dir}.`);
    return lines.length ? 0 : 1;
  }
  out('Usage: termfleet-session-digest recent | search <words> | show <id-start>   [--cwd DIR] [--days N] [--limit N] [--tail N]');
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(run(process.argv.slice(2)));
