import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');

export const PATHS = {
  workspace: path.join(dataHome, 'terminal-workspace', 'workspace.json'),
  agentStatus: path.join(dataHome, 'terminal-workspace', 'agent-status'),
  claudeProjects: path.join(home, '.claude', 'projects'),
  codexSessions: path.join(home, '.codex', 'sessions'),
};

/** Claude stores transcripts under a slug of the cwd with every separator as a dash. */
export function claudeSlug(cwd) {
  return String(cwd || '').replace(/\//g, '-');
}
