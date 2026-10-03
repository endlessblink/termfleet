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
  let withoutTerminalFontConfig = rel === "components/Terminal.tsx"
    ? text.replace(/new XTerminal\(\{[\s\S]*?\n    \}\);/, "")
    : text;
  // @font-face blocks declare font files (e.g. the terminal's Hack 700 bold
  // face); their font-weight is not a "visible UI weight", so exclude them.
  withoutTerminalFontConfig = withoutTerminalFontConfig.replace(/@font-face\s*\{[\s\S]*?\}/g, "");

  if (/(fontWeight|font-weight)\s*:\s*["']?[6-9]\d{2}/.test(withoutTerminalFontConfig)) {
    failures.push(`${rel}: visible UI must not use 600+ font weights.`);
  }

  // Letter spacing is checked per declaration (one "letterSpacing: 0" used to satisfy
  // a whole file): only 0 / normal / inherit and the one uppercase label token pass.
  for (const match of withoutTerminalFontConfig.matchAll(/(?:letterSpacing|letter-spacing)\s*:\s*([^;,}\n]+)/g)) {
    const value = match[1].trim().replace(/^["']|["']$/g, "");
    if (!/^(0|0px|normal|inherit|var\(--label-caps-tracking\))$/.test(value)) {
      failures.push(`${rel}: letter spacing must stay 0 or the label-caps token (found "${value}").`);
    }
  }

  // The raw `monospace` keyword stays reserved for terminal surfaces; the
  // `var(--font-mono)` token (Hack) is the approved data tier (paths, branches,
  // ids, counters, kbd) and may be used by any component.
  if (!allowedMonoFiles.has(rel) && /monospace/.test(text.replace(/var\(--font-mono\)/g, ""))) {
    failures.push(`${rel}: monospace must be reserved for terminal/code surfaces.`);
  }

  // Approved design: a visible keyboard-focus ring and token-coloured full borders.
  // - `outline:` is banned except `none`/`0` and the one focus-ring declaration
  //   `var(--focus-ring-width) solid var(--focus-ring-color)`.
  // - Full `border:` shorthand is allowed only in a token border colour
  //   (--border-default|strong|control|subtle, or --accent-fill for active/selected rings) or transparent; raw colours stay banned.
  for (const line of text.split("\n")) {
    if (/\boutline\s*:\s*["']?(?!none|0)[^,;"'}]*\b(solid|dashed|dotted|\dpx)/.test(line) &&
        !/outline\s*:\s*var\(--focus-ring-width\)\s+solid\s+var\(--focus-ring-color\)/.test(line)) {
      failures.push(`${rel}: no hard outlines — "${line.trim()}" (use the focus-ring tokens).`);
    }
    if (rel.endsWith(".tsx") &&
        /\bborder\s*:\s*["']\s*\d+px\s+solid\s+(?!transparent|var\(--(?:border-(?:default|strong|control|subtle)|accent-fill)\))(var\(--|#|rgb)/.test(line)) {
      failures.push(`${rel}: no full box-borders — "${line.trim()}" (use a fill or directional separator).`);
    }
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
