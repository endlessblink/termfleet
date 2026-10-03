import { expect, test } from "@playwright/test";
import { BASE, openPage, surfaces } from "./helpers/design-surfaces";

// Visual regression for the 12 redesigned surfaces (design step 4.2).
//
// Needs a running Vite on a free port: TF_DESIGN_URL=http://127.0.0.1:<port>/ (never the
// live app's 5177/5188). Without it the whole file is skipped, so the spec never hard-codes
// a port. Same synthetic workspace as the design handoff's capture-real.mjs (mocked
// __TAURI_INTERNALS__, 2 projects, 6 sessions, no user data).
//
//   update baselines:  TF_DESIGN_URL=... npx playwright test tests/design-visual.spec.ts --update-snapshots
//   check:             TF_DESIGN_URL=... npx playwright test tests/design-visual.spec.ts

test.skip(!BASE, "set TF_DESIGN_URL to a Vite dev server on a free port");
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
test.describe.configure({ mode: "serial" });

for (const [name, run] of Object.entries(surfaces)) {
  test(`surface: ${name}`, async ({ page }) => {
    await openPage(page);
    await run(page);
    // Park the pointer in an inert corner and let hover/tooltip state settle.
    await page.mouse.move(1438, 898);
    await page.waitForTimeout(700);
    await expect(page).toHaveScreenshot(`${name}.png`, { maxDiffPixelRatio: 0.01, animations: "disabled", caret: "hide" });
  });
}
