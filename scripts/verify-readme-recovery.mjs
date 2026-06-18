import { readFileSync } from "node:fs";
import { join } from "node:path";

const readme = readFileSync(join(process.cwd(), "README.md"), "utf8");

const checks = [
  {
    ok: /## Restore Workspace Proof/.test(readme),
    message: "README must include a Restore Workspace Proof section.",
  },
  {
    ok: /npm run verify:restart-restore/.test(readme) &&
      /npm run verify:standalone-daemon/.test(readme),
    message: "README must name the restart/restore and standalone daemon proof commands.",
  },
  {
    ok: /App restart reattach/.test(readme) &&
      /Cold restore/.test(readme) &&
      /restartable stale sessions/.test(readme),
    message: "README must explain live reattach and cold stale-session recovery.",
  },
  {
    ok: /\/tmp\/tw-standalone-daemon-smoke\//.test(readme) &&
      /post-restore input/.test(readme),
    message: "README must point to visual restore evidence and post-restore input proof.",
  },
  {
    ok: /React unmounts detach/.test(readme) &&
      /explicit close\/stop destroys/.test(readme),
    message: "README must state the ownership rule: detach on unmount, destroy only on explicit close/stop.",
  },
];

const failures = checks.filter((check) => !check.ok);
if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure.message}`);
  }
  process.exit(1);
}

console.log("README recovery proof checks passed.");
