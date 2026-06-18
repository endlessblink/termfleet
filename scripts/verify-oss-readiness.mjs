import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const readme = readFileSync(join(root, "README.md"), "utf8");
const packageJson = readFileSync(join(root, "package.json"), "utf8");

const checks = [
  {
    ok: /## What It Is/.test(readme) && /## What It Is Not/.test(readme) &&
      /local-first operations cockpit/.test(readme) &&
      /Not a cloud agent orchestrator/.test(readme),
    message: "README must position TermFleet as a local-first ops cockpit, not a generic terminal/cloud orchestrator.",
  },
  {
    ok: /## Quick Start/.test(readme) &&
      /npm install/.test(readme) &&
      /npm run verify:prerequisites/.test(readme) &&
      /npm run review/.test(readme) &&
      /npm run tauri:dev/.test(readme) &&
      /npm run build/.test(readme),
    message: "README must include install, browser review, native app, and build commands.",
  },
  {
    ok: /"verify:prerequisites": "node scripts\/verify-prerequisites\.mjs"/.test(packageJson) &&
      /WebKitGTK/.test(readme) &&
      /4\.1, JavaScriptCoreGTK 4\.1/.test(readme) &&
      /libsoup 3/.test(readme),
    message: "OSS readiness must include an actionable fresh-clone prerequisite verifier.",
  },
  {
    ok: /## Architecture/.test(readme) &&
      /Rust daemon owns PTYs/.test(readme) &&
      /alacritty_terminal/.test(readme) &&
      /Canvas2D/.test(readme) &&
      /docs\/recoverable-terminal-architecture\.md/.test(readme),
    message: "README must explain the daemon/headless-VT/Canvas2D architecture and link architecture docs.",
  },
  {
    ok: /## Evidence Bundles/.test(readme) &&
      /npm run evidence:bundle/.test(readme) &&
      /redacted before export/.test(readme) &&
      /"evidence:bundle": "node scripts\/export-evidence-bundle\.mjs"/.test(packageJson),
    message: "README must document redaction-safe local evidence bundle export.",
  },
  {
    ok: /## Contributing/.test(readme) &&
      /Keep changes small, regression-backed/.test(readme) &&
      /Do not add dependencies/.test(readme),
    message: "README must set contribution expectations for preview feedback.",
  },
  {
    ok: /## Security/.test(readme) &&
      /user-local Unix socket/.test(readme) &&
      /Do not include secrets/.test(readme) &&
      /SECURITY\.md/.test(readme),
    message: "README must document local security expectations and the pre-public SECURITY.md gap.",
  },
  {
    ok: /## Limitations/.test(readme) &&
      /Linux is the supported preview target/.test(readme) &&
      /not a background port scanner/.test(readme),
    message: "README must state preview limitations honestly.",
  },
  {
    ok: /## Roadmap/.test(readme) &&
      /TC-021/.test(readme) &&
      /TC-025/.test(readme) &&
      /license/.test(readme),
    message: "README must include a public-preview roadmap and license pre-publish item.",
  },
  {
    ok: /"verify:public-audit": "node scripts\/verify-public-audit\.mjs"/.test(packageJson),
    message: "OSS readiness must include the public pre-publish audit verifier.",
  },
  {
    ok: /"verify:developer-preview": "node scripts\/verify-developer-preview\.mjs"/.test(packageJson) &&
      /npm run verify:developer-preview/.test(readme) &&
      /not run the heavier live desktop smoke tests/.test(readme),
    message: "OSS readiness must document the non-destructive developer-preview verification gate.",
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.message}`);
  }
  process.exit(1);
}

console.log("OSS readiness README checks passed.");
