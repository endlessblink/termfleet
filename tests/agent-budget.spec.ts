import { expect, test } from "@playwright/test";
import { agentBudgetSignal } from "../src/lib/agentBudget";

test("a large Sol context becomes an unmistakable warning with a cheaper-model suggestion", () => {
  expect(
    agentBudgetSignal(
      {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        contextTokens: 210_000,
        contextWindow: 258_400,
        outputTokens: 3_000,
        reasoningTokens: 2_200,
        rateLimitUsedPercent: 68,
      },
      "Updating labels and running focused tests",
    ),
  ).toMatchObject({
    level: "critical",
    contextPercent: 81,
    modelLabel: "Sol",
    recommendation: "Switch to Luna",
    direction: "lighter",
    why: "The current task looks clear and repeatable.",
    confidence: "medium",
  });
});

test("deep architecture work keeps Sol even when usage is high", () => {
  expect(
    agentBudgetSignal(
      {
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        contextTokens: 188_000,
        contextWindow: 258_400,
        outputTokens: 4_000,
        reasoningTokens: 3_200,
        rateLimitUsedPercent: 42,
      },
      "Root-cause analysis of a concurrency race in the daemon architecture",
    ).recommendation,
  ).toBe("Keep Sol");
});

test("a lighter model gets a stronger-model warning for risky root-cause work", () => {
  expect(
    agentBudgetSignal(
      {
        model: "gpt-5.6-luna",
        reasoningEffort: "low",
        contextTokens: 32_000,
        contextWindow: 258_400,
        rateLimitUsedPercent: 11,
      },
      "Investigating repeated production data loss during a migration",
    ),
  ).toMatchObject({
    level: "elevated",
    modelLabel: "Luna",
    recommendation: "Switch to Sol",
    direction: "stronger",
    why: "This task has high-stakes failure or data-risk signals.",
    confidence: "medium",
  });
});

test("normal usage stays quiet while still identifying the current model", () => {
  expect(
    agentBudgetSignal(
      {
        model: "gpt-5.5",
        reasoningEffort: "medium",
        contextTokens: 42_000,
        contextWindow: 258_400,
        outputTokens: 900,
        reasoningTokens: 250,
        rateLimitUsedPercent: 12,
      },
      "Writing documentation",
    ),
  ).toMatchObject({
    level: "normal",
    contextPercent: 16,
    modelLabel: "5.5",
    recommendation: "5.5 is enough",
    direction: "keep",
  });
});
