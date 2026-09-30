import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');

export const PATHS = {
  workspace: path.join(dataHome, 'terminal-workspace', 'workspace.json'),
  agentStatus: path.join(dataHome, 'terminal-workspace', 'agent-status'),
  claudeProjects: path.join(home, '.claude', 'projects'),
  codexSessions: path.join(home, '.codex', 'sessions'),
  // OpenCode keeps every conversation in one SQLite database rather than one
  // file per session, so the adapter queries it instead of tailing a log.
  opencodeDb: path.join(dataHome, 'opencode', 'opencode.db'),
};

/**
 * Claude stores transcripts under a slug of the cwd with every character that
 * is not a letter or digit turned into a dash — `comfyui_07` becomes
 * `comfyui-07`. Replacing only slashes missed those folders, so the phone
 * found no conversation and fell back to a raw screen scrape.
 */
export function claudeSlug(cwd) {
  return String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * The transcript for a Claude session, found by its folder slug first and by
 * its session id across every project folder second (the pane's recorded cwd
 * can differ from the folder Claude filed the session under).
 */
export function claudeTranscript(cwd, sessionId) {
  if (!sessionId) return null;
  const name = `${sessionId}.jsonl`;
  const direct = path.join(PATHS.claudeProjects, claudeSlug(cwd), name);
  if (fs.existsSync(direct)) return direct;
  let dirs = [];
  try { dirs = fs.readdirSync(PATHS.claudeProjects); } catch { return null; }
  for (const dir of dirs) {
    const p = path.join(PATHS.claudeProjects, dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
