#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const requiredVisibleText = [];
const manifestPaths = [];
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--require-visible-text") {
    const value = args[++index];
    if (!value) fail("missing-required-visible-text");
    requiredVisibleText.push(value);
  } else if (arg.startsWith("--require-visible-text=")) {
    requiredVisibleText.push(arg.slice("--require-visible-text=".length));
  } else {
    manifestPaths.push(arg);
  }
}
if (!manifestPaths.length) {
  console.error("COCKPIT_VISUAL_FAIL usage=verify-cockpit-visual.mjs <manifest.json> [stable-manifest.json]");
  process.exit(1);
}

function fail(reason) {
  console.error(`COCKPIT_VISUAL_FAIL ${reason}`);
  process.exit(1);
}

function verifyManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest-unreadable=${error.message}`);
  }

  const image = String(manifest.capture ?? "");
  if (!existsSync(image)) fail(`image-missing=${image || "<empty>"}`);
  if (!manifest.windowId || !manifest.windowPid || !manifest.executable) fail("incomplete-manifest");
  if (!/\/termfleet\/releases\/[^/]+\/termfleet$/.test(manifest.executable)) {
    fail(`not-installed-release=${manifest.executable}`);
  }

  const dimensions = spawnSync("identify", ["-format", "%wx%h", image], { encoding: "utf8" });
  if (dimensions.status !== 0) fail("image-unreadable");
  const actualSize = dimensions.stdout.trim();
  const expectedSize = `${manifest.geometry?.width}x${manifest.geometry?.height}`;
  if (actualSize !== expectedSize) fail(`geometry-mismatch=${actualSize} expected=${expectedSize}`);

  const liveExecutable = spawnSync("readlink", ["-f", `/proc/${manifest.windowPid}/exe`], { encoding: "utf8" });
  if (liveExecutable.status !== 0 || liveExecutable.stdout.trim() !== manifest.executable) {
    fail(`process-binding-mismatch=${liveExecutable.stdout.trim() || "dead"}`);
  }

  const readableCrop = manifest.headerCrop && existsSync(manifest.headerCrop)
    ? manifest.headerCrop
    : manifest.surfaceCrop && existsSync(manifest.surfaceCrop)
      ? manifest.surfaceCrop
      : image;
  // OCR the complete dock as well as the readable crop: a clean active card must
  // not hide a broken Goal/Now row on another visible card in the same window.
  const ocrImages = image === readableCrop ? [image] : [image, readableCrop];
  const ocrText = ocrImages.map((ocrImage) => {
    const ocr = spawnSync("tesseract", [ocrImage, "stdout"], { encoding: "utf8" });
    if (ocr.status !== 0) fail(`ocr-unavailable=${ocrImage}`);
    return ocr.stdout.replace(/\s+/g, " ").trim();
  });
  const fullText = ocrText[0];
  const readableText = ocrText.at(-1);
  for (const requiredText of requiredVisibleText) {
    let requiredPattern;
    try {
      requiredPattern = new RegExp(requiredText, "i");
    } catch (error) {
      fail(`invalid-required-visible-text=${error.message}`);
    }
    if (!requiredPattern.test(`${fullText} ${readableText}`)) {
      fail(`missing-required-visible-text=${requiredText}`);
    }
  }
  const required = ["Task:", "Goal:", "Now:"];
  for (const label of required) {
    if (!new RegExp(`\\b${label.slice(0, -1)}\\s*:` , "i").test(readableText)) fail(`missing-row=${label}`);
  }
  const forbidden = /(?:Goal\s+not\s+captur\w*|Task\s+not\s+captur\w*|No task declared|Memory Writing Agent|UserPromptSubmit hook|agent restore visible|checks failed|mcp__|Keep (?:TermFleet terminal work|terminal sessions|the terminal cockpit)\s+clear and reliable|Make (?:[A-Z][\w-]*|this project) work clear and dependable so people can resume it confidently|Make each TermFleet terminal clear enough to understand at a glance)/i;
  const cropForbidden = /(?:Status\s+unav(?:ail|al)\w*|weekly\s+\d+%\s+left|context\s+\d+%\s+used)/i;
  const match = `${fullText} ${readableText}`.match(forbidden) || readableText.match(cropForbidden);
  if (match) fail(`forbidden-visible-text=${match[0]}`);
  return { manifest, readableText, actualSize };
}

const results = manifestPaths.map(verifyManifest);
const [first, second] = results;
if (second) {
  const firstAt = Date.parse(first.manifest.capturedAt);
  const secondAt = Date.parse(second.manifest.capturedAt);
  const deltaMs = secondAt - firstAt;
  if (!Number.isFinite(firstAt) || !Number.isFinite(secondAt) || deltaMs < 10_000) {
    fail(`stability-window-too-short=${deltaMs}ms`);
  }
  for (const field of ["windowId", "windowPid", "executable"]) {
    if (first.manifest[field] !== second.manifest[field]) fail(`stability-binding-changed=${field}`);
  }
  const rowText = (text) => ["Task", "Goal", "Now"].map((label) => {
    const match = text.match(new RegExp(`${label}\\s*:\\s*(.*?)(?=\\s+(?:Task|Goal|Now)\\s*:|\\s+/media/|$)`, "i"));
    return `${label}:${match?.[1]?.replace(/\\s+/g, " ").trim() ?? ""}`;
  }).join("|");
  if (rowText(first.readableText) !== rowText(second.readableText)) fail("header-text-changed-during-stability-window");
  console.log(`COCKPIT_VISUAL_STABLE_OK window=${second.manifest.windowId} pid=${second.manifest.windowPid} deltaMs=${deltaMs}`);
} else {
  console.log(`COCKPIT_VISUAL_OK window=${first.manifest.windowId} pid=${first.manifest.windowPid} size=${first.actualSize}`);
}
