// Design ratchet (design step 4.1). Counts of design-system violations that may only
// go DOWN. scripts/design-ratchet-baseline.json holds the committed ceilings; the gate
// fails when any current count is above its ceiling. When you remove violations, run
//   node scripts/verify-design-ratchet.mjs --update
// to lower the ceilings (the script refuses to raise them).

import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const srcRoot = join(root, "src");
const baselinePath = join(root, "scripts", "design-ratchet-baseline.json");
const update = process.argv.includes("--update");

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(tsx?|css)$/.test(path) ? [path] : [];
  });
}

const FONT_SCALE = new Set([11, 12, 13, 14, 16, 20, 28]);
const checks = {
  hexOutsideTokens: (text, rel) =>
    rel === "styles/theme.css" || rel === "lib/tokens.ts" ? 0 : (text.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-fA-F])/g) ?? []).length,
  fontSizeBelow11OrOffScale: (text) => {
    let n = 0;
    for (const m of text.matchAll(/(?:font-size|fontSize)\s*:\s*["']?(\d+(?:\.\d+)?)(?:px)?["']?/g)) {
      if (!FONT_SCALE.has(Number(m[1]))) n += 1;
    }
    return n;
  },
  numericZIndex: (text) => (text.match(/(?:z-index|zIndex)\s*:\s*["']?\d+/g) ?? []).length,
  outlineNoneWithoutReplacement: (text) => (text.match(/outline\s*:\s*["']?(?:none|0)\b/g) ?? []).length,
  rawRgbOutsideTokens: (text, rel) =>
    rel === "styles/theme.css" ? 0 : (text.match(/\brgba?\(\s*\d/g) ?? []).length,
  transitionOnWidthHeight: (text) => (text.match(/transition[^;\n]*\b(?:width|height)\b/g) ?? []).length,
  boxShadowLiteralOutsideElev: (text, rel) => {
    if (rel === "styles/theme.css") return 0;
    let n = 0;
    for (const m of text.matchAll(/(?:box-shadow|boxShadow)\s*:\s*["']?([^;"'\n}]+)/g)) {
      const value = m[1].trim();
      if (value === "none" || value === "0" || value.startsWith("var(--elev-") || value.startsWith("inherit")) continue;
      if (/^var\(--[a-z-]+\)$/.test(value) && !value.includes("shadow-")) continue;
      n += 1;
    }
    return n;
  },
};

const counts = Object.fromEntries(Object.keys(checks).map((key) => [key, 0]));
for (const file of files(srcRoot)) {
  const text = readFileSync(file, "utf8");
  const rel = relative(srcRoot, file);
  for (const [key, fn] of Object.entries(checks)) counts[key] += fn(text, rel);
}

if (update || !existsSync(baselinePath)) {
  const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : null;
  const next = {};
  for (const key of Object.keys(counts)) next[key] = previous ? Math.min(previous[key] ?? counts[key], counts[key]) : counts[key];
  writeFileSync(baselinePath, JSON.stringify(next, null, 2) + "\n");
  console.log(previous ? "Design ratchet baseline lowered:" : "Design ratchet baseline created:", JSON.stringify(next));
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const failures = [];
for (const [key, count] of Object.entries(counts)) {
  const ceiling = baseline[key];
  if (ceiling === undefined) failures.push(`${key}: no baseline entry`);
  else if (count > ceiling) failures.push(`${key}: ${count} > baseline ${ceiling} (new violations; use a token)`);
}
if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("Design ratchet passed:", JSON.stringify(counts));
