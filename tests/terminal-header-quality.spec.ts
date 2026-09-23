import { expect, test } from "@playwright/test";
import {
  headerLabelsAreDuplicated,
  qualityCheckActivityLabel,
  qualityCheckAuthoritativeTaskLabel,
  qualityCheckGoalLabel,
  qualityCheckNowLabel,
  qualityCheckTrustedActivityLabel,
  qualityCheckTaskLabel,
  qualityCheckUserAskLabel,
  stripComposerChrome,
} from "../src/lib/terminalHeaderQuality";

test("accepts concise operator-readable task and activity labels", () => {
  expect(qualityCheckTaskLabel("Improve cockpit header descriptions").ok).toBe(true);
  expect(qualityCheckActivityLabel("Inspecting header quality rules").ok).toBe(true);
});

test("rejects workflow narration from the glanceable Task and Now rows", () => {
  for (const label of [
    "Staging the restart and map fix",
    "Rebuilding and verifying the installed dock",
    "V - Preserve the current worktree. - Review changes before any recovery or merge.",
    "Git safety checks pass; all 20 tests succeeded, and the current worktree was preserved",
  ]) {
    expect(qualityCheckTaskLabel(label), label).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckNowLabel(label), label).toMatchObject({ ok: false, reason: "vague" });
  }
});

test("rejects generic report and continue placeholders", () => {
  for (const placeholder of [
    "Continue the assigned work in this terminal pane",
    "give a report of what you did",
    "Provide a debrief of what was done",
  ]) {
    expect(qualityCheckAuthoritativeTaskLabel(placeholder), placeholder).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
  }
});

test("rejects release choreography as a durable goal", () => {
  expect(
    qualityCheckAuthoritativeTaskLabel("Committing, tagging, and pushing the candidate")
      .ok,
  ).toBe(false);
});

