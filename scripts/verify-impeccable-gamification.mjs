import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = process.cwd();
const skillRoot = "/home/endlessblink/.agents/skills/impeccable";
const context = spawnSync("node", [resolve(skillRoot, "scripts/context.mjs"), "--target", "src/components/GamificationPanel.tsx"], { cwd: root, encoding: "utf8" });
if (context.status !== 0 || !context.stdout.includes("EXISTING_VISUAL_SYSTEM")) {
  console.error("IMPECCABLE_GATE_FAIL: Impeccable context did not load the incumbent visual system.");
  process.exit(1);
}
for (const reference of ["reference/operate.md", "reference/colorize.md", "reference/animate.md", "reference/craft-floor.md"]) {
  if (!existsSync(resolve(skillRoot, reference))) {
    console.error(`IMPECCABLE_GATE_FAIL: required playbook missing: ${reference}`);
    process.exit(1);
  }
}
const panel = readFileSync(resolve(root, "src/components/GamificationPanel.tsx"), "utf8");
const globalCss = readFileSync(resolve(root, "src/styles/global.css"), "utf8");
const checks = [
  [panel.includes("var(--accent-info)") && panel.includes("var(--accent-warning)"), "complementary semantic colors"],
  [globalCss.includes("@keyframes gamification-panel-in"), "single authored panel animation"],
  [globalCss.includes("prefers-reduced-motion: reduce"), "reduced-motion fallback"],
  [!panel.includes("gamification-reward-toast") && !panel.includes('role=\"status\"'), "no persistent reward toast"],
];
for (const [passed, label] of checks) {
  if (!passed) {
    console.error(`IMPECCABLE_GATE_FAIL: ${label}`);
    process.exit(1);
  }
}
console.log("IMPECCABLE_GAMIFICATION_DESIGN_OK context=loaded palette=teal-amber motion=event-only toasts=off");
