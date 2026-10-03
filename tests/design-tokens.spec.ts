import { expect, test } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Node-only spec (like app-shell.spec.ts): no server, no browser. It reimplements
// the checks of the design handoff's contrast-check.py for accents A, B and C and
// asserts every var(--x) used in src resolves to a definition.

const theme = readFileSync("src/styles/theme.css", "utf8");

function props(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) out[m[1]] = m[2];
  return out;
}

const root: Record<string, string> = {};
for (const m of theme.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)) Object.assign(root, props(m[1]));
const variants: Record<string, Record<string, string>> = {};
for (const key of ["A", "B", "C"]) {
  const m = theme.match(new RegExp(`:root\\[data-accent="${key}"\\]\\s*\\{([\\s\\S]*?)\\}`));
  variants[key] = m ? props(m[1]) : {};
}

function lin(c: number) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function lum(hex: string) {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(a: string, b: string) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

interface Pair { name: string; fg: string; bg: string; need: number }
function pairs(): Pair[] {
  const S: Record<string, string> = {};
  for (const k of ["base", "sidebar", "panel", "raised", "hover", "selected"]) S[k] = root[`surface-${k}`];
  const out: Pair[] = [];
  for (const t of ["text-1", "text-2"]) for (const [s, v] of Object.entries(S)) out.push({ name: `${t} on ${s}`, fg: root[t], bg: v, need: 4.5 });
  for (const s of ["base", "sidebar", "panel", "raised", "hover"]) out.push({ name: `text-3 on ${s}`, fg: root["text-3"], bg: S[s], need: 4.5 });
  out.push({ name: "text-2 on selected (rebound tertiary)", fg: root["text-2"], bg: S.selected, need: 4.5 });
  for (const s of ["base", "sidebar", "raised", "selected"]) out.push({ name: `border-control on ${s}`, fg: root["border-control"], bg: S[s], need: 3 });
  for (const st of ["running", "waiting", "failed", "done"]) {
    for (const s of ["base", "sidebar", "selected"]) out.push({ name: `state-${st} on ${s}`, fg: root[`state-${st}`], bg: S[s], need: 4.5 });
  }
  for (const k of ["A", "B", "C"]) {
    const v = variants[k];
    for (const s of ["base", "sidebar", "raised", "selected"]) out.push({ name: `[${k}] accent on ${s}`, fg: v.accent, bg: S[s], need: 4.5 });
    out.push({ name: `[${k}] accent-hi on selected`, fg: v["accent-hi"], bg: S.selected, need: 4.5 });
    out.push({ name: `[${k}] accent on accent-tint`, fg: v.accent, bg: v["accent-tint"], need: 4.5 });
    for (const s of ["base", "sidebar", "selected"]) out.push({ name: `[${k}] accent-fill (ring) vs ${s}`, fg: v["accent-fill"], bg: S[s], need: 3 });
    out.push({ name: `[${k}] dark label base on accent-fill`, fg: S.base, bg: v["accent-fill"], need: 4.5 });
  }
  return out;
}

test("theme.css defines the full token block and all three accent variants", () => {
  for (const k of ["A", "B", "C"]) {
    for (const t of ["accent", "accent-hi", "accent-fill", "accent-tint"]) expect(variants[k][t], `${k} ${t}`).toBeTruthy();
  }
  expect(root["surface-base"]).toBe("#0a0a0b");
  expect(Object.keys(variants.A).length).toBe(4);
});

for (const pair of pairs()) {
  test(`contrast: ${pair.name}`, () => {
    expect(ratio(pair.fg, pair.bg), `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(pair.need);
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(tsx?|css)$/.test(path) ? [path] : [];
  });
}

test("every var(--x) used in src resolves to a definition", () => {
  const defined = new Set<string>();
  const used = new Set<string>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/(--[a-z0-9-]+)["']?\s*:/g)) defined.add(m[1]);
    for (const m of text.matchAll(/var\((--[a-z0-9-]+)/g)) used.add(m[1]);
  }
  // Set inline from JS at runtime (`["--x" as string]: value`), not by a stylesheet.
  const runtime = new Set(["--file-explorer-width", "--session-panel-color"]);
  const missing = [...used].filter((name) => !defined.has(name) && !runtime.has(name)).sort();
  expect(missing).toEqual([]);
});
