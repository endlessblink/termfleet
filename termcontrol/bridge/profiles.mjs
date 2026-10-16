import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * A teammate's profile (TF-096, after Grok Bot's "Edit Profile"): a name you call
 * it by, a short job title, and standing rules it keeps for the whole
 * conversation. Kept on this machine so desktop and phone show the same names.
 */
const defaultFile = () => path.join(process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol'), 'profiles.json');

export const LIMITS = { name: 40, job: 60, rules: 4000 };

const clean = (value, max) => String(value ?? '').replace(/\s+$/g, '').replace(/^\s+/g, '').slice(0, max);

export class Profiles {
  constructor(file = defaultFile()) { this.file = file; }

  all() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  }

  get(id) { return this.all()[id] || null; }

  save(id, { name, job, rules }) {
    if (!id) return { error: 'Say which agent.' };
    const all = this.all();
    const before = all[id] || {};
    const next = {
      name: clean(name, LIMITS.name).replace(/\s+/g, ' '),
      job: clean(job, LIMITS.job).replace(/\s+/g, ' '),
      rules: clean(rules, LIMITS.rules),
    };
    if (next.name && !/^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(next.name)) return { error: 'Use letters, numbers and spaces for the name.' };
    const empty = !next.name && !next.job && !next.rules;
    if (empty) delete all[id]; else all[id] = { ...next, updatedAt: Date.now() };
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return { ok: true, profile: empty ? null : all[id], rulesChanged: (before.rules || '') !== next.rules };
  }
}

/** What the agent is told when its standing rules change. */
export function rulesMessage(profile) {
  const who = profile.name ? `You are "${profile.name}"${profile.job ? `, ${profile.job}` : ''}. ` : '';
  return `${who}Standing rules from the operator — keep them for the rest of this conversation, above any single task:\n${profile.rules}`;
}

export const profiles = new Profiles();