test("rejects skill and process instructions as durable Goal text", () => {
  for (const placeholder of ["Goal not captured", "Task not captured", "Status unavailable", "Activity not captured", "[Image #1]"]) {
    expect(qualityCheckGoalLabel(placeholder), placeholder).toMatchObject({
      ok: false,
      reason: "vague",
    });
  }
  expect(qualityCheckGoalLabel("use impeccable design skills to redesign this properly"))
    .toMatchObject({ ok: false, reason: "vague" });
  expect(
    qualityCheckAuthoritativeTaskLabel("Locking the shell-versus-agent regression"),
  ).toMatchObject({ ok: false, reason: "vague" });
  expect(qualityCheckAuthoritativeTaskLabel("Checking agent restore"))
    .toMatchObject({ ok: false, reason: "vague" });
  expect(qualityCheckNowLabel("Implemented and committed the provider-exit guard"))
    .toMatchObject({ ok: false, reason: "implementation-detail" });
  expect(
    qualityCheckGoalLabel(
      "Make the terminal cockpit easy to understand so people can resume work later",
    ).ok,
  )
    .toBe(true);
  expect(
    qualityCheckGoalLabel("Keeping each terminal's purpose clear and stable"),
  ).toMatchObject({ ok: false, reason: "vague" });
  expect(qualityCheckGoalLabel("do it all already!")).toMatchObject({ ok: false, reason: "vague" });
  for (const processGoal of [
    "Implemented the fail-closed evidence gate and reviewer audit: unsupported results, missing",
    "create regression tests so it wont break, and make sure that it never signs me out without me signing out myself",
    "so lets create this unified system because the regressions and bugs are numerous",
    "Make the active terminal/workstream dominant; collapse secondary context until selection only",
    "This session is about delivering the updated TermFleet build and resolving the remaining restart risk",
  ]) {
    expect(qualityCheckGoalLabel(processGoal), processGoal).toMatchObject({ ok: false, reason: "vague" });
  }
  for (const genericGoal of [
    "Keep TermFleet work clear so people can return to the right terminal and continue confidently",
    "Make each TermFleet terminal clear enough to understand at a glance",
    "Make TermFleet show clear tasks, goals, and current activity so work is easy to resume",
    "Help people understand each TermFleet terminal's current work and next step so they can resume confidently",
    "Help people resume TermFleet work by understanding each terminal's purpose and current activity",
    "Make every TermFleet terminal show its purpose and current activity clearly",
  ]) {
    expect(qualityCheckGoalLabel(genericGoal), genericGoal).toMatchObject({
      ok: false,
      reason: "vague",
    });
  }
  expect(
    qualityCheckGoalLabel(
      "Make TermFleet show each terminal's purpose so people can resume the right work confidently",
    ).ok,
  ).toBe(true);
  expect(qualityCheckGoalLabel("Make Jobrunner work clear and dependable so people can resume it confidently"))
    .toMatchObject({ ok: false, reason: "vague" });
  expect(qualityCheckGoalLabel("This session is about delivering the updated TermFleet build")).toMatchObject({
    ok: false,
    reason: "vague",
  });
  expect(qualityCheckNowLabel("Commit passes recovery tests, build, installed release, and restart verification")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
});

test("rejects clipped Goal sentences before any renderer can display them", () => {
  for (const value of [
    "We’re fixing restored agent terminals so they reconnect as agent conversations instead of",
    "We’re making sure terminals return after restarts, while termina…",
  ]) {
    expect(qualityCheckGoalLabel(value), value).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
  }
});

test("trusted about-what output can be accepted as a durable Goal", () => {
  expect(
    qualityCheckGoalLabel(
      "This session is about delivering the updated TermFleet build and resolving the remaining restart risk",
      { allowAboutWhatVoice: true, allowTrustedAboutWhat: true, maxLength: 150 },
    ).ok,
  ).toBe(true);
  expect(
    qualityCheckGoalLabel(
      "Keep every agent terminal connected after relaunch so work can be resumed safely",
      { allowAboutWhatVoice: true, allowTrustedAboutWhat: true, maxLength: 150 },
    ).ok,
  ).toBe(true);
});

test("a clipped kill-relaunch pane does not publish its cut-off line as the Goal", async () => {
  const { summaryFromSidecar } = await import("../src/lib/agentStatusSidecar");
  const summary = summaryFromSidecar(
    {
      cwd: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
      userTask: "$about-what",
      mainTask: "This session is about delivering the updated TermFleet build and resolving the remaining r",
      mainTaskSource: "plan-explanation",
      narration: "I’m diagnosing why TermFleet appears to kill agent panes after restart, with the next step",
      todos: [{ content: "Identifying the process and kill event", status: "in_progress" }],
      turn: "idle",
    },
    {
      task: "Waiting for a clear task",
      now: "Idle — no work is running",
      path: "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    },
  );
  // The captured line ends mid-word; publishing it would put a cut-off sentence on the
  // Goal row. The honest state is "no captured goal" until the pane records a complete
  // one (the anti-clipped contract every other Goal path enforces).
  expect(summary.mainTask ?? "").not.toContain("remaining r");
});

test("rejects serialized status fragments from the Now row", () => {
  expect(qualityCheckNowLabel('installed restart","cwd" "/media/project/ checks failed'))
    .toMatchObject({ ok: false, reason: "prompt-fragment" });
});

test("rejects URLs and absolute paths even when mixed into otherwise readable Task text", () => {
  for (const label of [
    "Yes, push d29159fe to https://github.com/endlessblink/flow-state.git",
    "you didnt do anything https://rc.in-theflow.com/exercise-review/index.html",
    "Review the draft at /media/endlessblink/data/my-projects/draft",
  ]) {
    expect(qualityCheckUserAskLabel(label), label).toMatchObject({
      ok: false,
      reason: "implementation-detail",
    });
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({
      ok: false,
      reason: "implementation-detail",
    });
  }
});

test("rejects a project slug before it can bypass the explicit Goal boundary", () => {
  // A machine slug is never a task, so the lenient operator-ask gate refuses it too —
  // a status-sidecar userTask of "a-meatzevet-courses" reached a live Task row whole
  // (2026-09-16 sweep) because only the Goal gate rejected it.
  expect(qualityCheckUserAskLabel("a-meatzevet-courses")).toMatchObject({
    ok: false,
    reason: "vague",
  });
  expect(qualityCheckGoalLabel("a-meatzevet-courses")).toMatchObject({
    ok: false,
    reason: "vague",
  });
});

test("rejects installed-pane audit choreography as a durable goal", () => {
  for (const label of [
    "Re-auditing the current implementation and live state before the final installed/rendered gate.",
    "Re-audit live pane records and capture sources",
  ]) {
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({ ok: false, reason: "vague" });
  }
});

test("rejects installed-release and agent-recovery process labels as durable Tasks", () => {
  for (const label of [
    "Checking installed",
    "Persisting live agent identity and verifying restart recovery",
  ]) {
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({
      ok: false,
      reason: "vague",
    });
  }
});

test("rejects clarification questions as durable goals", () => {
  for (const label of [
    "what does it mean in practice?",
    "why no free content appears when entering the site signed in?",
  ]) {
    expect(qualityCheckUserAskLabel(label)).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
  }
});

test("rejects operator frustration and repeated-letter complaints as durable goals", () => {
  for (const complaint of [
    "you are working for hours with nothing to show for it",
    "whyyyyyyyyyyyyyyyyyy are you failingggggggggggggggggggggggggggggggg",
    "you are working for hourssssssssssssssssss",
  ]) {
    expect(qualityCheckUserAskLabel(complaint), complaint).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
  }
});

test("rejects a statement that the goal was not met as durable identity", () => {
  expect(qualityCheckUserAskLabel("it has not been met")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
});

test("rejects fiasco postmortems as durable goals", () => {
  expect(
    qualityCheckUserAskLabel(
      "The thing is that I had a fiasco around this exact thing. Go over it again.",
    ),
  ).toMatchObject({ ok: false, reason: "prompt-fragment" });
});

test("rejects goal-management commands as durable goals", () => {
  expect(qualityCheckUserAskLabel("create a goal").ok).toBe(false);
});

test("rejects agent control commands from the visible activity line", () => {
  expect(qualityCheckActivityLabel("Using update_goal").ok).toBe(false);
  expect(qualityCheckActivityLabel("Calling update_plan").ok).toBe(false);
  expect(qualityCheckAuthoritativeTaskLabel("make this a goal").ok).toBe(false);
});

test("rejects vendor template placeholders as goals", () => {
  expect(qualityCheckUserAskLabel("Implement {feature}")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckAuthoritativeTaskLabel("Adding borrowed-feature tasks to the project plans")).toMatchObject({
    ok: true,
  });
});

test("rejects saved final-answer steps as current activity", () => {
  for (const label of [
    "Steps - Open the landing page and confirm the route.",
    "Next steps: hard-refresh production.",
  ]) {
    expect(qualityCheckNowLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  }
});

test("rejects raw prompt echoes and typo-heavy prompt fragments", () => {
  expect(qualityCheckTaskLabel("what now? we still dont ahve high quality descriptions")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("Thinking about what now? we still dont ahve high quality descriptions")).toMatchObject({
    ok: false,
    reason: "raw-thinking-prompt",
  });
  expect(qualityCheckActivityLabel("Reviewing its not logical that we cant find any its just not")).toMatchObject({
    ok: false,
    reason: "raw-thinking-prompt",
  });
  expect(qualityCheckActivityLabel("Still in Plan Mode, so I can’t mutate files yet.")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("You’re now testing the updated packaged app.")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
});

test("rejects command-like and implementation-detail labels", () => {
  for (const label of [
    "npm run verify:terminal-headers-live-all",
    "npx playwright test tests/terminal-header-view-model.spec.ts",
    "/media/endlessblink/data/my-projects/ai-development/devops/termfleet",
    "Md](/home/endlessblink/.",
    "Screenshot](/media/endlessblink/data/my-projects/example.png)",
    "Editing ModelScene.tsx",
    "terminal-workspace-tauri@0.1.0 cockpit:snapshot",
    "Running: sleep 2",
    "Using mcp__node_repl__js",
  ]) {
    expect(qualityCheckTaskLabel(label).ok).toBe(false);
    expect(qualityCheckActivityLabel(label).ok).toBe(false);
  }
});

test("rejects restored raw tool names from the visible Now line", () => {
  expect(qualityCheckNowLabel("Using mcp__lean_ctx__ctx_shell")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
  expect(
    qualityCheckNowLabel("Using mcp__plugin_context-mode_context-mode__ctx_execute"),
  ).toMatchObject({ ok: false });
  expect(qualityCheckNowLabel("Running a command")).toMatchObject({ ok: false });
});

test("rejects stretched prompt text from the permanent Task title", () => {
  expect(
    qualityCheckAuthoritativeTaskLabel("what are you doinggggggggggggggggggggg"),
  ).toMatchObject({ ok: false, reason: "prompt-fragment" });
});

test("rejects short feedback, completion chrome, and prompt echoes as durable identity", () => {
  for (const label of [
    "another fail",
    "update that to the goal",
    "Goal achieved (1h 26m)",
    "Goal stalled (/goal resume)",
    "> Act as an independent reviewer",
  ]) {
    expect(qualityCheckUserAskLabel(label), label).toMatchObject({ ok: false });
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({ ok: false });
  }
});

test("rejects screenshot feedback and failed-test reports as durable identity", () => {
  for (const label of ["this is a fail", "test:e2e failed"]) {
    expect(qualityCheckUserAskLabel(label), label).toMatchObject({ ok: false });
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({ ok: false });
  }
});

test("rejects verification choreography as a durable goal", () => {
  for (const label of [
    "push to production and verify",
    "Verify the installed terminal labels",
  ]) {
    expect(qualityCheckUserAskLabel(label), label).toMatchObject({ ok: false });
    expect(qualityCheckAuthoritativeTaskLabel(label), label).toMatchObject({ ok: false, reason: "vague" });
  }
});

test("rejects hook lifecycle and first-person narration from Now", () => {
  for (const label of [
    "UserPromptSubmit hook (completed)",
    "SessionStart hook (completed)",
    "My repair is correct but currently sitting on the branch",
  ]) {
    expect(qualityCheckNowLabel(label), label).toMatchObject({ ok: false });
    expect(qualityCheckActivityLabel(label), label).toMatchObject({ ok: false });
  }
});

test("rejects agent footer metrics from every visible header field", () => {
  for (const label of [
    "Weekly 57% left • Context 76% used • Main [default]",
    "wk:26%(5d2h) | ctx:8% | session:5m | Fable 5",
  ]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckAuthoritativeTaskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckUserAskLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckNowLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "terminal-chrome" });
  }
});

test("rejects vague activity labels", () => {
  for (const label of ["Working", "Thinking", "Awaiting terminal output", "Running terminal command", "Waiting for operator's response to low-quality image #1"]) {
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false });
  }
  expect(qualityCheckActivityLabel("Waiting for operator selection")).toMatchObject({ ok: true });
});

test("approval and verdict labels must say what is being judged", () => {
  for (const label of ["Waiting for operator verdict", "Waiting for approval", "Awaiting reviewer decision"]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckAuthoritativeTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
  }
  expect(qualityCheckTaskLabel("Waiting for operator verdict on pane header wording").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("Rechecking pane header wording approval")).toMatchObject({
    ok: false,
    reason: "vague",
  });
});

test("rejects cross-system recheck summaries as the terminal goal", () => {
  expect(
    qualityCheckAuthoritativeTaskLabel(
      "Rechecking PR, Actions, runner, and billing state",
    ),
  ).toMatchObject({ ok: false, reason: "vague" });
});

test("rejects a local-page test step as the durable terminal goal", () => {
  expect(
    qualityCheckAuthoritativeTaskLabel(
      "Refreshing the local page with the new test option",
    ),
  ).toMatchObject({ ok: false, reason: "vague" });
});

test("rejects verification and regression-writing procedures as durable goals", () => {
  for (const label of [
    "Run the live installed terminal verification",
    "Adding a regression for empty and settled terminal cards",
    "Record the fresh verification outcome",
  ]) {
    expect(qualityCheckAuthoritativeTaskLabel(label)).toMatchObject({
      ok: false,
      reason: "vague",
    });
  }
});

test("rejects stale one-word prompt fragments as task goals", () => {
  for (const label of ["done", "go", "fix it", "so fix it", "and this", "this", "both"]) {
    expect(qualityCheckUserAskLabel(label)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  }
  expect(qualityCheckUserAskLabel("go over everything and get it ready to merge").ok).toBe(true);
});

test("rejects long conversational requirement dumps as visible labels", () => {
  const raw =
    "I just need ready high quality calls. that are verifiable e2e. anything else is just adding more";
  expect(qualityCheckUserAskLabel(raw)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckTaskLabel(raw)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckActivityLabel("The production inbox says and explains the real gate: a call is required")).toMatchObject({
    ok: false,
  });
});

test("rejects generic build and test result wrappers", () => {
  for (const label of [
    "Raise quality across the current work",
    "Task Complete: Files shipped: - - - profile invoice access",
    "Files shipped: profile invoice access",
    "Frontend build failed",
    "Confidence is HIGH after verifying the local surface",
    "Verify Build and tests result",
    "Build and tests completed successfully",
    "Test process completed successfully",
    "Task completed successfully",
  ]) {
    expect(qualityCheckTaskLabel(label)).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckActivityLabel(label)).toMatchObject({ ok: false, reason: "vague" });
  }
  expect(qualityCheckTaskLabel("Task 7 — mark IZ-009 in the plan and finalize")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckActivityLabel("Running build and visual checks").ok).toBe(true);
});

test("rejects duplicated long task and activity labels", () => {
  expect(headerLabelsAreDuplicated(
    "Fix terminal headers so Task shows the user ask and activity shows current work",
    "Fix terminal headers so Task shows the user ask and activity shows current work",
  )).toBe(true);
  expect(headerLabelsAreDuplicated("Updating old link locations", "Checking old link replacements")).toBe(true);
  expect(headerLabelsAreDuplicated("Improve header descriptions", "Inspecting quality rules")).toBe(false);
});

test("accepts correctly spelled task labels that mention broken things", () => {
  expect(qualityCheckTaskLabel("Fix the broken login flow").ok).toBe(true);
  expect(qualityCheckActivityLabel("Checking why titles and tasks are still broken").ok).toBe(true);
});

test("authoritative task labels only reject empty or overlong text", () => {
  expect(qualityCheckAuthoritativeTaskLabel("Run cargo test for the daemon restore path").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("Update docs/regression-matrix.md with the new failure mode").ok).toBe(true);
  expect(qualityCheckAuthoritativeTaskLabel("")).toMatchObject({ ok: false, reason: "empty" });
  expect(qualityCheckAuthoritativeTaskLabel("x".repeat(200))).toMatchObject({ ok: false, reason: "too-long" });
  expect(qualityCheckAuthoritativeTaskLabel("[hermes] [diagnostics] backend.exit: Primary backend exited")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
});

test("trusted pane titles still reject implementation details", () => {
  expect(qualityCheckTrustedActivityLabel("Cleaning up this pane title").ok).toBe(true);
  expect(qualityCheckTrustedActivityLabel("Implemented the upgraded pipeline in scripts/agent-status-summary-server.mjs")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
  expect(qualityCheckTrustedActivityLabel("Updating scripts/agent-status-summary-server.mjs")).toMatchObject({
    ok: false,
    reason: "implementation-detail",
  });
  expect(qualityCheckTrustedActivityLabel("Your hardware and setup is comfortable for the models")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("You may need to do deeper research to fill knowledge gaps")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("This failure is clear: Task row is too vague because it says nothing about the work")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  expect(qualityCheckTrustedActivityLabel("Stanford credibility guidelines say credibility improves when a site shows trust proof")).toMatchObject({
    ok: false,
    reason: "prompt-fragment",
  });
  for (const label of [
    "I fixed it so live clarify prompts opt out of that compact shape",
    "What I fixed now I deployed and pushed a prevention fix",
    "You can test now with either the desktop shortcut",
    "Use this as the E2E task goal",
    "Root cause: desktop launched but injected from the old app",
    "Strong evidence that the hot surface is not the map",
    "Treat it as a probation window.",
    "What is now covered: - - / - answer prose like",
    "What shipped: - Commit on main",
    "The correct transition is: 1.",
    "The failure path was: 1.",
    "Update the highest-impact places first: - profile - homepage",
    "I left the updated continuous watchdog running",
    ": I can handle the app/code/audit side.",
    "I’ll ground this in what already exists",
    "There’s an existing preview pattern to copy: supports plus",
    "Cleaned and landed safely.",
    "Confidence Rating HIGH for the draft-preview 404 fix.",
    "Right - the Too Much / Live Ink are art exhibitions",
    "I re-read the relevant store",
    "I updated the actual launched checkout to current plus all",
    "VNoneoofhtheiabove to separatOptionally",
  ]) {
    expect(qualityCheckTrustedActivityLabel(label)).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
    expect(qualityCheckActivityLabel(label)).toMatchObject({
      ok: false,
      reason: "prompt-fragment",
    });
  }
});

import { sanitizeScrapedAsk } from "../src/lib/terminalHeaderViewModel";

test("sanitizeScrapedAsk strips prompt markers and the duplicated wrapped fragment", () => {
  expect(
    sanitizeScrapedAsk("› I want to do two main changes right now - I › I want to do two main changes right now - II"),
  ).toBe("I want to do two main changes right now");
  expect(sanitizeScrapedAsk("❯ fix the login flow")).toBe("fix the login flow");
  expect(sanitizeScrapedAsk("plain ask with no markers")).toBe("plain ask with no markers");
  expect(sanitizeScrapedAsk("")).toBe("");
});

import { titleIsCommentaryOrDangling } from "../src/lib/terminalHeaderQuality";

test("a line that starts mid-sentence is rejected as a scrape fragment", () => {
  expect(titleIsCommentaryOrDangling("07s, both calm single-button cards.")).toBe(true);
  expect(titleIsCommentaryOrDangling("and then wiring the resume path")).toBe(true);
  expect(titleIsCommentaryOrDangling("both calm single-button cards")).toBe(true);
  expect(titleIsCommentaryOrDangling("Installing the updated scripts…")).toBe(false);
  expect(titleIsCommentaryOrDangling("Making the timer job fast and calm")).toBe(false);
});

// Class D3 (docs/cockpit-label-quality-matrix.md) — text mangled by stripping inline
// code / names / links. A live sweep found these standing as pane Task rows
// (2026-09-16), and every shape check passed them.
test("damaged-by-stripping text is refused on every gate", () => {
  for (const damaged of [
    "Complete — The fix is deployed, and Resend confirmed delivery to both and from .",
    "find anywhere across the app this message appear and fix it so it wont be broken like this - . no cropping",
    "Staging is clean — no , no , no .",
  ]) {
    expect(qualityCheckUserAskLabel(damaged), damaged).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
    expect(qualityCheckAuthoritativeTaskLabel(damaged), damaged).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
    expect(qualityCheckGoalLabel(damaged, { allowTrustedAboutWhat: true }), damaged).toMatchObject({
      ok: false,
      reason: "incomplete",
    });
  }
});

// A folder slug is a name for a machine. It reached the Task row from a status
// sidecar's userTask on the 2026-09-16 sweep.
test("a machine slug is never a task row", () => {
  for (const slug of ["a-meatzevet-courses", "exercise-demo-gif-pipeline"]) {
    expect(qualityCheckUserAskLabel(slug), slug).toMatchObject({ ok: false, reason: "vague" });
    expect(qualityCheckAuthoritativeTaskLabel(slug), slug).toMatchObject({
      ok: false,
      reason: "vague",
    });
  }
});

// The operator's own report may open with "I" — that is their ask, not agent prose.
test("an operator report that opens with 'I' is still an ask", () => {
  expect(qualityCheckUserAskLabel("I click on mark down and it still happens").ok).toBe(true);
  expect(qualityCheckUserAskLabel("I keep getting all of these warnings").ok).toBe(true);
  // Agent action prose is still refused on the STRICT/authoritative paths, which keep
  // the first-person clause; the lenient operator gate does not judge it.
  expect(qualityCheckAuthoritativeTaskLabel("I committed the fix and pushed it").ok).toBe(false);
});

// A truncated line promises a continuation it never delivers (Class D4). The Goal gate
// had this rule; the authoritative-task gate did not, so a clipped plan explanation
// could stand as the Task row.
test("a clipped sentence is refused as an authoritative task", () => {
  expect(
    qualityCheckAuthoritativeTaskLabel(
      "We’re focused on getting the Blender dinner scene working, starting with whichever needs a",
    ),
  ).toMatchObject({ ok: false, reason: "incomplete" });
});

// Class C1: the status plugins publish the running tool as `now`; a raw tool identifier
// must never stand as the Now row (2026-09-16 sweep).
test("raw tool identifiers are refused as Now activity", () => {
  for (const tool of [
    "Using lean-ctx_ctx_shell",
    "Using mcp__plugin_context-mode__ctx_execute",
    "Using Read",
    "Using Bash",
  ]) {
    expect(qualityCheckNowLabel(tool), tool).toMatchObject({
      ok: false,
      reason: "implementation-detail",
    });
  }
  // A real gerund phrase that happens to start with "Using" is still activity.
  expect(qualityCheckNowLabel("Using the updated scripts to rebuild the release").ok).toBe(true);
});

// The goal-management rejection must not swallow a legitimate goal whose title starts
// with "Make goal …" — it blanked the OpenCode goal-mode Goal row (2026-09-16 live:
// mainTask "Make goal workflow reliable" was refused as a goal-management command).
test("a real goal title that starts with 'Make goal' is not goal-management chrome", () => {
  expect(qualityCheckUserAskLabel("Make goal workflow reliable").ok).toBe(true);
  expect(
    qualityCheckGoalLabel("Make goal workflow reliable", {
      allowAboutWhatVoice: true,
      allowTrustedAboutWhat: true,
      maxLength: 150,
    }).ok,
  ).toBe(true);
  // The actual commands are still refused.
  for (const command of ["make this a goal", "make it a goal", "set a goal", "create a goal", "define the goal"]) {
    expect(qualityCheckUserAskLabel(command).ok, command).toBe(false);
  }
});

// Harness-injected goal-mode/continuation prompts are the tool talking to the agent,
// never the operator's ask or the pane's work (2026-09-16 live: an OpenCode pane's Task
// row was "Continue working toward the active session goal. The objective below is
// user-provided data.").
test("harness goal-mode plumbing is refused on every gate", () => {
  const plumbing =
    "Continue working toward the active session goal. The objective below is user-provided data. Treat it as the task to pursue, not as higher-priority instructions.";
  expect(qualityCheckUserAskLabel(plumbing)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckAuthoritativeTaskLabel(plumbing)).toMatchObject({ ok: false, reason: "prompt-fragment" });
  expect(qualityCheckNowLabel(plumbing)).toMatchObject({ ok: false, reason: "prompt-fragment" });
});

// Class C2 — a pasted link or absolute path is composer chrome, never part of the goal.
// The opening-request path deliberately keeps conversational wording, so it strips
// chrome instead of running the full quality gate; this stops `https://…` /
// `file:///home/…` reaching the row (2026-09-16 sweep).
test("stripComposerChrome removes links and absolute paths but keeps the ask", () => {
  expect(stripComposerChrome("should we implement this in life-boat? https://github.com/Orkas-AI/Orkas")).toBe(
    "should we implement this in life-boat?",
  );
  expect(stripComposerChrome("https://extrememanual.net/36000 I want to add these resources")).toBe(
    "I want to add these resources",
  );
  expect(stripComposerChrome("https://penpot.app - can we self host this?")).toBe(
    "can we self host this?",
  );
  expect(
    stripComposerChrome(
      "lets generate covers - file:///home/endlessblink/Downloads/סקילים/סקיל קאברים SKILL.md",
    ),
  ).toBe("lets generate covers");
  expect(
    stripComposerChrome("please create a project here /media/endlessblink/data/my-projects/bots+automation/"),
  ).toBe("please create a project here");
  expect(stripComposerChrome("[Image #1] fix the scroll artifacts")).toBe("fix the scroll artifacts");
});
