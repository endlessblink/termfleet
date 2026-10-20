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

/** The plain icon with up to two round badges drawn on its right side. */
export function dockIconSvg(baseSvg, bots, terminals) {
  const badge = (n, cy, fill) => {
    if (!n) return '';
    const text = label(n), r = text.length > 2 ? 27 : 24, size = text.length > 2 ? 22 : text.length > 1 ? 28 : 32;
    return `<circle cx="74" cy="${cy}" r="${r}" fill="${fill}" stroke="#141312" stroke-width="3"/><text x="74" y="${(cy + size * 0.36).toFixed(1)}" font-size="${size}" fill="#141312">${text}</text>`;
  };
  const marks = badge(bots, 26, BOT_COLOUR) + badge(terminals, 74, TERMINAL_COLOUR);
  if (!marks) return baseSvg;
  return baseSvg.replace(/<\/svg>\s*$/, `<g font-family="Rubik,'Noto Sans',sans-serif" font-weight="700" text-anchor="middle">${marks}</g></svg>\n`);
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
