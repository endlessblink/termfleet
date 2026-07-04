import { expect, test } from "@playwright/test";
import {
  currentNarrationStep,
  extractLastNarrationBullet,
  narrationToNow,
  visibleTextShowsActiveWork,
} from "../src/lib/agentNarration";
// The node-side original — imported only to pin byte-parity of the condenser.
import { narrationToNow as hookNarrationToNow } from "../scripts/termfleet-claude-status-hook.mjs";

// Real screenshot fixture (bina-ve-ze pane, 2026-07-04): Codex narrates with "•"
// while a Working marker is visible.
const CODEX_CONFIDENCE_GATE = [
  "• I'm using the sure confidence gate now. I won't implement in plan mode; I'll tighten the",
  "  diagnosis with line-level evidence and then answer the gate honestly.",
  "",
  "• Explored",
  "  └ Read SKILL.md (sure skill), use-session-actions.ts, index.tsx, use-session-state-cache.ts",
  "",
  "• Working (17s • esc to interrupt)",
].join("\n");

// Real screenshot fixture (cc-linux-enhancments pane, 2026-07-04).
const CLAUDE_INSTALL_SCRIPTS = [
  "  Ran 6 tests in 0.000s",
  "",
  "  OK",
  "",
  "• Ran bash -n scripts/install-plasma-dock-recovery.sh",
  "  └ (no output)",
  "",
  "• The focused tests and shell syntax checks pass. I'm installing the updated scripts into the",
  "  user systemd services now, then I'll verify the live units and current attention state.",
  "",
  "✻ Cogitating… (12s)",
].join("\n");

test("screenshot: confidence-gate narration becomes the current step", () => {
  expect(currentNarrationStep(CODEX_CONFIDENCE_GATE)).toBe(
    "Using the sure confidence gate now",
  );
});

test("screenshot: install-scripts narration becomes the current step", () => {
  const step = currentNarrationStep(CLAUDE_INSTALL_SCRIPTS);
  expect(step).toBe("Installing the updated scripts into the user systemd services now");
});

test("wrapped continuation lines are joined into one bullet", () => {
  const bullet = extractLastNarrationBullet(CODEX_CONFIDENCE_GATE);
  expect(bullet).toContain("tighten the diagnosis with line-level evidence");
});

test("tool chrome bullets are never narration", () => {
  const text = [
    "● Bash(npm run build)",
    "⎿ Read 40 lines",
    "● Read(src/lib/agentNarration.ts)",
    "● Update(foo.ts)",
    "● Explored",
    "  └ Read SKILL.md",
    "• Working (3s • esc to interrupt)",
  ].join("\n");
  expect(extractLastNarrationBullet(text)).toBeUndefined();
  expect(currentNarrationStep(text)).toBeUndefined();
});

test("no active-work marker → no narration step (stale suppression)", () => {
  const text = [
    "• I'm installing the updated scripts into the user systemd services now.",
    "",
    "gpt-5.5 default · /some/path",
  ].join("\n");
  expect(visibleTextShowsActiveWork(text)).toBe(false);
  expect(currentNarrationStep(text)).toBeUndefined();
});

test("a submitted prompt below the bullet marks it as a previous turn", () => {
  const text = [
    "• I'm installing the updated scripts into the user systemd services now.",
    "",
    "› now check the logs and verify",
    "• Working (2s • esc to interrupt)",
  ].join("\n");
  expect(extractLastNarrationBullet(text)).toBeUndefined();
});

test("an empty composer prompt does not mark narration stale", () => {
  const text = [
    "• I'm installing the updated scripts into the user systemd services now.",
    "›",
    "• Working (2s • esc to interrupt)",
  ].join("\n");
  expect(extractLastNarrationBullet(text)).toContain("installing the updated scripts");
});

test("junk bullets fall through to undefined", () => {
  for (const junk of [
    "• Done.",
    "• All 71 pass.",
    "• Committed as abc123.",
    "• ok",
    "• Editing src/components/Terminal.tsx",
  ]) {
    const text = [junk, "• Working (2s • esc to interrupt)"].join("\n");
    expect(currentNarrationStep(text)).toBeUndefined();
  }
});

test("spinner lines count as active work but never as narration", () => {
  const text = ["✻ Embellishing… (2m 23s · ↓ 7.3k tokens)"].join("\n");
  expect(visibleTextShowsActiveWork(text)).toBe(true);
  expect(extractLastNarrationBullet(text)).toBeUndefined();
});

test("condenser parity with the status hook is byte-identical", () => {
  const samples = [
    "I'm using the sure confidence gate now. I won't implement in plan mode; I'll tighten the diagnosis with line-level evidence and then answer the gate honestly.",
    "The focused tests and shell syntax checks pass. I'm installing the updated scripts into the user systemd services now, then I'll verify the live units and current attention state.",
    "All 71 pass.",
    "Committed as abc123. Pushed to origin/main.",
    "Now let me wire the daemon reconnect path so sessions survive a restart.",
    "Done. Fixed. Perfect.",
    "```const x = 1;``` Let me refactor the header pipeline for clarity.",
    "",
  ];
  for (const sample of samples) {
    expect(narrationToNow(sample)).toBe(hookNarrationToNow(sample));
  }
});
