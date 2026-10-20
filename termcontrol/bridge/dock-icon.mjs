import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

/**
 * Two counts on the TermFleet dock icon (Noam 2026-10-20: "I need to see numbers here too...
 * one colour for agents and another for terminals, both shown"). Plasma's dock draws the
 * launcher's own icon and its badge API carries one number, so the icon itself is redrawn
 * with both badges and the launcher is pointed at it: bots unread in orange (top), terminals
 * waiting for Noam in blue (bottom). Both zero = the plain icon again.
 */
export const BOT_COLOUR = '#d97757';
export const TERMINAL_COLOUR = '#5aa9e6';

const label = (n) => (n > 99 ? '99+' : String(n));

/**
 * The plain icon with two small dots on its right edge (Noam picked "Two small dots" after
 * the first, bigger badges were "a bit overpowering"): bots unread in orange on top,
 * terminals waiting in blue below it (or on top when there are no bot messages).
 */
export function dockIconSvg(baseSvg, bots, terminals) {
  const dot = (n, cy, fill) => {
    if (!n) return '';
    const text = label(n), size = text.length > 2 ? 13 : text.length > 1 ? 17 : 20;
    return `<circle cx="86" cy="${cy}" r="15" fill="${fill}" stroke="#141312" stroke-width="3"/><text x="86" y="${(cy + size * 0.36).toFixed(1)}" font-size="${size}" fill="#141312">${text}</text>`;
  };
  const marks = dot(bots, 17, BOT_COLOUR) + dot(terminals, bots ? 50 : 17, TERMINAL_COLOUR);
  if (!marks) return baseSvg;
  return baseSvg.replace(/<\/svg>\s*$/, `<g font-family="Rubik,'Noto Sans',sans-serif" font-weight="500" text-anchor="middle">${marks}</g></svg>\n`);
}

/** Points the launcher's Icon= line at `icon` (a theme name or a file path). */
export function withIcon(desktopText, icon) {
  return /^Icon=.*$/m.test(desktopText) ? desktopText.replace(/^Icon=.*$/m, `Icon=${icon}`) : desktopText.replace(/^\[Desktop Entry\]$/m, `[Desktop Entry]\nIcon=${icon}`);
}

export function createDockIcon({
  home = os.homedir(),
  desktopFile = path.join(home, '.local', 'share', 'applications', 'termfleet.desktop'),
  baseIcon = path.join(home, '.local', 'share', 'icons', 'hicolor', 'scalable', 'apps', 'termfleet.svg'),
  dir = path.join(home, '.local', 'share', 'termfleet', 'dock-icon'),
  refresh = () => new Promise((resolve) => execFile('kbuildsycoca6', [], { timeout: 30000 }, () => resolve())),
} = {}) {
  let last = null;
  return async function update(bots, terminals) {
    bots = Math.max(0, Math.floor(Number(bots)) || 0); terminals = Math.max(0, Math.floor(Number(terminals)) || 0);
    const key = `${bots}/${terminals}`;
    let desktop, base;
    try { desktop = fs.readFileSync(desktopFile, 'utf8'); base = fs.readFileSync(baseIcon, 'utf8'); } catch { return false; }
    const icon = bots || terminals ? path.join(dir, `termfleet-b${bots}-t${terminals}.svg`) : 'termfleet';
    // Unchanged counts and the launcher still points where it should (a reinstall resets it).
    if (key === last && desktop.includes(`\nIcon=${icon}\n`)) return false;
    fs.mkdirSync(dir, { recursive: true });
    // A new file name per count: the dock caches icons by name.
    for (const old of fs.readdirSync(dir)) if (/^termfleet-b\d+-t\d+\.svg$/.test(old) && path.join(dir, old) !== icon) fs.rmSync(path.join(dir, old), { force: true });
    if (icon !== 'termfleet') fs.writeFileSync(icon, dockIconSvg(base, bots, terminals));
    const next = withIcon(desktop, icon);
    if (next !== desktop) { const tmp = `${desktopFile}.${process.pid}.tmp`; fs.writeFileSync(tmp, next); fs.renameSync(tmp, desktopFile); }
    last = key;
    await refresh();
    return true;
  };
}
