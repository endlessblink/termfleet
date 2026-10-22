#!/usr/bin/env node
// The waiter behind `termfleet-team close self`: started outside the agent's terminal, it
// waits until the agent's final reply is saved (its turn ended), then closes the terminal
// through the app's own close, which also ends its processes. Gives up if Noam is asked
// something meanwhile. One line per outcome in self-close.log.
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { closeWhenIdle } from './lib/team-close.mjs';
import { requestClose } from './lib/close-request.mjs';
import { fleetPanes, stateOf } from '../termcontrol/bridge/orchestrate.mjs';

const paneId = process.argv[2];
const dir = join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'terminal-workspace');
const log = (text) => { try { mkdirSync(dir, { recursive: true }); appendFileSync(join(dir, 'self-close.log'), `${new Date().toISOString()} ${paneId} ${text}\n`); } catch { /* best effort */ } };
if (!paneId?.startsWith('terminal-')) { log('no terminal id'); process.exit(1); }
// The close ends this waiter too (it runs under the terminal's own process group in the
// daemon's eyes), so the line is written just before asking.
const r = await closeWhenIdle(paneId, { look: () => fleetPanes(), request: (id, opts) => { log('reply saved; closing now'); return requestClose(id, opts); }, stateOf });
log(r.text);
process.exit(r.ok ? 0 : 2);
