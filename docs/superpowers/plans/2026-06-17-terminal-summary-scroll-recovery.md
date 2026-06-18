# Terminal Summary And Scroll Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore trustworthy terminal cockpit context and working wheel scrolling in fullscreen TUIs.

**Architecture:** Keep the fix small: wheel routing follows real terminal defaults, and the status server can actually launch the local LLM adapter via CLI or env. The React header continues to consume the same summary shape; runtime proof comes from the local dev app, not only unit tests.

**Tech Stack:** Tauri 2, React 19, TypeScript, Playwright, Node.js status server, Ollama-compatible local model adapter.

---

### Task 1: Fix Alt-Screen Wheel Routing

**Files:**
- Modify: `src/lib/terminalMouse.ts`
- Modify: `tests/terminal-mouse.spec.ts`

- [ ] **Step 1: Write the failing expectation**

In `tests/terminal-mouse.spec.ts`, plain alternate-screen wheel must route to app arrows by default:

```ts
expect(out.plainAltScreenWheelUsesTerminalApp).toBe(true);
expect(out.altScreenWheelDownAction).toEqual({ kind: "app-arrows", sequence: "\x1b[B" });
```

Explicit `DECSET 1007 l` still disables faux scrolling:

```ts
expect(out.disabledAlternateScrollUsesHistory).toBe(false);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx playwright test tests/terminal-mouse.spec.ts
```

Expected before implementation: FAIL on `plainAltScreenWheelUsesTerminalApp` or `altScreenWheelDownAction`.

- [ ] **Step 3: Implement minimal routing change**

In `src/lib/terminalMouse.ts`, route wheel input in this order:

```ts
if (modes.mouseReport) return true;
if (modifiers.shiftKey) return false;
if (modifiers.altKey) return true;
if (!modes.altScreen) return false;
if (modes.alternateScrollSet && !modes.alternateScroll) return false;
return true;
```

For `terminalWheelAction`, return `{ kind: "app-arrows" }` for alt-screen unless `alternateScrollSet && !alternateScroll`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx playwright test tests/terminal-mouse.spec.ts
```

Expected: PASS.

### Task 2: Make Status Server Launch The Adapter Reliably

**Files:**
- Modify: `scripts/agent-status-summary-server.mjs`
- Modify: `scripts/verify-agent-status-summary-server.mjs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing adapter invocation check**

In `scripts/verify-agent-status-summary-server.mjs`, add a server run that starts with argv instead of env:

```js
await withServer({
  TERMFLEET_AGENT_STATUS_PORT: "37984",
}, async (endpoint) => {
  // Start server with argv: node server node fake-llm.mjs
});
```

Expected behavior: the fake command receives the payload and returns strict JSON.

- [ ] **Step 2: Run verifier to confirm current mismatch**

Run:

```bash
npm run verify:agent-status-summary
```

Expected before implementation: FAIL for the argv invocation case.

- [ ] **Step 3: Implement argv fallback**

In `scripts/agent-status-summary-server.mjs`, read command from env first, argv second:

```js
import { argv } from "node:process";

const command = process.env.TERMFLEET_AGENT_STATUS_COMMAND || argv[2];
const commandArgs = (() => {
  const raw = process.env.TERMFLEET_AGENT_STATUS_ARGS;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return raw.split(/\s+/).filter(Boolean);
    }
  }
  return argv.slice(3);
})();
```

- [ ] **Step 4: Run verifier to verify adapter path**

Run:

```bash
npm run verify:agent-status-summary
```

Expected: PASS, including env and argv adapter paths.

### Task 3: Restart Runtime With The Real Adapter

**Files:**
- No source files unless runtime command documentation is wrong.

- [ ] **Step 1: Stop stale heuristic-only status server**

Run:

```bash
kill <old-status-server-pid>
```

- [ ] **Step 2: Start adapter-backed server**

Run:

```bash
TERMFLEET_AGENT_STATUS_MODEL=gemma4:e2b-it \
node scripts/agent-status-summary-server.mjs node scripts/agent-status-summary-ollama.mjs
```

Expected output:

```text
TERMFLEET_AGENT_STATUS_SUMMARY_ENDPOINT=http://127.0.0.1:37819/status
```

- [ ] **Step 3: Probe server with noisy terminal text**

Run:

```bash
curl -sS http://127.0.0.1:37819/status \
  -H 'content-type: application/json' \
  --data '{"projectId":"termfleet","transcript":"gpt-5.5 default\nUse /skills to list available skills\nReviewing apply_patch touching src/lib/terminalMouse.ts","workstream":{"mission":"Terminal","provider":"shell","status":"running","path":"termfleet","currentActivity":"gpt-5.5 default"}}'
```

Expected: `now` is about `apply_patch` or reviewing the terminalMouse file, not `/skills` or `gpt default`.

### Task 4: Verify User-Visible Runtime

**Files:**
- No source files unless runtime evidence fails.

- [ ] **Step 1: Restart Tauri dev app**

Run:

```bash
VITE_AGENT_STATUS_SUMMARY_ENDPOINT=http://127.0.0.1:37819/status npm run tauri:dev
```

- [ ] **Step 2: Check visible header**

Expected: header title/now do not show `gpt default`, `/skills`, or `Working ... esc to interrupt` when useful visible output exists.

- [ ] **Step 3: Check wheel behavior**

Expected: normal shell scrollback scrolls TermFleet history; fullscreen TUI wheel sends arrows unless mouse reporting is active; Shift+wheel forces outer history.

---

## Self-Review

- Spec coverage: covers both user-reported failures: broken summary and broken scrolling.
- Placeholder scan: no TBD/fill-later items.
- Type consistency: uses existing `TerminalWheelModes`, `TerminalWheelAction`, and status summary JSON shape.
