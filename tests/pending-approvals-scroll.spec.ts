import { expect, test } from "@playwright/test";

const baseUrl = process.env.TERMFLEET_TEST_BASE_URL ?? "http://127.0.0.1:5177/";

// TF-092: seven waiting chats filled the map side panel; the list could not scroll.
test("the pending approval list is height-bounded and scrolls itself", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const ReactDom = await import("/node_modules/.vite/deps/react-dom_client.js");
    const React = ReactModule.default ?? ReactModule;
    const createRoot = ReactDom.createRoot ?? ReactDom.default.createRoot;
    const { PendingApprovalsSection } = await import("/src/components/PendingApprovalsSection.tsx");
    const approvals = Array.from({ length: 12 }, (_, index) => ({
      nodeId: `node-${index}`,
      node: { id: `node-${index}` },
      projectName: `project-${index}`,
      category: "action",
      categoryLabel: "Action Required",
      headline: "Waiting for your answer",
      detail: "A long explanation of what the agent is asking for. ".repeat(3),
      provider: "claude",
      targetSummary: "content-creation/rough-cut-mvp",
    }));
    const shell = document.createElement("div");
    shell.style.cssText = "position:fixed;inset:0 auto auto 0;width:320px;height:700px;display:flex;flex-direction:column;z-index:99999;background:#111";
    shell.innerHTML = '<div id="tf092-root"></div><div id="tf092-rest" style="flex:1;min-height:0">rest</div>';
    document.body.appendChild(shell);
    createRoot(document.getElementById("tf092-root")!).render(
      React.createElement(PendingApprovalsSection, { approvals, onSelect: () => {} }),
    );
  });
  const firstCard = page.locator('#tf092-root [data-testid="pending-approval-card"]').first();
  await expect(firstCard).toBeVisible();
  const box = await firstCard.locator("..").evaluate((el) => ({
    client: el.clientHeight,
    scroll: el.scrollHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));
  expect(box.overflowY).toBe("auto");
  expect(box.scroll).toBeGreaterThan(box.client);
  expect(box.client).toBeLessThanOrEqual(190);
  // Each request stays a compact two-line row.
  expect(await firstCard.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(48);
  expect(await page.locator("#tf092-rest").evaluate((el) => el.clientHeight)).toBeGreaterThan(300);
  // Only project, one-line task, "Action Required" and the agent are shown.
  const cardText = await firstCard.innerText();
  expect(cardText).toContain("project-0");
  expect(cardText).toContain("Waiting for your answer");
  expect(cardText).toContain("Action Required");
  expect(cardText.toLowerCase()).toContain("claude");
  expect(cardText).not.toContain("A long explanation");
  expect(cardText).not.toContain("rough-cut-mvp");
  expect(cardText).not.toContain("Review");
  await page.screenshot({ path: "test-results/tf-092-pending-approvals-scroll.png" });
});

test("view options start open and remember being hidden", async () => {
  const { mapUtilityCollapsed, saveMapUtilityCollapsed } = await import("../src/lib/mapUtilityVisibility");
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  expect(mapUtilityCollapsed("filters", storage)).toBe(false);
  expect(mapUtilityCollapsed("services", storage)).toBe(true);
  saveMapUtilityCollapsed("filters", true, storage);
  expect(mapUtilityCollapsed("filters", storage)).toBe(true);
  const { readFileSync } = await import("node:fs");
  const sidebar = readFileSync("src/components/WorkbenchSidebar.tsx", "utf8");
  expect(sidebar).toContain('data-testid="map-view-options-toggle"');
  expect(sidebar).toContain("{!filtersCollapsed && (<>");
});
