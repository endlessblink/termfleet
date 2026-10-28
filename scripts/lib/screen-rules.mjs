// Noam 2026-10-27: "rule to the entire app - never run headed tests that take over my screen unless I approve
// them with a button question in the app". This decides whether a tool call would open a visible window or
// drive his real screen. Private virtual displays (xvfb-run) and headless browsers never do.
import fs from 'node:fs';

/** Tools that always drive a visible browser or application window. */
const SCREEN_TOOLS = [
  [/^mcp__claude-in-chrome__/, 'drives your real Chrome window'],
  [/^mcp__playwright__browser_(?!close$|install$)/, 'opens a visible browser window'],
  [/^mcp__DaVinci_Resolve__launch_resolve$/, 'opens DaVinci Resolve on your screen'],
  [/^mcp__in-control__/, 'drives a browser on your screen'],
];

/** Commands that only read, search or print: a risky word inside them is text, not an action. */
const READ_ONLY = new Set(['grep', 'egrep', 'fgrep', 'rg', 'cat', 'ls', 'echo', 'printf', 'sed', 'awk', 'head', 'tail', 'wc', 'jq', 'git', 'diff', 'find', 'which', 'man', 'less', 'termfleet-sure', 'termfleet-asks', 'termfleet-say', 'termfleet-team', 'ctx_search', 'cut', 'sort', 'uniq', 'tr', 'tee', 'stat', 'file', 'basename', 'dirname', 'realpath', 'sleep', 'date', 'pgrep', 'ps']);
const WRAPPERS = new Set(['sudo', 'nice', 'ionice', 'env', 'time', 'command', 'exec', 'nohup', 'timeout', 'systemd-run']);

/** The program a shell segment runs, skipping env assignments and wrappers like `nice -n 15 timeout 60`. */
function program(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/^["'(]+/, '');
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) continue;
    if (WRAPPERS.has(w)) { while (words[i + 1] && /^(-|\d)/.test(words[i + 1])) i++; continue; }
    return w.split('/').pop();
  }
  return '';
}

const BROWSERS = /^(firefox|google-chrome(-stable)?|chromium(-browser)?|chrome|brave(-browser)?|microsoft-edge|epiphany)$/;
const DRIVERS = /^(xdotool|wmctrl|ydotool|xte|xdg-open|gnome-open)$/;

function scriptSource(segment) {
  const m = /\b(?:node|python3?|bash|sh|tsx)\s+(?:-[-\w]+\s+)*(\S+\.(?:mjs|js|ts|py|sh))/.exec(segment);
  if (!m) return '';
  try { return fs.readFileSync(m[1], 'utf8').slice(0, 200_000); } catch { return ''; }
}

/** Why a shell command would take over the screen, or null when it will not. */
export function shellScreenRisk(command) {
  const text = String(command || '');
  if (!text.trim()) return null;
  for (const segment of text.split(/\n|&&|\|\||;|\|/)) {
    const prog = program(segment);
    if (!prog || READ_ONLY.has(prog)) continue;
    if (/\bxvfb-run\b|\bXvfb\b/.test(segment) && !/DISPLAY=:\d/.test(segment)) continue;   // a private virtual screen
    const headless = /--headless\b/.test(segment);
    if (/--headed\b|\bPWDEBUG=1\b|--no-headless\b|headless[\s:=]+(?:false|False|0)\b/.test(segment)) return 'runs a visible (headed) browser';
    if (/\bplaywright\s+(?:codegen|open|show-report)\b|\bplaywright\s+test\b[^\n]*--ui\b/.test(segment)) return 'opens a Playwright window';
    if (/(?:^|\s)(?:npm run |npx |pnpm |yarn )?tauri[: ]dev\b|\brun-dev\.sh\b|\brun-native-vte-dev\.sh\b/.test(segment)) return 'opens the TermFleet app window';
    if (/\bDISPLAY=:\d/.test(segment)) return 'uses your real screen (DISPLAY)';
    if (DRIVERS.test(prog)) return `runs ${prog}, which acts on your screen`;
    if (BROWSERS.test(prog) && !headless) return `opens a visible ${prog} window`;
    const source = scriptSource(segment);
    if (source && /\.launch(?:_persistent_context|PersistentContext)?\s*\([^)]*headless\s*[:=]\s*(?:false|False)\b/.test(source)) return 'runs a script that launches a visible (headed) browser';
  }
  return null;
}

/** Why a tool call would take over the screen, or null. `input` is the tool's input object. */
export function screenRisk(toolName, input = {}) {
  const tool = String(toolName || '');
  for (const [pattern, why] of SCREEN_TOOLS) if (pattern.test(tool)) return why;
  if (/^(Bash|bash|shell|local_shell|exec_command|container\.exec)$/.test(tool)) {
    const command = typeof input?.command === 'string' ? input.command : Array.isArray(input?.command) ? input.command.join(' ') : typeof input?.cmd === 'string' ? input.cmd : '';
    return shellScreenRisk(command);
  }
  return null;
}
