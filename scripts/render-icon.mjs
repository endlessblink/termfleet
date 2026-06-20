// Render src-tauri/icons/icon.svg -> a 1024px PNG via headless Chromium (full
// SVG fidelity: gradients + glow). Then run: npx tauri icon <out.png>
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const out = process.argv[2] ?? "/tmp/termfleet-icon-1024.png";
const svg = readFileSync("src-tauri/icons/icon.svg", "utf8");
const html = `<!doctype html><html><head><style>*{margin:0;padding:0}html,body{width:1024px;height:1024px;background:transparent}</style></head><body>${svg}</body></html>`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "networkidle" });
await (await page.$("svg")).screenshot({ path: out, omitBackground: true });
await browser.close();
console.log(`rendered ${out}`);
