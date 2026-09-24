import { expect, test } from "@playwright/test";
// @ts-expect-error — plain ESM helper shared with the status hooks
import { plainCommandActivity } from "../scripts/lib/agent-status-activity.mjs";

// Live 2026-09-24: busy agent cards read "Now not captured" because raw command heads
// ("Running: sed -n", "Running: mv /media/…") were rejected by the header gate.
test("commands an agent runs read as plain activity, never raw shell or paths", () => {
  expect(plainCommandActivity("sed -n '1,40p' src/app.ts")).toBe("Reading files");
  expect(plainCommandActivity("mv /media/demo/old /media/demo/new")).toBe("Moving and organizing files");
  expect(plainCommandActivity("cd repo && npm test")).toBe("Running tests");
  expect(plainCommandActivity("FOO=1 npx playwright test tests/a.spec.ts")).toBe("Running tests");
  expect(plainCommandActivity("cargo check")).toBe("Building and checking the code");
  expect(plainCommandActivity("git push origin main")).toBe("Saving work with git");
  expect(plainCommandActivity("curl -s https://example.com")).toBe("Fetching from the web");
  expect(plainCommandActivity("sudo systemctl restart demo")).toBe("Checking running services");
  expect(plainCommandActivity("ffprobe clip.mp4")).toBe("Running ffprobe");
  for (const command of ["mv /media/private/thing", "node -e \"secret()\""]) {
    expect(plainCommandActivity(command)).not.toMatch(/\/media|secret/);
  }
});
