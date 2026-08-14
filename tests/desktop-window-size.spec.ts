import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("desktop launches with enough vertical room for terminal content", async () => {
  const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8")) as {
    app?: { windows?: Array<{ width?: number; height?: number }> };
  };

  expect(config.app?.windows?.[0]).toMatchObject({
    width: 1200,
    height: 1000,
  });
});
