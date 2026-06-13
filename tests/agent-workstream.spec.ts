import { expect, test } from "@playwright/test";

const PRIMARY_MISSION = "Investigate flaky checkout flow";

test.use({
  viewport: { width: 1440, height: 920 },
  launchOptions: {
    executablePath: "/usr/bin/chromium",
    args: ["--disable-crash-reporter", "--disable-crashpad", "--disable-gpu"],
  },
});

async function resetWorkspace(page: import("@playwright/test").Page) {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.removeItem("terminal-workspace.v1"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
}

async function createAgentWorkstream(page: import("@playwright/test").Page, mission = PRIMARY_MISSION) {
  await page.getByRole("textbox", { name: "Workspace command" }).click();
  await page.getByRole("textbox", { name: "Workspace command" }).fill("agent workstream");
  const dialogPromise = new Promise<void>((resolve, reject) => {
    page.once("dialog", async (dialog) => {
      try {
        expect(dialog.message()).toContain("Mission for Codex workstream");
        await dialog.accept(mission);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  await page.getByText("New agent workstream").click();
  await dialogPromise;
}

async function sendFollowUp(page: import("@playwright/test").Page, text: string) {
  await page.getByRole("textbox", { name: "Agent follow-up prompt" }).fill(text);
  await page.getByRole("button", { name: "Queue follow-up prompt" }).click();
}

test("command palette creates a supervised Codex workstream on the map", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5177" });
  await resetWorkspace(page);

  await createAgentWorkstream(page);

  await expect(page.getByText("agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Codex · running")).toBeVisible();
  await expect(page.getByText("Codex workstream").first()).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-total")).toHaveText("1 agents");
  await expect(page.getByTestId("map-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-total")).toHaveText("1 agents");
  await expect(page.getByTestId("agent-cockpit-panel")).toBeVisible();
  await expect(page.getByText("Mission")).toBeVisible();
  await expect(page.getByText(PRIMARY_MISSION).first()).toBeVisible();
  await expect(page.getByText("interactive CLI")).toBeVisible();
  await expect(page.getByText("path-checked")).toBeVisible();
  await expect(page.getByText("watching")).toBeVisible();
  await expect(page.getByText("terminal inferred")).toBeVisible();
  await expect(page.getByText("pty fallback")).toBeVisible();
  await expect(page.getByText("Prompt sent to provider")).toBeVisible();
  await expect(page.getByText("Watch provider response")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Prompts")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Outcome")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Run")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Done")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Reviewed")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Prompt sent")).toBeVisible();

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      title: agent?.title,
      provider: agent?.workstream?.provider,
      providerAvailable: agent?.workstream?.providerAvailable,
      providerAvailabilityMessage: agent?.workstream?.providerAvailabilityMessage,
      startupCommand: agent?.workstream?.startupCommand,
      runId: agent?.workstream?.runId,
      createdAt: agent?.workstream?.createdAt,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      exitCode: agent?.workstream?.exitCode,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      generation: agent?.workstream?.generation,
      mission: agent?.workstream?.mission,
      prompt: agent?.workstream?.prompt,
      phase: agent?.workstream?.phase,
      launchMode: agent?.workstream?.launchMode,
      readinessCheck: agent?.workstream?.readinessCheck,
      authCheck: agent?.workstream?.authCheck,
      readiness: agent?.workstream?.readiness,
      stopBehavior: agent?.workstream?.stopBehavior,
      controlProtocol: agent?.workstream?.controlProtocol,
      structuredStatus: agent?.workstream?.structuredStatus,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      status: agent?.workstream?.status,
      events: agent?.workstream?.events?.map((event: { kind?: string; label?: string; detail?: string; status?: string }) => ({
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        status: event.status,
      })),
      initialInput: agent?.workstream?.inputQueue?.find((input: { text?: string }) =>
        input.text === "Investigate flaky checkout flow"
      ),
    };
  })).toMatchObject({
    title: "Codex workstream",
    provider: "codex",
    providerAvailable: true,
    providerAvailabilityMessage: "Browser preview simulates provider startup; desktop checks PATH before launch.",
    startupCommand: "codex",
    runId: expect.stringMatching(/^codex-[a-z0-9]+-[a-z0-9]{6}$/),
    createdAt: expect.any(Number),
    completedAt: undefined,
    reviewedAt: undefined,
    exitCode: undefined,
    stage: undefined,
    artifact: undefined,
    confidence: undefined,
    risk: undefined,
    generation: 0,
    mission: PRIMARY_MISSION,
    prompt: PRIMARY_MISSION,
    phase: "active",
    launchMode: "interactive CLI",
    readinessCheck: "PATH check only; auth/session readiness is confirmed by CLI output.",
    authCheck: "CLI output scan for login, API key, OAuth, or sign-in prompts.",
    readiness: "path-checked",
    stopBehavior: "PTY interrupt/kill until provider-native cancel is available.",
    controlProtocol: "TermFleet prompt queue plus PTY Ctrl-C/kill fallback.",
    structuredStatus: false,
    lastSummary: "Prompt sent to provider",
    nextAction: "Watch provider response",
    promptCount: 1,
    sentCount: 1,
    signalCount: 0,
    controlCount: 0,
    outcome: "Prompt sent",
    status: "running",
    events: expect.arrayContaining([
      expect.objectContaining({ kind: "created", label: "Mission created", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "provider", label: "Codex ready" }),
      expect.objectContaining({ kind: "prompt", label: "Launch prompt queued", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "status", label: "Status changed to running", status: "running" }),
    ]),
    initialInput: {
      text: PRIMARY_MISSION,
    },
  });

  await expect(page.getByRole("form", { name: "Agent operator composer" })).toBeVisible();
  await sendFollowUp(page, "echo waiting for input");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    const launchInput = agent?.workstream?.inputQueue?.find((item: { text?: string }) =>
      item.text === "Investigate flaky checkout flow"
    );
    const input = agent?.workstream?.inputQueue?.find((item: { text?: string }) =>
      item.text === "echo waiting for input"
    );
    const ptys = (window as typeof window & {
      __terminalWorkspaceBrowserPtys?: Record<string, { input: string; output: string }>;
    }).__terminalWorkspaceBrowserPtys ?? {};
    return {
      prompt: agent?.workstream?.prompt,
      mission: agent?.workstream?.mission,
      launchPromptSent: typeof launchInput?.sentAt === "number",
      queuedText: input?.text,
      sent: typeof input?.sentAt === "number",
      phase: agent?.workstream?.phase,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      status: agent?.workstream?.status,
      events: agent?.workstream?.events?.map((event: { kind?: string; label?: string; detail?: string; status?: string }) => ({
        kind: event.kind,
        label: event.label,
        detail: event.detail,
        status: event.status,
      })),
      outputHasPrompt: Object.values(ptys).some((session) =>
        session.output.includes("waiting for input")
      ),
    };
  })).toEqual({
    prompt: "echo waiting for input",
    mission: PRIMARY_MISSION,
    launchPromptSent: true,
    queuedText: "echo waiting for input",
    sent: true,
    phase: "needs-input",
    lastSummary: "Provider is waiting for operator input",
    nextAction: "Send a follow-up prompt",
    promptCount: 2,
    sentCount: 2,
    status: "waiting",
    events: expect.arrayContaining([
      expect.objectContaining({ kind: "sent", label: "Prompt sent", detail: PRIMARY_MISSION }),
      expect.objectContaining({ kind: "prompt", label: "Follow-up queued", detail: "echo waiting for input" }),
      expect.objectContaining({ kind: "sent", label: "Prompt sent", detail: "echo waiting for input" }),
      expect.objectContaining({ kind: "status", label: "Status changed to waiting", status: "waiting" }),
    ]),
    outputHasPrompt: true,
  });
  await expect(page.getByText("Codex · waiting")).toBeVisible();
  await expect(page.getByText("Follow-up queued")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider is waiting for operator input")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Send a follow-up prompt")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("Latest input")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("echo waiting for input")).toBeVisible();
  await expect(page.getByLabel("Agent input history").getByText("sent", { exact: true })).toBeVisible();

  await sendFollowUp(page, "authentication required: sign in with an API key");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      outcome: agent?.workstream?.outcome,
      hasAuthEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider auth required"
      ),
    };
  })).toEqual({
    status: "waiting",
    phase: "needs-input",
    readiness: "auth-required",
    lastSummary: "Provider requires authentication",
    nextAction: "Authenticate the CLI, then restart or send a recovery prompt",
    promptCount: 3,
    sentCount: 3,
    outcome: "Provider requires authentication",
    hasAuthEvent: true,
  });
  await expect(page.getByText("required", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider requires authentication")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Auth required");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Authenticate the CLI");
  await expect(page.getByTestId("map-agent-lane-attention")).toContainText("Auth required");

  const agentTabId = await page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { id?: string; workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return agent?.id;
  });
  await page.getByRole("button", { name: "Add terminal" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    return state?.activeTabId;
  })).not.toBe(agentTabId);
  await page.getByTestId("canvas-agent-lane-attention").click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    return state?.activeTabId;
  })).toBe(agentTabId);

  const failureSignal =
    '[[TERMFLEET_AGENT_EVENT {"status":"failed","phase":"blocked","readiness":"provider-ready","exitCode":2,"stage":"failure analysis","confidence":"low","risk":"provider crashed before saving state","summary":"Provider crashed","nextAction":"Inspect output and send recovery prompt","evidence":"stderr: provider exited 2","artifact":"logs/provider-crash.txt","label":"Structured failure","detail":"Provider exited with a non-zero status."}]]';
  await sendFollowUp(page, failureSignal);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      evidence: agent?.workstream?.evidence,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      exitCode: agent?.workstream?.exitCode,
      outcome: agent?.workstream?.outcome,
      hasFailureSignal: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "signal" && event.label === "Structured failure"
      ),
    };
  })).toEqual({
    status: "failed",
    phase: "blocked",
    readiness: "provider-ready",
    lastSummary: "Provider crashed",
    nextAction: "Inspect output and send recovery prompt",
    evidence: "stderr: provider exited 2",
    stage: "failure analysis",
    artifact: "logs/provider-crash.txt",
    confidence: "low",
    risk: "provider crashed before saving state",
    promptCount: 4,
    sentCount: 4,
    signalCount: 1,
    exitCode: 2,
    outcome: "Structured failure",
    hasFailureSignal: true,
  });
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Blocked");
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider crashed")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("stderr: provider exited 2")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("logs/provider-crash.txt")).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("failure analysis", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("low", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("provider crashed before saving state", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Draft recovery prompt" })).toBeVisible();
  await page.getByRole("button", { name: "Draft recovery prompt" }).click();
  await expect(page.getByRole("textbox", { name: "Agent follow-up prompt" })).toHaveValue(/Recover Codex workstream/);
  await page.getByRole("button", { name: "Queue follow-up prompt" }).click();
  await expect(page.getByLabel("Agent input history").getByText("Recover Codex workstream")).toBeVisible();

  await sendFollowUp(page, "welcome authenticated session ready");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      outcome: agent?.workstream?.outcome,
      hasReadyEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider session ready"
      ),
    };
  })).toEqual({
    status: "running",
    phase: "active",
    readiness: "provider-ready",
    lastSummary: "Provider session is ready",
    nextAction: "Send a task or watch provider response",
    promptCount: 6,
    sentCount: 6,
    outcome: "Provider session is ready",
    hasReadyEvent: true,
  });
  await expect(page.getByText("ready", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider session is ready")).toBeVisible();

  await page.getByRole("button", { name: "Interrupt workstream" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      outputHasInterrupt: Object.values((window as typeof window & {
        __terminalWorkspaceBrowserPtys?: Record<string, { input: string; output: string }>;
      }).__terminalWorkspaceBrowserPtys ?? {}).some((session) =>
        session.output.includes("^C")
      ),
    };
  })).toEqual({
    status: "running",
    phase: "cancelling",
    lastSummary: "Cancellation requested",
    nextAction: "Wait for provider acknowledgement or hard-stop",
    promptCount: 6,
    sentCount: 6,
    controlCount: 1,
    outcome: "Cancellation requested",
    lastEvent: "Cancellation requested",
    outputHasInterrupt: true,
  });
  await expect(page.getByTestId("agent-cockpit-panel").getByText("cancelling")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Cancellation requested")).toBeVisible();

  await sendFollowUp(page, "provider cancelled the run");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      hasInterruptedEvent: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "provider" && event.label === "Provider interrupted"
      ),
    };
  })).toEqual({
    status: "stopped",
    phase: "interrupted",
    readiness: "provider-ready",
    lastSummary: "Provider acknowledged cancellation",
    nextAction: "Restart or close the workstream",
    promptCount: 7,
    sentCount: 7,
    controlCount: 1,
    outcome: "Provider acknowledged cancellation",
    hasInterruptedEvent: true,
  });
  await expect(page.getByLabel("Agent operator guidance").getByText("Provider acknowledged cancellation")).toBeVisible();

  await page.getByRole("button", { name: "Stop workstream" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      terminalCount: agent?.terminals?.length,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    status: "stopped",
    phase: "interrupted",
    lastSummary: "Workstream stopped",
    nextAction: "Restart or close the workstream",
    terminalCount: 0,
    controlCount: 2,
    outcome: "Stopped by operator",
    lastEvent: "Stopped by operator",
  });
  await expect(page.getByText("Codex · stopped")).toBeVisible();

  await page.getByRole("button", { name: "Restart workstream" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      generation: agent?.workstream?.generation,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    status: "running",
    phase: "active",
    lastSummary: "Provider is running",
    nextAction: "Watch provider response",
    generation: 1,
    controlCount: 3,
    outcome: "Provider is running",
    lastEvent: "Status changed to running",
  });
  await expect(page.getByText("Codex · running")).toBeVisible();

  const structuredSignal =
    '[[TERMFLEET_AGENT_EVENT {"status":"done","phase":"complete","readiness":"provider-ready","exitCode":0,"stage":"review","confidence":"high","risk":"low residual risk","summary":"Structured task completed","nextAction":"Review structured result","evidence":"tests: checkout-flow.spec passed","artifact":"reports/checkout-flow.md","label":"Structured completion","detail":"Provider emitted a machine-readable completion signal."}]]';
  await sendFollowUp(page, structuredSignal);

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      readiness: agent?.workstream?.readiness,
      structuredStatus: agent?.workstream?.structuredStatus,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      evidence: agent?.workstream?.evidence,
      stage: agent?.workstream?.stage,
      artifact: agent?.workstream?.artifact,
      confidence: agent?.workstream?.confidence,
      risk: agent?.workstream?.risk,
      promptCount: agent?.workstream?.promptCount,
      sentCount: agent?.workstream?.sentCount,
      signalCount: agent?.workstream?.signalCount,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      exitCode: agent?.workstream?.exitCode,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
      hasStructuredSignal: agent?.workstream?.events?.some((event: { kind?: string; label?: string }) =>
        event.kind === "signal" && event.label === "Structured completion"
      ),
    };
  })).toEqual({
    status: "done",
    phase: "complete",
    readiness: "provider-ready",
    structuredStatus: true,
    lastSummary: "Structured task completed",
    nextAction: "Review structured result",
    evidence: "tests: checkout-flow.spec passed",
    stage: "review",
    artifact: "reports/checkout-flow.md",
    confidence: "high",
    risk: "low residual risk",
    promptCount: 8,
    sentCount: 8,
    signalCount: 2,
    controlCount: 3,
    outcome: "Structured completion",
    exitCode: 0,
    completedAt: expect.any(Number),
    reviewedAt: undefined,
    lastEvent: "Structured completion",
    hasStructuredSignal: true,
  });
  await expect(page.getByText("Codex · done")).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Structured task completed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("Review structured result", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("tests: checkout-flow.spec passed", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent operator guidance").getByText("reports/checkout-flow.md", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("review", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("high", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent provider control surface").getByText("low residual risk", { exact: true })).toBeVisible();
  await expect(page.getByText("structured", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("Exit")).toBeVisible();
  await expect(page.getByLabel("Agent run record").getByText("0", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Complete");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toContainText("Review structured result");

  await page.getByRole("button", { name: "Copy agent run brief" }).click();
  const copiedBrief = await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText()));
  await copiedBrief.toContain("Agent workstream: Codex workstream");
  await copiedBrief.toMatch(/Run: codex-[a-z0-9]+-[a-z0-9]{6} \(generation 1\)/);
  await copiedBrief.toContain(`Mission: ${PRIMARY_MISSION}`);
  await copiedBrief.toContain("Provider: Codex");
  await copiedBrief.toContain("Status: done / complete");
  await copiedBrief.toContain("Readiness: provider-ready");
  await copiedBrief.toContain("Stage: review");
  await copiedBrief.toContain("Confidence: high");
  await copiedBrief.toContain("Risk: low residual risk");
  await copiedBrief.toContain("Exit: 0");
  await copiedBrief.toMatch(/Timing: started=.*completed=.*reviewed=pending/);
  await copiedBrief.toContain("Summary: Structured task completed");
  await copiedBrief.toContain("Next: Review structured result");
  await copiedBrief.toContain("Evidence: tests: checkout-flow.spec passed");
  await copiedBrief.toContain("Artifact: reports/checkout-flow.md");
  await copiedBrief.toContain("Outcome: Structured completion");
  await copiedBrief.toContain("Latest input: sent - [[TERMFLEET_AGENT_EVENT");
  await copiedBrief.toContain("Run record: prompts=8, sent=8, signals=2, controls=3");
  await copiedBrief.toContain("Latest event: signal - Structured completion");

  await page.getByRole("button", { name: "Mark run reviewed" }).click();
  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agent = state?.tabs?.find((tab: { workstream?: { kind?: string } }) =>
      tab.workstream?.kind === "agent"
    );
    return {
      status: agent?.workstream?.status,
      phase: agent?.workstream?.phase,
      lastSummary: agent?.workstream?.lastSummary,
      nextAction: agent?.workstream?.nextAction,
      controlCount: agent?.workstream?.controlCount,
      outcome: agent?.workstream?.outcome,
      exitCode: agent?.workstream?.exitCode,
      completedAt: agent?.workstream?.completedAt,
      reviewedAt: agent?.workstream?.reviewedAt,
      lastEvent: agent?.workstream?.events?.at(-1)?.label,
    };
  })).toEqual({
    status: "done",
    phase: "reviewed",
    lastSummary: "Workstream reviewed",
    nextAction: "Close or restart the workstream",
    controlCount: 4,
    outcome: "Reviewed by operator",
    exitCode: 0,
    completedAt: expect.any(Number),
    reviewedAt: expect.any(Number),
    lastEvent: "Reviewed by operator",
  });
  await expect(page.getByLabel("Agent operator guidance").getByText("Workstream reviewed", { exact: true })).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("1 complete");
  await expect(page.getByTestId("canvas-agent-lane-summary")).toContainText("0 attention");
  await expect(page.getByTestId("canvas-agent-lane-attention")).toHaveCount(0);

  await page.screenshot({
    path: test.info().outputPath("agent-workstream-map.png"),
    fullPage: true,
  });
});

