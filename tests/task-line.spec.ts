import { expect, test } from "@playwright/test";
import { resolvePaneNowLine, resolvePaneTaskLine } from "../src/lib/taskLine";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

// R1: the invariant this whole module exists for.
test("never blank, even with nothing at all", () => {
  const line = resolvePaneTaskLine({ now: NOW });
  expect(line.text.length).toBeGreaterThan(0);
  expect(line.text).not.toMatch(/task not captured/i);
});

test("the agent's declared task wins", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "Cleaning up messy terminal text",
    facts: { title: "Something else" },
  });
  expect(line.text).toBe("Cleaning up messy terminal text");
  expect(line.source).toBe("declared");
});

// R3: a finished turn demotes the declared task immediately.
// A finished turn ends the pane's MOMENT, not what it is about: an idle pane keeps its
// goal on the row (blanking it is how a finished pane ended up saying "No task declared"
// with a perfectly good goal on record).
test("a turn that ended keeps the goal and clears only the moment", () => {
  const input = {
    now: NOW,
    declaredTask: "Cleaning up messy terminal text",
    currentStep: "Running the last check",
    facts: {
      lastTurnEndAt: NOW - 1000,
      operatorRequest: "sort the sidebar by name",
    },
  };
  const line = resolvePaneTaskLine(input);
  expect(line.source).toBe("declared");
  expect(line.text).toBe("Cleaning up messy terminal text");
});

// The operator's floor rule, verbatim: "in the least — write the main user goal".
test("falls to the operator's own request before any template", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    facts: {
      operatorRequest: "sort the sidebar by name",
      lastTool: { name: "Read", arg: "a.ts" },
    },
  });
  expect(line.source).toBe("operator-request");
});

// The moment belongs to the SECOND row now (the operator's layout: goal on top, what it
// is doing under it). A tool of the second is not a goal — leaving it in the goal ladder
// is what put "Updating the plan" on a card and changed it every few seconds.
test("the tool of the second is the NOW line, never the goal", () => {
  const facts = { lastTool: { name: "Read", arg: "gridRenderer.ts" } };
  expect(resolvePaneTaskLine({ now: NOW, facts }).source).toBe("shell-state");
  const now = resolvePaneNowLine({ now: NOW, facts });
  expect(now?.text).toBe("Reading gridRenderer.ts");
  expect(now?.source).toBe("current-tool");
  expect(now?.expiresAt).toBe(NOW + 30_000);
});

// "Always show the main plan": the session's own plan title leads over the current
// step — the step is a part of the plan, not the plan itself.
test("a structured current step stays progress when no durable goal exists", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    facts: { title: "Make the terminal status line reliable" },
    currentStep: "Running the task-line verification",
  });
  expect(line.source).toBe("session-title");
  expect(line.text).toBe("Make the terminal status line reliable");
});

test("an explicit goal still leads over everything", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    mainGoal: "Make the terminal status line reliable",
    facts: { title: "Something narrower" },
    currentStep: "Running the task-line verification",
  });
  expect(line.text).toBe("Make the terminal status line reliable");
  expect(line.source).toBe("declared");
});

test("the current step stays out of Task when no explicit goal exists", () => {
  const input = {
    now: NOW,
    currentStep: "Running the task-line verification",
  };
  const task = resolvePaneTaskLine(input);
  expect(task.source).toBe("shell-state");
  expect(task.rejected).toBe("Running the task-line verification");
  expect(resolvePaneNowLine(input)).toMatchObject({
    text: "Running the task-line verification",
    source: "current-step",
  });
});

test("a structured plan purpose replaces a raw opening complaint", () => {
  expect(
    resolvePaneTaskLine({
      now: 1_000,
      mainGoal:
        "[[Image #1] for the millionth time it glitches. fix it, test it.",
      mainGoalSource: "opening-request",
      currentStep: null,
      facts: {
        planPurpose: "Making every card state its real purpose",
      },
    }),
  ).toMatchObject({
    text: "Making every card state its real purpose",
    source: "plan-purpose",
  });
});

