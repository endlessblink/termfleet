import { expect, test } from "@playwright/test";
import { inferProviderProcessExit } from "../src/lib/providerProcessExit";

test.describe("provider process exit detection inside shell-owned PTYs", () => {
  test("detects a failed UserPromptSubmit hook after the provider returns to shell", () => {
    const result = inferProviderProcessExit(
      "UserPromptSubmit hook (failed)\\nerror: hook exited with code 126\\n$ ",
    );

    expect(result).toEqual({ code: 126, source: "hook" });
  });

  test("uses the latest provider or hook exit when both appear", () => {
    expect(
      inferProviderProcessExit(
        `provider exited with code 1
hook exited with code 126
$ `,
      ),
    ).toEqual({ code: 126, source: "hook" });
  });

  test("does not treat an ordinary shell prompt as a provider exit", () => {
    expect(inferProviderProcessExit("$ npm run build\\n$ ")).toBeNull();
  });
});
