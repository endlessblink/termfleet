import { expect, test } from "@playwright/test";
import { projectEmojiFor } from "../src/lib/projectEmoji";

test("generated project emojis are semantic for known project families", () => {
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/misc/designersai")).toBe("🎨");
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/devops/termfleet")).toBe("🧭");
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/devops/hermes")).toBe("🪽");
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/productivity/flow-state/watchpost")).toBe("📡");
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/content-creation/rough-cut-mvp")).toBe("🎬");
  expect(projectEmojiFor("/media/endlessblink/data/my-projects/ai-development/bots+automation/botson")).toBe("🤖");
});

test("generated project emojis avoid the brick fallback for unknown projects", () => {
  expect(projectEmojiFor("/tmp/some-random-local-checkout")).not.toBe("🧱");
});

test("parent folders do not force unrelated projects to share an emoji", () => {
  const alpha = projectEmojiFor("/repo/devops/alpha");
  const beta = projectEmojiFor("/repo/devops/beta", [alpha]);
  expect(beta).not.toBe(alpha);
});

test("the fallback pool stays varied across a large project list", () => {
  const assigned: string[] = [];
  for (let index = 0; index < 60; index += 1) {
    assigned.push(projectEmojiFor(`/repo/team/project-${index}`, assigned));
  }

  expect(new Set(assigned).size).toBe(assigned.length);
});