// A finished, idle agent shows what it just did, not "sitting at a prompt".
test("an idle finished agent shows what it just did on the NOW line", () => {
  const input = {
    now: NOW,
    lastCompletedTask: "Correcting the Diet bot's Telegram destination",
    folder: "hermes",
  };
  const now = resolvePaneNowLine(input);
  expect(now?.text).toBe("Correcting the Diet bot's Telegram destination");
  expect(now?.source).toBe("completed-task");
});

test("a finished turn clears every stale NOW candidate", () => {
  const now = resolvePaneNowLine({
    now: NOW,
    currentStep: "Running every automated and headed app check",
    recentActivity: "Imported stabilized clips previously failed during export.",
    lastCompletedTask: "Running every automated and headed app check",
    facts: {
      agentSaid: "Imported stabilized clips previously failed during export.",
      lastTool: { name: "Shell", input: "npm test" },
      lastTurnEndAt: NOW - 1,
    },
    folder: "rough-cut-mvp",
  });

  expect(now).toBeNull();
});

// ...but live work still outranks a completed step.
test("live work outranks a completed step on the NOW line", () => {
  const now = resolvePaneNowLine({
    now: NOW,
    lastCompletedTask: "Correcting the Diet bot's Telegram destination",
    facts: { agentSaid: "Restarting the gateway service" },
    folder: "hermes",
  });
  expect(now?.source).toBe("agent-said");
});

test("a shell shows what it is actually doing", () => {
  expect(
    resolvePaneTaskLine({
      now: NOW,
      runningCommand: "npm run build",
      folder: "termfleet",
    }),
  ).toMatchObject({
    text: "Running npm run build",
    source: "running-command",
  });
  // With nothing known the row says so. It used to template over the folder name
  // ("Sitting at a command prompt in termfleet on main"), which reads like content
  // while answering neither "what was asked" nor "what is being done" (operator
  // rejected it twice, 2026-07-25).
  expect(
    resolvePaneTaskLine({ now: NOW, folder: "termfleet", branch: "main" }),
  ).toMatchObject({
    text: "No task declared",
    source: "shell-state",
  });
});

// A finished pane whose ONLY record of the work is its completed task list must state
// that work, not the placeholder. Live case (pane-6d077586, bina-meatzevet-courses,
// 2026-07-30): the operator's prompt was literally "go" (rightly rejected), every todo
// was completed with an empty activeForm, and the row said "No task declared" while the
// list plainly held "Closing the payment release with evidence".
test("an idle pane's finished plan speaks before the placeholder", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    lastCompletedTask: "Closing the payment release with evidence",
    facts: { operatorRequest: "go", lastTurnEndAt: NOW - 1000 },
    folder: "bina-meatzevet-courses",
  });
  expect(line.text).toBe("Closing the payment release with evidence");
  expect(line.source).toBe("completed-task");
});

// The finished-plan rung is a LAST resort: junk never rides in through it, and every
// higher rung still wins.
test("finished-plan rung stays below real goals and rejects junk", () => {
  expect(
    resolvePaneTaskLine({
      now: NOW,
      lastCompletedTask: "Closing the payment release with evidence",
      facts: { operatorRequest: "sort the sidebar by name" },
    }),
  ).toMatchObject({ source: "operator-request" });
  expect(
    resolvePaneTaskLine({
      now: NOW,
      lastCompletedTask: "npm run build && ./x.sh --flag",
    }),
  ).toMatchObject({ text: "No task declared", source: "shell-state" });
});

// R4 + R2: reject, never rewrite; and record that something was rejected.
test("jargon is skipped, not paraphrased", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "/compact && git rebase -i HEAD~3",
    facts: { operatorRequest: "sort the sidebar by name" },
  });
  expect(line.source).toBe("operator-request");
  expect(line.rejected).toBe("/compact && git rebase -i HEAD~3");
});

// R2: nothing is ever invented — each rung's text is byte-identical to its source.
test("declared, title and request text are copied verbatim", () => {
  const declared = "Cleaning up messy terminal text";
  expect(resolvePaneTaskLine({ now: NOW, declaredTask: declared }).text).toBe(
    declared,
  );
  const title = "Investigate e2e redirect";
  expect(resolvePaneTaskLine({ now: NOW, facts: { title } }).text).toBe(title);
});
