import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

test("TermFleet app shell owns first paint and package metadata", async () => {
  const [indexHtml, packageJson, tauriConfig, iconRenderer, iconRegenerator, brandSvg, platformPngs] = await Promise.all([
    readFile("index.html", "utf8"),
    readFile("package.json", "utf8"),
    readFile("src-tauri/tauri.conf.json", "utf8"),
    readFile("scripts/render-icon.mjs", "utf8"),
    readFile("scripts/regenerate-icons.mjs", "utf8"),
    readFile("public/brand/termfleet-vessel-master.svg"),
    Promise.all([
      readFile("src-tauri/icons/32x32.png"),
      readFile("src-tauri/icons/64x64.png"),
      readFile("src-tauri/icons/128x128.png"),
      readFile("src-tauri/icons/128x128@2x.png"),
      readFile("src-tauri/icons/icon.png"),
    ]),
  ]);

  expect(indexHtml).toContain("<title>TermFleet</title>");
  expect(indexHtml).toContain('id="termfleet-startup"');
  expect(indexHtml).toContain('data-startup-state="starting"');
  expect(indexHtml).toContain('role="status"');
  expect(indexHtml).toContain('aria-live="polite"');
  expect(indexHtml).toContain("Starting TermFleet");
  expect(indexHtml).toContain('<div id="root" inert aria-hidden="true"></div>');
  expect(indexHtml).toContain('src="/src/main.tsx"');
  expect(indexHtml.match(/termfleet-vessel-master\.svg/g)).toHaveLength(2);
  expect(indexHtml).toContain('class="termfleet-startup__mark"');
  expect(indexHtml).toContain('class="termfleet-loader__prompt"');
  expect(indexHtml).toContain('class="termfleet-loader__vessel"');
  expect(indexHtml).toContain("termfleet-prompt-draw");
  expect(indexHtml).toContain("termfleet-vessel-assemble");
  expect(indexHtml).toContain("termfleet-vessel-idle");
  expect(indexHtml).not.toContain("srcset=");
  expect(indexHtml).not.toContain("FlowState");
  expect(indexHtml).not.toContain("fs-loader");
  expect(indexHtml).not.toContain("logo-glitch-tomato");
  expect(indexHtml).not.toContain("index-nWG0vcwN.js");

  const brandMarkup = brandSvg.toString("utf8");
  expect(brandMarkup).toContain('viewBox="0 0 100 100"');
  expect(brandMarkup).toContain('shape-rendering="geometricPrecision"');
  expect(brandMarkup).toContain('stroke-linecap="round"');
  expect(brandMarkup).toContain('stroke-linejoin="round"');
  expect(brandMarkup).toContain('rx="2"');
  expect(createHash("sha256").update(brandSvg).digest("hex")).toBe(
    "34a883c54371365f2f211b3d497c5f1b40a78b9e2134bc44d5951bc86133e052",
  );
  expect(iconRenderer).toContain('"public/brand/termfleet-vessel-master.svg"');
  expect(iconRenderer).toContain("const size = Number.parseInt");
  expect(iconRegenerator).toContain('["src-tauri/icons/32x32.png", "32"]');
  expect(iconRegenerator).toContain('["src-tauri/icons/128x128.png", "128"]');
  expect(iconRegenerator).toContain('["src-tauri/icons/128x128@2x.png", "256"]');
  expect(platformPngs.map((png) => png[25])).toEqual([6, 6, 6, 6, 6]);
  expect(JSON.parse(tauriConfig).bundle.icon.slice(0, 3)).toEqual([
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/32x32.png",
  ]);
  expect(JSON.parse(tauriConfig).app.windows[0]).toMatchObject({
    width: 1600,
    height: 1000,
    minWidth: 1400,
    minHeight: 900,
  });

  const pkg = JSON.parse(packageJson) as { name?: string; main?: string };
  expect(pkg.name).toBe("terminal-workspace-tauri");
  expect(pkg.main).toBeUndefined();
  expect(packageJson).not.toContain('"flow-state"');
  expect(packageJson).not.toContain("dist-electron/main.cjs");
});
