import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";

const node = process.execPath;
const source1024 = "/tmp/termfleet-icon-source-1024.png";

execFileSync(node, ["scripts/render-icon.mjs", source1024, "1024"], { stdio: "inherit" });
execFileSync("npx", ["tauri", "icon", source1024], { stdio: "inherit" });

const nativePngs = [
  ["src-tauri/icons/32x32.png", "32"],
  ["src-tauri/icons/64x64.png", "64"],
  ["src-tauri/icons/128x128.png", "128"],
  ["src-tauri/icons/128x128@2x.png", "256"],
  ["src-tauri/icons/icon.png", "512"],
];

for (const [path, size] of nativePngs) {
  execFileSync(node, ["scripts/render-icon.mjs", path, size], { stdio: "inherit" });
  const rgbaPath = `${path}.rgba.png`;
  execFileSync("magick", [path, "-alpha", "on", `PNG32:${rgbaPath}`], { stdio: "inherit" });
  renameSync(rgbaPath, path);
}
