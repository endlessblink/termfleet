import { expect, test } from "@playwright/test";
import { agentProviderIdentity, stableAgentProvider } from "../src/lib/agentProviderIdentity";

test("uses the user-facing agent names", () => {
  expect(agentProviderIdentity("codex")).toBe("GPT");
  expect(agentProviderIdentity("claude")).toBe("CLAUDE");
  expect(agentProviderIdentity("opencode")).toBe("OPENCODE");
});

test("keeps an identified agent stable through shell fallback refreshes", () => {
  expect(stableAgentProvider("claude", "shell")).toBe("claude");
  expect(stableAgentProvider("codex", undefined)).toBe("codex");
  expect(stableAgentProvider(undefined, "codex")).toBe("codex");
  expect(stableAgentProvider("codex", "claude")).toBe("claude");
});

test("does not label ordinary shells as agents", () => {
  expect(agentProviderIdentity("shell")).toBeNull();
  expect(agentProviderIdentity(undefined)).toBeNull();
  expect(agentProviderIdentity(null)).toBeNull();
});
