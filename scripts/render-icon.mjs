// Render every platform icon from the same smooth vector master.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const source = "public/brand/termfleet-vessel-master.svg";
const out = process.argv[2] ?? "/tmp/termfleet-icon-1024.png";
const size = Number.parseInt(process.argv[3] ?? "1024", 10);

if (!Number.isInteger(size) || size < 16) {
  throw new Error(`Icon size must be an integer of at least 16 pixels; received ${process.argv[3]}`);
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
});

try {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  const svg = readFileSync(source, "utf8");
  await page.setContent(`
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; }
      svg { display: block; width: ${size}px; height: ${size}px; }
    </style>
    ${svg}
  `);
  await page.screenshot({ path: out, omitBackground: true });
  console.log(`rendered ${source} to ${out}`);
} finally {
  await browser.close();
}
