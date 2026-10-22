#!/usr/bin/env node
// termfleet-priority — CPU priority for agent terminals (see lib/cpu-priority.mjs).
//
//   termfleet-priority status [<pane>]            urgent or not (all urgent terminals without a pane)
//   termfleet-priority urgent on|off --self --noam-said "<his words>"   an agent, only when Noam asked
//   termfleet-priority urgent on|off --self --owner-words <id>          same, with verified words
//   termfleet-priority urgent on|off <pane> --from-ui                   the map menu / phone toggle
//   termfleet-priority weight [<1-100>]           the share every agent terminal gets (default 20)
//   termfleet-priority apply                      re-apply the weight + urgent marks (timer)
// Add --json for machine output. Never kills or pauses anything.
import {
  readPrioritySettings, writePrioritySettings, setUrgent, urgentStatus, listUrgent,
  reconcileUrgent, applyAgentWeight, selfRequestAllowed,
} from './lib/cpu-priority.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !['--noam-said', '--owner-words'].includes(argv[i - 1]));
const json = flag('--json');
const out = (data, text) => { console.log(json ? JSON.stringify(data) : text); };
const fail = (message, code = 2) => { if (json) console.log(JSON.stringify({ ok: false, error: message })); else console.error(message); process.exit(code); };

async function verifyOwnerWords(id) {
  try {
    const { findOwnerWords } = await import('../termcontrol/bridge/owner-words.mjs');
    return findOwnerWords(id);
  } catch { return null; }
}

async function main() {
  const [cmd, a1, a2] = positional;
  if (!cmd || cmd === 'help' || flag('--help')) {
    console.log('termfleet-priority status [<pane>] | urgent on|off (<pane> --from-ui | --self --noam-said "<words>" | --self --owner-words <id>) | weight [<1-100>] | apply  [--json]');
    return;
  }
  if (cmd === 'status') {
    if (a1) { const s = urgentStatus(a1); return out(s, s.urgent ? `Urgent (since ${new Date(s.since).toLocaleString()}, by ${s.by})` : 'Normal (agent share)'); }
    const list = listUrgent();
    return out({ ok: true, ...readPrioritySettings(), urgent: list }, `Agent share: ${readPrioritySettings().agentWeight}. Urgent terminals: ${list.length ? list.map((u) => u.paneId).join(', ') : 'none'}`);
  }
  if (cmd === 'weight') {
    if (a1 === undefined) return out({ ok: true, ...readPrioritySettings() }, String(readPrioritySettings().agentWeight));
    const next = writePrioritySettings(undefined, { agentWeight: Number(a1) });
    if (next.agentWeight !== Number(a1)) fail('The share must be a whole number from 1 to 100.');
    const applied = applyAgentWeight();
    return out({ ok: true, ...applied }, `Agent share set to ${applied.agentWeight} (applied to ${applied.units.length} running terminal service${applied.units.length === 1 ? '' : 's'}).`);
  }
  if (cmd === 'apply') {
    const applied = applyAgentWeight();
    const urgent = reconcileUrgent();
    return out({ ok: true, ...applied, urgent }, `Agent share ${applied.agentWeight} on ${applied.units.join(', ') || 'no running service'}; urgent re-checked: ${urgent.length}.`);
  }
  if (cmd === 'urgent') {
    const on = a1 === 'on' ? true : a1 === 'off' ? false : null;
    if (on === null) fail('Say urgent on or urgent off.');
    let pane = a2;
    let by = 'noam';
    let reason = null;
    if (flag('--self')) {
      pane = process.env.TERMFLEET_PANE_ID;
      if (!pane) fail('--self works only inside a TermFleet terminal.');
      if (on) {
        const ownerWords = value('--owner-words');
        const entry = ownerWords ? await verifyOwnerWords(ownerWords) : null;
        const result = selfRequestAllowed({ noamSaid: value('--noam-said'), ownerWords, verify: () => entry });
        if (!result.ok) fail(result.error);
        by = 'agent';
        reason = result.reason;
      }
    } else if (!flag('--from-ui')) {
      fail('Agents: use --self with Noam\'s words. The map menu and phone pass --from-ui.');
    }
    if (!pane) fail('Which terminal? Pass its id.');
    const res = setUrgent(pane, on, { by, reason });
    if (!res.ok) fail(res.error, 1);
    return out(res, on ? 'This terminal now runs at full priority (Urgent).' : 'This terminal is back to the gentle agent share.');
  }
  fail(`Unknown command: ${cmd}`);
}

main().catch((error) => fail(error?.message || String(error), 1));
