import { expect, test } from "@playwright/test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

let previewServer: Server;
let previewOrigin = "";

test.beforeAll(async () => {
  previewServer = createServer((_request, response) => {
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "text/html; charset=utf-8",
    });
    response.end(`
      <!doctype html>
      <html>
        <head>
          <title>TermFleet preview fixture</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              display: grid;
              place-items: center;
              background: #f7f8fb;
              color: #172033;
              font-family: system-ui, sans-serif;
            }
            main {
              border: 1px solid #cad2e0;
              border-radius: 8px;
              padding: 32px 40px;
              background: white;
              box-shadow: 0 16px 44px rgba(23, 32, 51, 0.14);
            }
            h1 {
              margin: 0;
              font-size: 28px;
            }
          </style>
        </head>
        <body>
          <main>
            <h1>TermFleet live localhost preview</h1>
          </main>
        </body>
      </html>
    `);
  });

  await new Promise<void>((resolve) => previewServer.listen(0, "127.0.0.1", resolve));
  const address = previewServer.address() as AddressInfo;
  previewOrigin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    previewServer.close((error) => error ? reject(error) : resolve());
  });
});

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function typeTerminalCommand(page: import("@playwright/test").Page, command: string) {
  await page.locator(".terminal-container:visible").first().click();
  const input = page.getByRole("textbox", { name: "Terminal input" }).first();
  await expect(input).toBeFocused();
  await input.pressSequentially(command, { delay: 10 });
  await input.press("Enter");
}

test("localhost preview opens from command menu and updates iframe URL", async ({ page }) => {
  await resetWorkspace(page);
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });

  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("show preview");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Localhost preview" })).toHaveCount(0);
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);

  await typeTerminalCommand(page, `echo ${previewOrigin}`);
  await expect.poll(async () => page.evaluate((expectedOrigin) => {
    const ptys = (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { output: string }>;
    }).__terminalWorkspaceBrowserPtys ?? {};
    return Object.values(ptys).some((session) => session.output.includes(expectedOrigin));
  }, previewOrigin)).toBe(true);

  await page.keyboard.press("ControlOrMeta+K");
  await page.getByRole("textbox", { name: "Workspace command" }).fill("show preview");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("region", { name: "Localhost preview" })).toBeVisible();
  await expect(page.locator(".terminal-container:visible")).toHaveCount(1);
  await expect(page.getByRole("textbox", { name: "Preview URL" })).toHaveValue(previewOrigin);
  await expect(page.frameLocator('iframe[title="Localhost preview"]')).toBeDefined();
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", previewOrigin);
  await expect(page.getByText("live", { exact: true })).toBeVisible();
  await expect(page.frameLocator('iframe[title="Localhost preview"]').getByRole("heading", { name: "TermFleet live localhost preview" })).toBeVisible();
  await page.getByRole("region", { name: "Localhost preview" }).screenshot({
    path: test.info().outputPath("localhost-preview-rendered.png"),
  });

  await page.getByRole("textbox", { name: "Preview URL" }).fill("localhost:3000");
  await page.getByRole("button", { name: "Load preview URL" }).click();
  await expect(page.getByRole("textbox", { name: "Preview URL" })).toHaveValue("http://localhost:3000");
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://localhost:3000");

  await typeTerminalCommand(page, "fuser 5174/tcp");
  await expect(page.getByRole("textbox", { name: "Preview URL" })).toHaveValue("http://localhost:3000");
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://localhost:3000");

  await typeTerminalCommand(page, "echo localhost:5174");
  await expect(page.getByRole("textbox", { name: "Preview URL" })).toHaveValue("http://127.0.0.1:5174");
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://127.0.0.1:5174");
  await expect(page.getByRole("status", { name: "Preview server offline" })).toBeVisible();

  await page.getByRole("button", { name: "Reload preview" }).click();
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://127.0.0.1:5174");
  await expect(page.getByRole("status", { name: "Preview server offline" })).toBeVisible();

  await page.waitForTimeout(350);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("region", { name: "Localhost preview" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Preview URL" })).toHaveValue("http://127.0.0.1:5174");
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://127.0.0.1:5174");

  await sidebar.getByRole("button", { name: "Map", exact: true }).click();
  await expect(page.getByRole("region", { name: "Localhost preview" })).toBeVisible();
  await expect(page.locator('iframe[title="Localhost preview"]')).toHaveAttribute("src", "http://127.0.0.1:5174");
});
