// Single JS/canvas mirror of the CSS design tokens (src/styles/theme.css).
// CSS stays the source of truth: readTokens() reads the computed values off
// <html>, so flipping <html data-accent="A|B|C"> re-colours canvas drawing too.
// The literals below are only (a) the persisted identity colours, stored once as
// data, and (b) fallbacks for environments with no stylesheet (unit tests).

import { useEffect, useState } from "react";
import type { RenderTheme } from "./gridRenderer";

/** Muted project/group identity colours (--identity-1..6). Persisted per group. */
export const IDENTITY_COLORS = [
  "#86979c",
  "#98a08a",
  "#9a95a8",
  "#a39a86",
  "#8b9aa8",
  "#a68f94",
] as const;

export interface TermfleetTokens {
  /** 16 ANSI colours, index 0-7 normal, 8-15 bright (brights reuse normals except bright black). */
  ansi: string[];
  terminalBg: string;
  terminalFg: string;
  terminalCursor: string;
  terminalSelectionBg: string;
  accent: string;
  accentHi: string;
  accentFill: string;
  accentTint: string;
  stateRunning: string;
  stateWaiting: string;
  stateIdle: string;
  stateFailed: string;
  stateDone: string;
  identity: string[];
}

const FALLBACK: TermfleetTokens = {
  ansi: [
    "#0a0a0b", "#d88383", "#93bda1", "#dcb875", "#89afd6", "#c59bc0", "#81b6b8", "#ececee",
    "#8a8a91", "#d88383", "#93bda1", "#dcb875", "#89afd6", "#c59bc0", "#81b6b8", "#ececee",
  ],
  terminalBg: "#0a0a0b",
  terminalFg: "#c4c4ca",
  terminalCursor: "#ececee",
  terminalSelectionBg: "#1e2127",
  accent: "#85a1c5",
  accentHi: "#9db7d8",
  accentFill: "#7188a6",
  accentTint: "#1e2127",
  stateRunning: "#93bda1",
  stateWaiting: "#dcb875",
  stateIdle: "#8a8a91",
  stateFailed: "#d88383",
  stateDone: "#81b6b8",
  identity: [...IDENTITY_COLORS],
};

const ANSI_NAMES = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "bright-black", "bright-red", "bright-green", "bright-yellow",
  "bright-blue", "bright-magenta", "bright-cyan", "bright-white",
];

function isHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}

/** Resolve one custom property to "#rrggbb"; follows var() chains via a probe element. */
function resolveColor(root: HTMLElement, name: string, fallback: string): string {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  if (isHex(raw)) return raw.toLowerCase();
  if (!raw) return fallback;
  // var()/color-mix() values: let the engine compute them on a probe.
  const probe = document.createElement("span");
  probe.style.color = `var(${name})`;
  probe.style.display = "none";
  root.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const m = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return fallback;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

export function readTokens(): TermfleetTokens {
  if (typeof document === "undefined") return FALLBACK;
  const root = document.documentElement;
  const get = (name: string, fallback: string) => resolveColor(root, name, fallback);
  return {
    ansi: ANSI_NAMES.map((n, i) => {
      const name = i === 8 ? "--ansi-bright-black" : i > 8 ? `--ansi-${n.slice(7)}` : `--ansi-${n}`;
      return get(name, FALLBACK.ansi[i]);
    }),
    terminalBg: get("--terminal-bg", FALLBACK.terminalBg),
    terminalFg: get("--terminal-fg", FALLBACK.terminalFg),
    terminalCursor: get("--terminal-cursor", FALLBACK.terminalCursor),
    terminalSelectionBg: get("--terminal-selection-bg", FALLBACK.terminalSelectionBg),
    accent: get("--accent", FALLBACK.accent),
    accentHi: get("--accent-hi", FALLBACK.accentHi),
    accentFill: get("--accent-fill", FALLBACK.accentFill),
    accentTint: get("--accent-tint", FALLBACK.accentTint),
    stateRunning: get("--state-running", FALLBACK.stateRunning),
    stateWaiting: get("--state-waiting", FALLBACK.stateWaiting),
    stateIdle: get("--state-idle", FALLBACK.stateIdle),
    stateFailed: get("--state-failed", FALLBACK.stateFailed),
    stateDone: get("--state-done", FALLBACK.stateDone),
    identity: IDENTITY_COLORS.map((fallback, i) => get(`--identity-${i + 1}`, fallback)),
  };
}

/** Subscribe to token changes (a different data-accent). Returns an unsubscribe. */
export function onTokensChanged(callback: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-accent", "data-theme"] });
  return () => observer.disconnect();
}

// The Rust grid (vt_grid.rs) resolves ANSI colours to a fixed xterm palette. The
// canvas renderer receives those literal values and re-maps them to the design
// palette here, so the terminal follows the tokens without touching the daemon.
const RUST_PALETTE: string[] = [
  "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
];
const RUST_DEFAULT_FG = "#d0d0d0";
const RUST_DEFAULT_BG = "#1d2022";

export function buildColorMap(tokens: TermfleetTokens): Map<string, string> {
  const map = new Map<string, string>();
  RUST_PALETTE.forEach((rust, i) => map.set(rust, tokens.ansi[i]));
  map.set(RUST_DEFAULT_FG, tokens.terminalFg);
  map.set(RUST_DEFAULT_BG, tokens.terminalBg);
  return map;
}

export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function renderThemeFromTokens(tokens: TermfleetTokens = readTokens()): RenderTheme {
  return {
    background: tokens.terminalBg,
    cursor: tokens.terminalCursor,
    // Terminal colours are the pre-redesign look: no palette re-map, default overlays.
  };
}

/** React hook: the canvas RenderTheme, refreshed when the accent changes. */
export function useTerminalRenderTheme(): RenderTheme {
  const [theme, setTheme] = useState<RenderTheme>(() => renderThemeFromTokens());
  useEffect(() => {
    return onTokensChanged(() => setTheme(renderThemeFromTokens()));
  }, []);
  return theme;
}
