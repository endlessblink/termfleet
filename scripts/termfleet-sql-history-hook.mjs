#!/usr/bin/env node
// SessionStart reads event metadata for this exact terminal; never global/cwd history.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const identity = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\s\x00-\x1f\x7f]/.test(value) ? value : null;

export function resolveTerminalId(payload = {}, env = process.env) {
  const pane = identity(env.TERMFLEET_PANE_ID);
  if (pane) return pane;
  const session = identity(payload.session_id);
  if (!session) return null;
  const dir = path.join(env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share'), 'terminal-workspace', 'agent-status');
  const matches = new Set();
  try {
    for (const name of fs.readdirSync(dir)) {
      if (!/^pane-.*\.json$/.test(name)) continue;
      try {
        const status = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        if (status.sessionId === session && identity(status.paneId)) matches.add(status.paneId);
      } catch { /* Unreadable metadata does not establish identity. */ }
    }
  } catch { return null; }
  return matches.size === 1 ? [...matches][0] : null;
}

export async function fetchTerminalHistory(terminalId, { fetchImpl = fetch, baseUrl = 'http://127.0.0.1:7810' } = {}) {
  if (!identity(terminalId)) return null;
  try {
    const params = new URLSearchParams({ terminal_id: terminalId, limit: '20', order: 'desc' });
    const res = await fetchImpl(`${baseUrl}/api/events/query?${params}`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const { events } = await res.json();
    if (!Array.isArray(events)) return null;
    // Defend against a stale or unscoped service without showing another terminal's metadata.
    const scoped = events.filter(e => e?.terminal_id === terminalId).slice(0, 20);
    if (!scoped.length) return null;
    scoped.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || Number(a.id) - Number(b.id));
    const lines = scoped.map(e => {
      const date = new Date(e.created_at), time = Number.isFinite(date.getTime()) ? date.toISOString().slice(11, 19) : 'unknown time';
      const p = e.payload && typeof e.payload === 'object' ? e.payload : {};
      const count = Number.isFinite(p.characters) && p.characters >= 0 ? p.characters : 0;
      const role = ['user', 'assistant', 'system', 'tool'].includes(p.role) ? p.role : 'message';
      const detail = e.event_type === 'message' ? `${role} (${count} chars)`
        : e.event_type === 'tool_use' ? 'tool used'
        : e.event_type === 'start' ? 'session started'
        : e.event_type === 'close' ? 'session closed'
        : e.event_type === 'stall' ? 'terminal stalled'
        : 'event recorded';
      const predecessor = identity(p.healthRecovery?.predecessor_terminal_id || p.predecessor_terminal_id);
      return `${time} ${detail}${predecessor ? `; Recovery predecessor: ${predecessor}` : ''}`;
    });
    return `[SQL Event Log — newest ${scoped.length} events for terminal ${terminalId}, chronological]\n${lines.join('\n')}`;
  } catch { return null; }
}

export async function sessionStartOutput(payload = {}, { env = process.env, ...options } = {}) {
  const terminalId = resolveTerminalId(payload, env);
  if (!terminalId) return {};
  const history = await fetchTerminalHistory(terminalId, options);
  return history ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: history } } : {};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let raw = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    let payload = {};
    try { payload = JSON.parse(raw || '{}') || {}; } catch { /* Empty context for invalid input. */ }
    process.stdout.write(JSON.stringify(await sessionStartOutput(payload)));
  } catch { process.stdout.write('{}'); }
}
