import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const theme = readFileSync("src/styles/theme.css", "utf8");
const boardSource = readFileSync("src/components/CanonicalAgentBoard.tsx", "utf8");
const boardStyles = boardSource.match(/<style>\{`([\s\S]*?)`\}<\/style>/)?.[1];

test("canonical board controls keep a visible token focus ring when reached by keyboard", async ({ page }) => {
  expect(boardStyles, "the component's actual stylesheet must be exercised").toBeTruthy();
  await page.setContent(`<style>${theme}\n${boardStyles}</style>
    <div class="canonical-view-switch"><button>Workflow</button></div>
    <button class="canonical-task-row">Task</button>
    <div class="canonical-board-controls"><input aria-label="Search"><select aria-label="Status"><option>All</option></select></div>`);

  for (const control of [page.getByRole("button", { name: "Workflow" }), page.getByRole("button", { name: "Task", exact: true }), page.getByRole("textbox", { name: "Search" }), page.getByRole("combobox", { name: "Status" })]) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await expect(control).toHaveCSS("outline-style", "solid");
    await expect(control).toHaveCSS("outline-width", "2px");
    await expect(control).toHaveCSS("outline-offset", "1px");
    await expect(control).toHaveCSS("outline-color", "rgb(113, 136, 166)");
    await expect(control).toHaveCSS("box-shadow", "rgb(133, 161, 197) 0px 0px 0px 2px");
  }
});