test("agent lane summarizes multiple supervised workstreams", async ({ page }) => {
  await resetWorkspace(page);

  await createAgentWorkstream(page, "Audit deployment scripts");
  await createAgentWorkstream(page, "Prepare release notes");

  await expect(page.getByTestId("canvas-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("canvas-agent-lane-total")).toHaveText("2 agents");
  await expect(page.getByTestId("map-agent-lane-summary")).toBeVisible();
  await expect(page.getByTestId("map-agent-lane-total")).toHaveText("2 agents");
  await expect(page.getByTestId("map-agent-lane-summary")).toContainText("2 active");

  await expect.poll(async () => page.evaluate(() => {
    const raw = localStorage.getItem("terminal-workspace.v1");
    const state = raw ? JSON.parse(raw) : null;
    const agents = state?.tabs?.filter((tab: { workstream?: { kind?: string; status?: string; phase?: string } }) =>
      tab.workstream?.kind === "agent"
    ) ?? [];
    return {
      count: agents.length,
      running: agents.filter((tab: { workstream?: { status?: string } }) => tab.workstream?.status === "running").length,
      active: agents.filter((tab: { workstream?: { phase?: string } }) => tab.workstream?.phase === "active").length,
    };
  })).toEqual({
    count: 2,
    running: 2,
    active: 2,
  });
});
