import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const publicRoots = ["README.md", "AGENTS.md", "docs"];
const textExtensions = new Set([".md", ".txt", ".json", ".toml"]);
const tokenPattern = /\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/;
const privatePathPattern = /(?:\/home|\/Users|\/media|\/mnt)\/(?![^/\s]+\/?$)[^\s)]+/;

function extension(path) {
  const match = path.match(/\.[^.]+$/);
  return match?.[0] ?? "";
}

function collectFiles(entry) {
  const path = join(root, entry);
  if (!existsSync(path)) return [];
  const stats = statSync(path);
  if (stats.isFile()) return textExtensions.has(extension(path)) ? [path] : [];
  if (!stats.isDirectory()) return [];
  return readdirSync(path, { withFileTypes: true }).flatMap((dirent) => {
    if (dirent.name.startsWith(".")) return [];
    return collectFiles(join(entry, dirent.name));
  });
}

const files = publicRoots.flatMap(collectFiles);
const findings = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  if (tokenPattern.test(source)) findings.push(`${relative(root, file)} contains token-shaped secret text`);
  if (privatePathPattern.test(source)) findings.push(`${relative(root, file)} contains a machine-local absolute path`);
}

const readme = readFileSync(join(root, "README.md"), "utf8");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const licenseExists = existsSync(join(root, "LICENSE"));
const securityExists = existsSync(join(root, "SECURITY.md"));

const checks = [
  {
    ok: findings.length === 0,
    message: `Public docs must not contain obvious token-shaped secrets or private machine paths:\n${findings.join("\n")}`,
  },
  {
    ok: packageJson.private === true,
    message: "package.json must remain private until license/security publishing decisions are complete.",
  },
  {
    ok: !licenseExists && /license/.test(readme) && /before publishing/.test(readme),
    message: "Missing LICENSE must remain an explicit pre-publish blocker in README.",
  },
  {
    ok: !securityExists && /SECURITY\.md/.test(readme) && /before public release/.test(readme),
    message: "Missing SECURITY.md must remain an explicit pre-publish blocker in README.",
  },
  {
    ok: /Do not include secrets/.test(readme) && /npm run evidence:bundle/.test(readme),
    message: "README must direct public repro sharing through the redacted evidence bundle path.",
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.message}`);
  }
  process.exit(1);
}

console.log("Public pre-publish audit checks passed.");
