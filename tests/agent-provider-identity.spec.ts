import { expect, test } from "@playwright/test";
import {
  agentProviderIdentity,
  isAgentProvider,
  stableAgentProvider,
  terminalSignifierIdentity,
} from "../src/lib/agentProviderIdentity";

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
  expect(isAgentProvider("shell")).toBe(false);
  expect(isAgentProvider(undefined)).toBe(false);
  expect(isAgentProvider("codex")).toBe(true);
  expect(isAgentProvider("claude")).toBe(true);
});

test("provides SHELL signifier identity for terminals without an agent", () => {
  expect(terminalSignifierIdentity("shell")).toBe("SHELL");
  expect(terminalSignifierIdentity(undefined)).toBe("SHELL");
  expect(terminalSignifierIdentity(null)).toBe("SHELL");
  expect(terminalSignifierIdentity("codex")).toBe("GPT");
  expect(terminalSignifierIdentity("claude")).toBe("CLAUDE");
  expect(terminalSignifierIdentity("opencode")).toBe("OPENCODE");
});

