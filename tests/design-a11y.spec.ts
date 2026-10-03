import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { BASE, openPage, surfaces } from "./helpers/design-surfaces";

// Serious/critical axe violations on the 12 redesigned surfaces (design step 4.4).
// Needs TF_DESIGN_URL (a Vite dev server on a free port); skipped otherwise.
// Known, accepted findings are listed in KNOWN with a reason; anything else fails.

test.skip(!BASE, "set TF_DESIGN_URL to a Vite dev server on a free port");
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

// Accepted findings (rule id -> why). They are pre-existing structure, not regressions:
const KNOWN: Record<string, string> = {
  // Session rows and pending-approval cards are role="button" containers that hold their own
  // hover action buttons; splitting them is a markup/behaviour change outside this re-skin.
  "nested-interactive": "role=button rows/cards that contain action buttons (sessions list, pending approvals)",
  // Excalidraw's own menu trigger inside the Drawing board card (third-party editor).
  "button-name": "third-party Excalidraw .main-menu-trigger has no accessible name",
};

for (const [name, run] of Object.entries(surfaces)) {
  test(`a11y: ${name}`, async ({ page }) => {
    await openPage(page);
    await run(page);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .filter((violation) => !(violation.id in KNOWN));
    console.log(`A11Y ${name}: ${serious.map((v) => `${v.id}(${v.nodes.length})`).join(", ") || "none"}`);
    expect(serious.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
}
