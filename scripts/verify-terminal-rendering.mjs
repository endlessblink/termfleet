import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
// Source-contract checks assert on code SHAPE, not line wrapping: an editor or
// prettier pass that rewraps untouched code must not turn these gates red.
// Collapsing whitespace runs to a single space keeps the assertions meaningful
// (identifiers, order, and punctuation still have to match) while surviving
// reformatting. Block slicing below needs real newlines, so it reads raw text
// and flattens the slice.
const flattenSource = (text) => text.replace(/\s+/g, " ");
const readSource = (path) => flattenSource(readFileSync(join(root, path), "utf8"));
const readRawSource = (path) => readFileSync(join(root, path), "utf8");

const terminal = readSource("src/components/Terminal.tsx");
const splitPane = readSource("src/components/SplitPane.tsx");
const header = readSource("src/components/WorkbenchHeader.tsx");
const sidebar = readSource("src/components/WorkbenchSidebar.tsx");
const globalCss = readSource("src/styles/global.css");
const themeCss = readSource("src/styles/theme.css");
const pty = readSource("src-tauri/src/pty.rs");
const terminalRaw = readRawSource("src/components/Terminal.tsx");
const globalCssRaw = readRawSource("src/styles/global.css");
const livePulseKeyframe = flattenSource(globalCssRaw.match(/@keyframes terminal-live-pulse\s*\{([\s\S]*?)\n\}/)?.[1] ?? "");
const snapshotExcerptBlock = flattenSource(terminalRaw.match(
  /const runSnapshotExcerpt\s*=\s*useCallback\([\s\S]*?(?=\n\s*const handleSnapshot)/,
)?.[0] ?? "");
const snapshotHandlerBlock = flattenSource(terminalRaw.match(
  /const handleSnapshot\s*=\s*useCallback\([\s\S]*?(?=\n\s*const storeSubmittedAsk)/,
)?.[0] ?? "");

const checks = [
  {
    ok: /fontFamily:\s*'"JetBrains Mono", "FiraCode Nerd Font", "MesloLGS NF", "Geist Mono"/.test(terminal),
    message: "xterm must use a TUI-capable mono stack with Nerd Font fallbacks.",
  },
  {
    ok: /letterSpacing:\s*0/.test(terminal) && /lineHeight:\s*1\.16/.test(terminal),
    message: "xterm cell metrics must stay tight and unwarped.",
  },
  {
    ok: /const webglAddon = new WebglAddon\(\);/.test(terminal) &&
      /falling back to DOM renderer/.test(terminal),
    message: "xterm must enable WebGL when available and fall back cleanly.",
  },
  {
    ok: /function terminalThemeFromTokens/.test(terminal) &&
      /theme:\s*terminalTheme/.test(terminal) &&
      /--terminal-bg:/.test(themeCss) &&
      /--terminal-ansi-bright-white:/.test(themeCss),
    message: "xterm colors must resolve from shared terminal CSS tokens.",
  },
  {
    ok: /\.terminal-container\s*\{[\s\S]*padding:\s*0;/.test(globalCss),
    message: "terminal container must not add padding that steals TUI cells.",
  },
  {
    // The class may be applied literally or built in a template string; the
    // contract is that the rail exists outside the cell grid, not how the
    // attribute happens to be written.
    ok: /className=[{"`][^\n]*terminal-block-shell/.test(terminal) &&
      /className=[{"`][^\n]*terminal-block-rail/.test(terminal) &&
      /\.terminal-block-shell\s*\{[\s\S]*grid-template-columns:\s*24px minmax\(0, 1fr\);/.test(globalCss) &&
      /--terminal-block-marker-active:/.test(themeCss),
    message: "terminal blocks must be represented by a rail outside the xterm cell grid.",
  },
  {
    ok: /className="terminal-pane-status-dot"/.test(splitPane) &&
      /data-status=\{terminalStatus\}/.test(splitPane) &&
      /@keyframes terminal-live-pulse/.test(globalCss) &&
      /prefers-reduced-motion:\s*reduce/.test(globalCss),
    message: "terminal live-state motion must be source-visible and reduced-motion safe.",
  },
  {
    ok: /SNAPSHOT_EXCERPT_THROTTLE_MS\s*=\s*500/.test(terminal) &&
      /latestSnapshotRef\.current\s*=\s*snapshot/.test(terminal) &&
      /snapshotThrottleTimerRef\.current\s*=\s*setTimeout/.test(terminal) &&
      /runSnapshotExcerpt\(\);/.test(terminal) &&
      /clearTimeout\(snapshotThrottleTimerRef\.current\)/.test(terminal) &&
      /terminalVisibleText:\s*excerpt/.test(snapshotExcerptBlock) &&
      !/terminalOutput\s*:|currentActivity\s*:|scheduleStatusSummaryUpdate\(/.test(snapshotExcerptBlock) &&
      !/scheduleStatusSummaryUpdate\(/.test(snapshotHandlerBlock),
    message: "canvas snapshot excerpt work must be throttled with a trailing update and unmount cleanup, without re-summarizing scroll-driven viewport snapshots.",
  },
  {
    ok: !/box-shadow/.test(livePulseKeyframe) &&
      /transform:\s*scale\(1\.18\)/.test(livePulseKeyframe) &&
      /box-shadow:\s*0 0 0 3px color-mix\(in srgb, currentColor 10%, transparent\)/.test(globalCss),
    message: "terminal live pulse animation must avoid repaint-heavy animated box-shadow while preserving a static glow ring.",
  },
  {
    ok: /event\.ctrlKey && event\.shiftKey && key === "t"/.test(header) &&
      /shortcut:\s*"Ctrl Shift T"/.test(header) &&
      /Ctrl\+Shift\+T/.test(sidebar) &&
      /Right-click for launch configurations/.test(sidebar) &&
      /aria-haspopup="menu"/.test(sidebar) &&
      /role="menu"/.test(sidebar) &&
      /role="menuitem"/.test(sidebar) &&
      /event\.key === "ArrowDown"/.test(sidebar),
    message: "new-terminal creation must have matching Ctrl+Shift+T and plus-button launch affordances.",
  },
  {
    ok: /style=\{\{\s*flex:\s*1,\s*minHeight:\s*0,\s*minWidth:\s*0,\s*display:\s*"flex",\s*\}\}/.test(splitPane) &&
      /style=\{\{\s*flex: 1, minHeight: 0, minWidth: 0, height: "100%", display: "flex", flexDirection: "column",?\s*\}\}/.test(splitPane) &&
      !/terminalHeight/.test(splitPane),
    message: "split panes must flex-fill terminal bodies instead of subtracting manual heights.",
  },
  {
    ok: /cmd\.env\(\s*"TERM",\s*"xterm-256color"\s*\);/.test(pty) &&
      /cmd\.env\(\s*"COLORTERM",\s*"truecolor"\s*\);/.test(pty) &&
      /cmd\.env\(\s*"LANG",/.test(pty) &&
      /cmd\.env\(\s*"LC_CTYPE",/.test(pty),
    message: "PTYs must advertise terminal and locale capabilities for TUIs.",
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure.message}`);
  process.exit(1);
}

console.log("Terminal rendering source checks passed.");
