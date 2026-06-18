import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "verify:prerequisites"]],
  ["npm", ["run", "verify:oss-readiness"]],
  ["npm", ["run", "verify:public-audit"]],
  ["npm", ["run", "verify:readme-recovery"]],
  ["npm", ["run", "verify:evidence-bundle"]],
  ["npm", ["run", "verify:agent-status-summary"]],
  ["npm", ["run", "verify:map-terminals"]],
  ["npm", ["run", "build"]],
];

for (const [command, args] of commands) {
  const label = [command, ...args].join(" ");
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\nDeveloper preview verification failed at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nTermFleet developer preview readiness checks passed.");
