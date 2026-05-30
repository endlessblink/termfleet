import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const srcRoot = join(root, "src");
const allowedMonoFiles = new Set([
  "components/Terminal.tsx",
  "components/TerminalCanvas.tsx",
  // MagicCanvas renders live terminal nodes on the operations map; its
  // nativeTerminalPrompt label is a terminal surface (var(--terminal-fg)),
  // so monospace is legitimate there per the same rule as the panes above.
  "components/MagicCanvas.tsx",
  "styles/theme.css",
  "styles/global.css",
]);

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    return /\.(tsx|css)$/.test(path) ? [path] : [];
  });
}

const failures = [];

for (const file of sourceFiles(srcRoot)) {
  const text = readFileSync(file, "utf8");
  const rel = relative(srcRoot, file);
  const withoutTerminalFontConfig = rel === "components/Terminal.tsx"
    ? text.replace(/new XTerminal\(\{[\s\S]*?\n    \}\);/, "")
    : text;

  if (/(fontWeight|font-weight)\s*:\s*["']?[6-9]\d{2}/.test(withoutTerminalFontConfig)) {
    failures.push(`${rel}: visible UI must not use 600+ font weights.`);
  }

  if (/letterSpacing|letter-spacing/.test(withoutTerminalFontConfig) &&
      !/(letterSpacing|letter-spacing)\s*:\s*0\b/.test(withoutTerminalFontConfig)) {
    failures.push(`${rel}: letter spacing must stay 0.`);
  }

  if (!allowedMonoFiles.has(rel) && /monospace|var\(--font-mono\)/.test(text)) {
    failures.push(`${rel}: monospace must be reserved for terminal/code surfaces.`);
  }
}

const globalCss = readFileSync(join(srcRoot, "styles/global.css"), "utf8");
if (/rubik\/latin-(600|700)\.css/.test(globalCss)) {
  failures.push("styles/global.css: do not import unused heavy Rubik weights.");
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Typography source checks passed.");
