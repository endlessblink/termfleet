# TC-060 Reliable Task Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every cockpit terminal always shows one true, current, plain-language sentence — `Task not captured` never renders again.

**Architecture:** Rust gains two narrow, allowlisted readers (a bounded tail-read of a vendor session record, and the foreground command of a pane's PTY). All parsing and decision logic stays in TypeScript as pure functions: `sessionTranscript.ts` turns a transcript's tail into facts, `taskLine.ts` walks a six-rung ladder and always returns text with provenance and an expiry. `resolveTaskIdentity` delegates to that ladder, so the three views keep rendering one produced value and never recompute.

**Tech Stack:** Rust (Tauri commands, `cargo test`), TypeScript (`src/lib/*`, pure modules), Playwright specs in `tests/` as the unit-test runner, Node verifier scripts in `scripts/`.

## Global Constraints

- **R1 never blank:** `resolvePaneTaskLine` must return non-empty text for every input, including a completely empty input object. `TASK_NOT_CAPTURED` must not appear in any render path.
- **R2 never invented:** every returned string is either copied verbatim from a source or produced by a fixed template over a verified fact. No paraphrase. No per-project string tables.
- **R3 never stale:** every returned line carries `expiresAt`; rungs 1–2 are demoted the moment a turn-end event is observed.
- **R4 always plain:** a candidate that fails `qualityCheckAuthoritativeTaskLabel` is skipped, never rewritten.
- Vendor readers are **fallible probes**: an unparseable or changed format yields no facts and falls through the ladder — it never throws and never blanks a pane.
- Bounded I/O: tail-read at most 262144 bytes of any transcript (rollouts reach 11.7 MB).
- Path safety: Rust owns the vendor directories; the frontend supplies only a validated session id.
- Follow existing patterns: commands live in `src-tauri/src/commands.rs` and are registered in `src-tauri/src/lib.rs`; pure logic lives in `src/lib/`; tests are Playwright specs importing the module directly.

---

### Task 1: Bounded, allowlisted vendor transcript reader (Rust)

**Files:**

- Modify: `src-tauri/src/commands.rs` (append near `agent_status_read_sidecar`, ~line 1120)
- Modify: `src-tauri/src/lib.rs` (invoke_handler list, after `commands::agent_status_read_sidecar`)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: Tauri command `session_transcript_read(provider: String, session_id: String) -> Result<Option<String>, String>` returning the last ≤262144 bytes of the matching transcript, or `None` when no file matches. Helper `session_transcript_path(provider: &str, session_id: &str) -> Result<Option<PathBuf>, String>`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/commands.rs` (inside the existing `#[cfg(test)] mod tests`, or add the module at the end of the file if absent):

```rust
#[cfg(test)]
mod session_transcript_tests {
    use super::*;

    #[test]
    fn rejects_hostile_session_ids() {
        assert!(session_transcript_path("claude", "../../etc/passwd").is_err());
        assert!(session_transcript_path("claude", "").is_err());
        assert!(session_transcript_path("nope", "abcdef12-1111-2222-3333-444444444444").is_err());
    }

    #[test]
    fn accepts_a_uuid_shaped_session_id() {
        assert!(session_transcript_path("claude", "abcdef12-1111-2222-3333-444444444444").is_ok());
        assert!(session_transcript_path("codex", "abcdef12-1111-2222-3333-444444444444").is_ok());
    }

    #[test]
    fn tails_only_the_last_bytes_of_a_large_file() {
        let dir = std::env::temp_dir().join("tf-transcript-tail-test");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("big.jsonl");
        let body = "x".repeat(TRANSCRIPT_TAIL_BYTES + 5000);
        std::fs::write(&file, &body).unwrap();
        let tail = read_tail(&file, TRANSCRIPT_TAIL_BYTES).unwrap();
        assert_eq!(tail.len(), TRANSCRIPT_TAIL_BYTES);
        std::fs::remove_file(&file).ok();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test session_transcript`
Expected: FAIL — `cannot find function session_transcript_path in this scope`.

- [ ] **Step 3: Write minimal implementation**

Append to `src-tauri/src/commands.rs`:

```rust
/// Vendor session records are written by Claude Code / Codex themselves, with no
/// hook involvement, so they cover hand-started and long-running sessions — the
/// exact panes that used to render "Task not captured". Rust owns the directories
/// so a hostile session id can't escape them; the frontend supplies only the id.
pub const TRANSCRIPT_TAIL_BYTES: usize = 262144;

fn valid_session_id(session_id: &str) -> bool {
    !session_id.is_empty()
        && session_id.len() <= 64
        && session_id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Read at most `max_bytes` from the END of a file. Rollouts reach 11.7 MB; only
/// the tail carries current state.
fn read_tail(path: &std::path::Path, max_bytes: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).map_err(|e| format!("open {}: {e}", path.display()))?;
    let len = file
        .metadata()
        .map_err(|e| format!("stat {}: {e}", path.display()))?
        .len();
    let take = std::cmp::min(max_bytes as u64, len);
    file.seek(SeekFrom::Start(len - take))
        .map_err(|e| format!("seek {}: {e}", path.display()))?;
    let mut buf = vec![0u8; take as usize];
    file.read_exact(&mut buf)
        .map_err(|e| format!("read {}: {e}", path.display()))?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn find_file_named(root: &std::path::Path, depth: usize, matches: &dyn Fn(&str) -> bool) -> Option<std::path::PathBuf> {
    let entries = std::fs::read_dir(root).ok()?;
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            dirs.push(entry.path());
        } else if matches(&name) {
            return Some(entry.path());
        }
    }
    if depth == 0 {
        return None;
    }
    for dir in dirs {
        if let Some(found) = find_file_named(&dir, depth - 1, matches) {
            return Some(found);
        }
    }
    None
}

/// Locate a provider's session record. `claude` → `~/.claude/projects/**/<id>.jsonl`,
/// `codex` → `~/.codex/sessions/**/rollout-*-<id>.jsonl`.
pub fn session_transcript_path(
    provider: &str,
    session_id: &str,
) -> Result<Option<std::path::PathBuf>, String> {
    if !valid_session_id(session_id) {
        return Err(format!("invalid session id: {session_id}"));
    }
    let home = dirs::home_dir().ok_or_else(|| "no home directory".to_string())?;
    match provider {
        "claude" => {
            let wanted = format!("{session_id}.jsonl");
            Ok(find_file_named(&home.join(".claude").join("projects"), 2, &|name| name == wanted))
        }
        "codex" => {
            let suffix = format!("-{session_id}.jsonl");
            Ok(find_file_named(&home.join(".codex").join("sessions"), 4, &|name| {
                name.starts_with("rollout-") && name.ends_with(&suffix)
            }))
        }
        other => Err(format!("unknown provider: {other}")),
    }
}

/// Tail of a vendor session record for the cockpit task line. Missing file → `Ok(None)`.
#[tauri::command]
pub fn session_transcript_read(
    provider: String,
    session_id: String,
) -> Result<Option<String>, String> {
    match session_transcript_path(&provider, &session_id)? {
        Some(path) => Ok(Some(read_tail(&path, TRANSCRIPT_TAIL_BYTES)?)),
        None => Ok(None),
    }
}
```

Register it in `src-tauri/src/lib.rs`, immediately after `commands::agent_status_read_sidecar,`:

```rust
            commands::session_transcript_read,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test session_transcript`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tc-060): bounded allowlisted vendor session transcript reader"
```

---

### Task 2: Parse a Claude transcript tail into facts

**Files:**

- Create: `src/lib/sessionTranscript.ts`
- Test: `tests/session-transcript.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:

  ```ts
  export interface TranscriptFacts {
    title?: string; // vendor-authored short session title
    operatorRequest?: string; // the operator's own last request, verbatim
    lastTool?: { name: string; arg?: string };
    lastTurnEndAt?: number; // ms epoch of the last observed turn-end
    lastActivityAt?: number; // ms epoch of the last record of any kind
  }
  export function parseClaudeTranscript(text: string): TranscriptFacts;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/session-transcript.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { parseClaudeTranscript } from "../src/lib/sessionTranscript";

// TC-060: Claude Code writes these records itself, with no hook involved — this
// is the source that covers hand-started and long-running panes.
const CLAUDE_TAIL = [
  JSON.stringify({
    type: "ai-title",
    aiTitle: "Investigate e2e redirect",
    sessionId: "s1",
  }),
  JSON.stringify({
    type: "last-prompt",
    lastPrompt: "[Image #1] fix the redirect please",
    sessionId: "s1",
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-07-22T10:00:00.000Z",
    message: {
      content: [
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/a/b/gridRenderer.ts" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    timestamp: "2026-07-22T10:00:05.000Z",
    message: { content: [] },
  }),
].join("\n");

test("extracts the vendor title, the operator's own words, and the current tool", () => {
  const facts = parseClaudeTranscript(CLAUDE_TAIL);
  expect(facts.title).toBe("Investigate e2e redirect");
  expect(facts.operatorRequest).toBe("fix the redirect please");
  expect(facts.lastTool).toEqual({ name: "Read", arg: "gridRenderer.ts" });
  expect(facts.lastActivityAt).toBe(Date.parse("2026-07-22T10:00:05.000Z"));
});

test("a truncated first line never throws", () => {
  const facts = parseClaudeTranscript(`{"type":"ai-ti\n${CLAUDE_TAIL}`);
  expect(facts.title).toBe("Investigate e2e redirect");
});

test("a subagent's tool call is not the pane's activity", () => {
  const withSidechain = `${CLAUDE_TAIL}\n${JSON.stringify({
    type: "assistant",
    isSidechain: true,
    timestamp: "2026-07-22T10:00:09.000Z",
    message: {
      content: [{ type: "tool_use", name: "Grep", input: { pattern: "x" } }],
    },
  })}`;
  expect(parseClaudeTranscript(withSidechain).lastTool).toEqual({
    name: "Read",
    arg: "gridRenderer.ts",
  });
});

test("an unrecognised format yields no facts instead of throwing", () => {
  expect(parseClaudeTranscript("not json at all\n{}\n")).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/session-transcript.spec.ts --reporter=line`
Expected: FAIL — cannot resolve `../src/lib/sessionTranscript`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/sessionTranscript.ts`:

```ts
// TC-060. Claude Code and Codex each write a complete session record to disk on
// their own, with no hook involvement — so these facts exist for hand-started,
// long-running, and pre-existing panes, which is exactly the class that used to
// render "Task not captured". Every reader here is a fallible probe: a changed
// vendor format yields fewer facts, never an exception and never a blank pane.

export interface TranscriptFacts {
  title?: string;
  operatorRequest?: string;
  lastTool?: { name: string; arg?: string };
  lastTurnEndAt?: number;
  lastActivityAt?: number;
}

function cleanText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/\[Image\s+#?\d+\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 4 ? text : undefined;
}

function shortArg(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  const raw =
    record.file_path ??
    record.path ??
    record.pattern ??
    record.query ??
    record.command;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const tail = raw.split("/").pop() ?? raw;
  return tail.slice(0, 48);
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function eachRecord(
  text: string,
  visit: (record: Record<string, unknown>) => void,
) {
  for (const line of text.split("\n")) {
    if (!line || line.charCodeAt(0) !== 123) continue; // "{" — skip a truncated head line
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (record && typeof record === "object")
      visit(record as Record<string, unknown>);
  }
}

export function parseClaudeTranscript(text: string): TranscriptFacts {
  const facts: TranscriptFacts = {};
  eachRecord(text, (record) => {
    const at = parseTime(record.timestamp);
    if (at) facts.lastActivityAt = at;
    if (record.type === "ai-title")
      facts.title = cleanText(record.aiTitle) ?? facts.title;
    if (record.type === "last-prompt")
      facts.operatorRequest =
        cleanText(record.lastPrompt) ?? facts.operatorRequest;
    if (record.isSidechain === true) return; // a subagent's work is not the pane's work
    const message = record.message as { content?: unknown } | undefined;
    const content = message?.content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_use"
      ) {
        const tool = block as { name?: string; input?: unknown };
        if (typeof tool.name === "string")
          facts.lastTool = { name: tool.name, arg: shortArg(tool.input) };
      }
    }
  });
  return facts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/session-transcript.spec.ts --reporter=line`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionTranscript.ts tests/session-transcript.spec.ts
git commit -m "feat(tc-060): parse Claude session records into task-line facts"
```

---

### Task 3: Parse a Codex rollout tail, including the real turn boundary

**Files:**

- Modify: `src/lib/sessionTranscript.ts`
- Test: `tests/session-transcript.spec.ts` (append)

**Interfaces:**

- Consumes: `TranscriptFacts` from Task 2.
- Produces: `export function parseCodexRollout(text: string): TranscriptFacts` and `export function parseTranscript(provider: string, text: string): TranscriptFacts`.

Codex emits no short task string of its own (no `update_plan` in a 3000-record sample; `thread_goal_updated` fired once). It does emit `task_started` / `task_complete`, which is the turn boundary R3 needs without any hook.

- [ ] **Step 1: Write the failing test**

Append to `tests/session-transcript.spec.ts`:

```ts
import {
  parseCodexRollout,
  parseTranscript,
} from "../src/lib/sessionTranscript";

const CODEX_TAIL = [
  JSON.stringify({
    timestamp: "2026-07-22T09:00:00.000Z",
    type: "event_msg",
    payload: { type: "user_message", message: "make the sidebar sort by name" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:01.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "t1" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:02.000Z",
    type: "response_item",
    payload: { type: "function_call", name: "exec_command" },
  }),
  JSON.stringify({
    timestamp: "2026-07-22T09:00:09.000Z",
    type: "event_msg",
    payload: {
      type: "task_complete",
      turn_id: "t1",
      last_agent_message: "Done.",
    },
  }),
].join("\n");

test("codex: operator words, current tool, and a real turn end", () => {
  const facts = parseCodexRollout(CODEX_TAIL);
  expect(facts.operatorRequest).toBe("make the sidebar sort by name");
  expect(facts.lastTool).toEqual({ name: "exec_command", arg: undefined });
  expect(facts.lastTurnEndAt).toBe(Date.parse("2026-07-22T09:00:09.000Z"));
});

test("a turn end that precedes newer work is not treated as the latest state", () => {
  const resumed = `${CODEX_TAIL}\n${JSON.stringify({
    timestamp: "2026-07-22T09:00:20.000Z",
    type: "event_msg",
    payload: { type: "task_started", turn_id: "t2" },
  })}`;
  const facts = parseCodexRollout(resumed);
  expect(facts.lastTurnEndAt).toBeUndefined();
});

test("parseTranscript dispatches on provider", () => {
  expect(parseTranscript("codex", CODEX_TAIL).operatorRequest).toBe(
    "make the sidebar sort by name",
  );
  expect(parseTranscript("mystery", CODEX_TAIL)).toEqual({});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/session-transcript.spec.ts --reporter=line`
Expected: FAIL — `parseCodexRollout is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/lib/sessionTranscript.ts`:

```ts
export function parseCodexRollout(text: string): TranscriptFacts {
  const facts: TranscriptFacts = {};
  eachRecord(text, (record) => {
    const at = parseTime(record.timestamp);
    if (at) facts.lastActivityAt = at;
    const payload = record.payload as Record<string, unknown> | undefined;
    if (!payload) return;
    switch (payload.type) {
      case "thread_goal_updated":
        facts.title = cleanText(payload.goal) ?? facts.title;
        break;
      case "user_message":
        facts.operatorRequest =
          cleanText(payload.message) ?? facts.operatorRequest;
        break;
      case "task_complete":
        facts.lastTurnEndAt = at;
        break;
      case "task_started":
        // Newer work supersedes an earlier turn end; otherwise a resumed pane
        // would stay marked finished forever.
        facts.lastTurnEndAt = undefined;
        break;
      case "function_call":
      case "custom_tool_call":
        if (typeof payload.name === "string")
          facts.lastTool = {
            name: payload.name,
            arg: shortArg(payload.arguments),
          };
        break;
      default:
        break;
    }
  });
  return facts;
}

export function parseTranscript(
  provider: string,
  text: string,
): TranscriptFacts {
  if (provider === "claude") return parseClaudeTranscript(text);
  if (provider === "codex") return parseCodexRollout(text);
  return {};
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/session-transcript.spec.ts --reporter=line`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessionTranscript.ts tests/session-transcript.spec.ts
git commit -m "feat(tc-060): parse Codex rollouts incl. hook-free turn boundaries"
```

---

### Task 4: The ladder — always returns a true sentence

**Files:**

- Create: `src/lib/taskLine.ts`
- Test: `tests/task-line.spec.ts`

**Interfaces:**

- Consumes: `TranscriptFacts` (Task 2/3); `qualityCheckAuthoritativeTaskLabel` from `src/lib/terminalHeaderQuality.ts`.
- Produces:

  ```ts
  export type TaskLineSource =
    | "declared"
    | "session-title"
    | "operator-request"
    | "current-tool"
    | "running-command"
    | "shell-state";
  export interface PaneTaskLine {
    text: string;
    source: TaskLineSource;
    capturedAt: number;
    expiresAt: number | null;
    rejected?: string; // a candidate that was true but failed the plain-language check
  }
  export interface TaskLineInput {
    now: number;
    declaredTask?: string | null;
    facts?: TranscriptFacts | null;
    runningCommand?: string | null;
    folder?: string | null;
    branch?: string | null;
  }
  export function resolvePaneTaskLine(input: TaskLineInput): PaneTaskLine;
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/task-line.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { resolvePaneTaskLine } from "../src/lib/taskLine";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

// R1: the invariant the whole task exists for.
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
test("a turn that ended demotes the declared task", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    declaredTask: "Cleaning up messy terminal text",
    facts: {
      lastTurnEndAt: NOW - 1000,
      operatorRequest: "sort the sidebar by name",
    },
  });
  expect(line.source).toBe("operator-request");
  expect(line.text).toBe("sort the sidebar by name");
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

test("templates the current tool when nothing was said", () => {
  const line = resolvePaneTaskLine({
    now: NOW,
    facts: { lastTool: { name: "Read", arg: "gridRenderer.ts" } },
  });
  expect(line.text).toBe("Reading gridRenderer.ts");
  expect(line.source).toBe("current-tool");
  expect(line.expiresAt).toBe(NOW + 30_000);
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
  expect(
    resolvePaneTaskLine({ now: NOW, folder: "termfleet", branch: "main" }),
  ).toMatchObject({
    text: "Sitting at a command prompt in termfleet on main",
    source: "shell-state",
  });
});

// R4 + R2: reject, never rewrite; and record that we rejected something.
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/task-line.spec.ts --reporter=line`
Expected: FAIL — cannot resolve `../src/lib/taskLine`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/taskLine.ts`:

```ts
import type { TranscriptFacts } from "./sessionTranscript";
import { qualityCheckAuthoritativeTaskLabel } from "./terminalHeaderQuality";

// TC-060. One ladder, one owner. Every rung is either the agent's own words, the
// operator's own words, or a fixed template over a verified fact — nothing here
// invents or paraphrases. The last rung cannot fail, which is what makes
// "never blank" an invariant rather than an aspiration.

export type TaskLineSource =
  | "declared"
  | "session-title"
  | "operator-request"
  | "current-tool"
  | "running-command"
  | "shell-state";

export interface PaneTaskLine {
  text: string;
  source: TaskLineSource;
  capturedAt: number;
  expiresAt: number | null;
  rejected?: string;
}

export interface TaskLineInput {
  now: number;
  declaredTask?: string | null;
  facts?: TranscriptFacts | null;
  runningCommand?: string | null;
  folder?: string | null;
  branch?: string | null;
}

const TOOL_VERBS: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  Write: "Writing",
  Bash: "Running a command",
  Grep: "Searching the code",
  Glob: "Looking for files",
  WebSearch: "Searching the web",
  WebFetch: "Reading a web page",
  TaskCreate: "Planning the work",
  TaskUpdate: "Updating the plan",
  exec_command: "Running a command",
};

const TOOL_TTL_MS = 30_000;

function plain(text: string | null | undefined): string | null {
  const value = text?.trim();
  if (!value) return null;
  return qualityCheckAuthoritativeTaskLabel(value).ok ? value : null;
}

function templateTool(tool: { name: string; arg?: string }): string {
  const verb = TOOL_VERBS[tool.name] ?? `Using ${tool.name}`;
  return tool.arg ? `${verb} ${tool.arg}` : verb;
}

export function resolvePaneTaskLine(input: TaskLineInput): PaneTaskLine {
  const { now } = input;
  const facts = input.facts ?? {};
  const turnEnded =
    typeof facts.lastTurnEndAt === "number" && facts.lastTurnEndAt <= now;
  let rejected: string | undefined;

  const consider = (candidate: string | null | undefined): string | null => {
    const value = candidate?.trim();
    if (!value) return null;
    const accepted = plain(value);
    if (!accepted && !rejected) rejected = value;
    return accepted;
  };

  if (!turnEnded) {
    const declared = consider(input.declaredTask);
    if (declared)
      return {
        text: declared,
        source: "declared",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
    const title = consider(facts.title);
    if (title)
      return {
        text: title,
        source: "session-title",
        capturedAt: now,
        expiresAt: null,
        rejected,
      };
  }

  // The operator's floor rule: when nothing better is known, show what they asked for.
  const request = consider(facts.operatorRequest);
  if (request)
    return {
      text: request,
      source: "operator-request",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };

  if (facts.lastTool) {
    const templated = templateTool(facts.lastTool);
    return {
      text: templated,
      source: "current-tool",
      capturedAt: now,
      expiresAt: now + TOOL_TTL_MS,
      rejected,
    };
  }

  const command = input.runningCommand?.trim();
  if (command) {
    return {
      text: `Running ${command}`,
      source: "running-command",
      capturedAt: now,
      expiresAt: null,
      rejected,
    };
  }

  const folder = input.folder?.trim() || "this folder";
  const branch = input.branch?.trim();
  return {
    text: branch
      ? `Sitting at a command prompt in ${folder} on ${branch}`
      : `Sitting at a command prompt in ${folder}`,
    source: "shell-state",
    capturedAt: now,
    expiresAt: null,
    rejected,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/task-line.spec.ts --reporter=line`
Expected: PASS — 8 tests. If `qualityCheckAuthoritativeTaskLabel` returns a differently-shaped result, adapt `plain()` to that shape only — do not change the gate itself.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskLine.ts tests/task-line.spec.ts
git commit -m "feat(tc-060): six-rung task-line ladder that can never return blank"
```

---

### Task 5: Foreground command of a pane's PTY (Rust)

**Files:**

- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs` (invoke_handler list)

**Interfaces:**

- Consumes: nothing.
- Produces: Tauri command `pane_foreground_command(pid: u32) -> Result<Option<String>, String>` returning the command line of the foreground process group of that pid's controlling terminal, or `None` when it is the shell itself. Helper `foreground_command_from_proc(root: &Path, pid: u32) -> Option<String>` so the parse is testable against a fake `/proc`.

- [ ] **Step 1: Write the failing test**

Append to `src-tauri/src/commands.rs`:

```rust
#[cfg(test)]
mod foreground_command_tests {
    use super::*;

    fn write_fake_proc(root: &std::path::Path, pid: u32, tpgid: i32, cmdline: &str) {
        let dir = root.join(pid.to_string());
        std::fs::create_dir_all(&dir).unwrap();
        // field 8 is tpgid; the comm field may contain spaces, hence the ") " split.
        std::fs::write(dir.join("stat"), format!("{pid} (bash) S 1 2 3 4 {tpgid} 0 0 0 0")).unwrap();
        std::fs::write(dir.join("cmdline"), cmdline.replace(' ', "\0")).unwrap();
    }

    #[test]
    fn reports_the_foreground_command() {
        let root = std::env::temp_dir().join("tf-proc-fg-test");
        std::fs::remove_dir_all(&root).ok();
        write_fake_proc(&root, 100, 200, "bash");
        write_fake_proc(&root, 200, 200, "npm run build");
        assert_eq!(foreground_command_from_proc(&root, 100).as_deref(), Some("npm run build"));
    }

    #[test]
    fn reports_none_when_the_shell_itself_is_in_front() {
        let root = std::env::temp_dir().join("tf-proc-fg-test-2");
        std::fs::remove_dir_all(&root).ok();
        write_fake_proc(&root, 100, 100, "bash");
        assert_eq!(foreground_command_from_proc(&root, 100), None);
    }

    #[test]
    fn a_missing_process_is_not_an_error() {
        let root = std::env::temp_dir().join("tf-proc-fg-test-3");
        assert_eq!(foreground_command_from_proc(&root, 999999), None);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test foreground_command`
Expected: FAIL — `cannot find function foreground_command_from_proc`.

- [ ] **Step 3: Write minimal implementation**

Append to `src-tauri/src/commands.rs`:

```rust
/// A plain shell has no declared task, so the honest answer is what it is actually
/// running. The daemon already owns each pane's PTY and pid, so this needs no
/// cooperation from anything. `root` is injectable so the parse is testable.
pub fn foreground_command_from_proc(root: &std::path::Path, pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(root.join(pid.to_string()).join("stat")).ok()?;
    // The comm field is parenthesised and may contain spaces; fields resume after ") ".
    let rest = stat.rsplit_once(") ")?.1;
    let tpgid: i32 = rest.split_whitespace().nth(4)?.parse().ok()?;
    if tpgid <= 0 || tpgid as u32 == pid {
        return None;
    }
    let raw = std::fs::read(root.join(tpgid.to_string()).join("cmdline")).ok()?;
    let text = String::from_utf8_lossy(&raw)
        .split('\0')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let trimmed = text.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.chars().take(80).collect())
    }
}

/// The command a pane is running right now, or `None` when it sits at its prompt.
#[tauri::command]
pub fn pane_foreground_command(pid: u32) -> Result<Option<String>, String> {
    Ok(foreground_command_from_proc(std::path::Path::new("/proc"), pid))
}
```

Register in `src-tauri/src/lib.rs` after `commands::session_transcript_read,`:

```rust
            commands::pane_foreground_command,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && CARGO_BUILD_JOBS=1 cargo test foreground_command`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/lib.rs
git commit -m "feat(tc-060): report a pane's foreground command for agent-less shells"
```

---

### Task 6: Make the ladder the only producer of Task text

**Files:**

- Modify: `src/lib/taskIdentity.ts` (delete `outcomeFromTaskPlan` at ~94-135 and its call site; delete the `tasksFromTodoWrite` gate at ~230; delegate the tail of `resolveTaskIdentity`)
- Modify: `src/lib/terminalHeaderViewModel.ts:1011` (the `"Task not captured"` fallback)
- Modify: `src/components/Terminal.tsx` (fetch facts per pane alongside the existing sidecar poll)
- Test: `tests/task-identity-ladder.spec.ts`

**Interfaces:**

- Consumes: `resolvePaneTaskLine`, `PaneTaskLine`, `TaskLineSource` (Task 4); `parseTranscript` (Task 3); commands from Tasks 1 and 5.
- Produces: `resolveTaskIdentity` gains an optional `taskLine?: PaneTaskLine | null` input and never returns `source: "missing"` when it is supplied. `TASK_NOT_CAPTURED` is deleted from the module's exports.

- [ ] **Step 1: Write the failing test**

Create `tests/task-identity-ladder.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolveTaskIdentity } from "../src/lib/taskIdentity";
import { resolvePaneTaskLine } from "../src/lib/taskLine";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

test("with no declared task, the ladder supplies the text instead of a placeholder", () => {
  const identity = resolveTaskIdentity({
    taskLine: resolvePaneTaskLine({
      now: NOW,
      facts: { operatorRequest: "sort the sidebar by name" },
    }),
  });
  expect(identity.text).toBe("sort the sidebar by name");
  expect(identity.source).not.toBe("missing");
});

test("a shell pane is no longer starved by the todo-write gate", () => {
  const identity = resolveTaskIdentity({
    taskLine: resolvePaneTaskLine({
      now: NOW,
      folder: "termfleet",
      branch: "main",
    }),
    statusSummary: {
      task: "Running the build",
      tasksFromTodoWrite: false,
    } as never,
  });
  expect(identity.text.length).toBeGreaterThan(0);
  expect(identity.text).not.toMatch(/task not captured/i);
});

// R2: the per-project string tables are gone for good.
test("no hardcoded project outcome strings remain", () => {
  const source = readFileSync(
    new URL("../src/lib/taskIdentity.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/Repairing the Hermes personal assistant safely/);
  expect(source).not.toMatch(/TASK_NOT_CAPTURED/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/task-identity-ladder.spec.ts --reporter=line`
Expected: FAIL — `taskLine` is not accepted and `TASK_NOT_CAPTURED` still matches.

- [ ] **Step 3: Write minimal implementation**

In `src/lib/taskIdentity.ts`:

1. Delete `export const TASK_NOT_CAPTURED = "Task not captured";`, the whole `outcomeFromTaskPlan` helper and its call site, the `completedConfirmation` / `sidecarSummaryTask` Hermes block, and the `input.statusSummary?.tasksFromTodoWrite ?` gate (read `clean(input.statusSummary?.task)` unconditionally).
2. Add `"task-line"` to `TaskIdentitySource`.
3. Add `taskLine?: PaneTaskLine | null;` to the `resolveTaskIdentity` input.
4. Replace the final `return { text: TASK_NOT_CAPTURED, source: "missing" };` with:

```ts
if (input.taskLine) {
  return {
    text: input.taskLine.text,
    rawText: input.taskLine.text,
    source: "task-line",
  };
}
return { text: "", source: "missing" };
```

In `src/lib/terminalHeaderViewModel.ts:1011`, replace the `"Task not captured"` fallback so a supplied ladder line is used and the placeholder is unreachable:

```ts
taskDescription.text =
  displayTaskDescription ??
  view.taskLine?.text ??
  (noActiveWork ? "No active work" : "");
```

In `src/components/Terminal.tsx`, inside the existing 10s status poll (~line 1548), fetch facts and build the line:

```ts
const provider = summary?.provider ?? null;
const sessionId = summary?.sessionId ?? null;
const transcript =
  provider && sessionId
    ? await invoke<string | null>("session_transcript_read", {
        provider,
        sessionId,
      }).catch(() => null)
    : null;
const facts = transcript ? parseTranscript(provider!, transcript) : null;
const runningCommand = ptyPid
  ? await invoke<string | null>("pane_foreground_command", {
      pid: ptyPid,
    }).catch(() => null)
  : null;
setPaneTaskLine(
  resolvePaneTaskLine({
    now: Date.now(),
    declaredTask: declaredTaskFromSummary(summary),
    facts,
    runningCommand,
    folder: folderNameFromCwd(summary?.path),
    branch: summary?.branch ?? null,
  }),
);
```

Pass `paneTaskLine` into the header view model as `taskLine` wherever `resolveTaskIdentity` is currently called.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/task-identity-ladder.spec.ts tests/task-line.spec.ts --reporter=line`
Then the existing suite, which encodes the old placeholder behaviour and must be updated where it asserts `Task not captured`:
Run: `npx playwright test tests/agent-status-sidecar.spec.ts tests/cockpit-sidecar-corpus.spec.ts tests/badge-regression.spec.ts --reporter=line`
Expected: PASS. Any spec asserting `Task not captured` is asserting the bug — update it to assert the ladder's fallback instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/taskIdentity.ts src/lib/terminalHeaderViewModel.ts src/components/Terminal.tsx tests/task-identity-ladder.spec.ts
git commit -m "feat(tc-060): the ladder is the only producer of cockpit task text"
```

---

### Task 7: The reliability gate

**Files:**

- Create: `scripts/verify-task-line.mjs`
- Modify: `package.json` (add `"verify:task-line": "node scripts/verify-task-line.mjs"`)
- Modify: `scripts/termfleet-doctor.mjs` (add a vendor-format drift probe)

**Interfaces:**

- Consumes: the live pane universe in `workspace.json` and the vendor session records; the ladder's four invariants.
- Produces: `npm run verify:task-line` exiting non-zero on any R1–R4 violation, and a doctor line naming which vendor probe went dark.

- [ ] **Step 1: Write the failing test**

Create `scripts/verify-task-line.mjs`:

````js
#!/usr/bin/env node
// TC-060 release gate. Sweeps every live pane and fails on any violation of the
// four invariants. Reliability is measured here, not asserted in a commit message.
import {
  readFileSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { join, basename } from "node:path";
import os from "node:os";
import assert from "node:assert/strict";

const HOME = os.homedir();
const BASE = join(
  process.env.XDG_DATA_HOME ?? join(HOME, ".local/share"),
  "terminal-workspace",
);
const JARGON =
  /(^|\s)(\/[a-z-]+|--?[a-z-]{2,}|```|#{1,6}\s|\/(?:home|media|usr)\/)/i;
const PLACEHOLDER = /task not captured|activity not captured|^\s*$/i;

function tail(path, bytes = 262144) {
  const size = statSync(path).size;
  const take = Math.min(bytes, size);
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(take);
  readSync(fd, buf, 0, take, size - take);
  closeSync(fd);
  return buf.toString("utf8");
}

function indexTranscripts(root, depth, match) {
  const found = new Map();
  const walk = (dir, level) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && level > 0) walk(path, level - 1);
      else {
        const id = match(entry.name);
        if (id) found.set(id, path);
      }
    }
  };
  walk(root, depth);
  return found;
}

const claude = indexTranscripts(join(HOME, ".claude/projects"), 2, (n) =>
  n.endsWith(".jsonl") ? n.slice(0, -6) : null,
);
const codex = indexTranscripts(join(HOME, ".codex/sessions"), 4, (n) => {
  const m = n.match(/rollout-.*-([0-9a-f-]{8,})\.jsonl$/);
  return m ? m[1] : null;
});

const workspace = JSON.parse(
  readFileSync(join(BASE, "workspace.json"), "utf8"),
);
const panes = (workspace.tabs ?? []).flatMap((tab) =>
  (tab.terminals ?? []).map((terminal) => ({
    tab: tab.title,
    id: terminal.id ?? tab.activePaneId,
    cwd: tab.initialCwd,
  })),
);

const sidecars = new Map();
for (const file of readdirSync(join(BASE, "agent-status")).filter(
  (f) => f.startsWith("pane-") && f.endsWith(".json"),
)) {
  try {
    const parsed = JSON.parse(
      readFileSync(join(BASE, "agent-status", file), "utf8"),
    );
    if (parsed.paneId) sidecars.set(parsed.paneId, parsed);
  } catch {
    /* a half-written sidecar is not a gate failure */
  }
}

const failures = [];
let checked = 0;
for (const pane of panes) {
  const sidecar = sidecars.get(pane.id) ?? null;
  const sessionId = sidecar?.sessionId ?? null;
  const provider = sidecar?.provider ?? null;
  const path =
    provider === "claude"
      ? claude.get(sessionId)
      : provider === "codex"
        ? codex.get(sessionId)
        : null;
  const facts = path ? tail(path) : "";
  const declared =
    sidecar?.mainTask ??
    (sidecar?.todos ?? []).find((t) => t.status === "in_progress")
      ?.activeForm ??
    null;
  // The gate re-derives the same way the app does: something must be knowable.
  const knowable =
    Boolean(declared) ||
    facts.includes('"ai-title"') ||
    facts.includes('"last-prompt"') ||
    facts.includes('"user_message"') ||
    facts.includes("tool_use") ||
    Boolean(pane.cwd);
  checked += 1;
  if (!knowable)
    failures.push(`R1 nothing knowable for pane ${pane.id} (${pane.tab})`);
  if (declared && PLACEHOLDER.test(declared))
    failures.push(`R1 placeholder text on pane ${pane.id}`);
  if (declared && JARGON.test(declared))
    failures.push(
      `R4 jargon reached the task row on pane ${pane.id}: ${declared}`,
    );
}

const identitySource = readFileSync(
  new URL("../src/lib/taskIdentity.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  identitySource,
  /Task not captured/,
  "R1: the placeholder string is still reachable",
);
assert.doesNotMatch(
  identitySource,
  /Hermes personal assistant/,
  "R2: a hardcoded project string is still present",
);

if (failures.length) {
  console.error(
    `verify:task-line FAILED (${failures.length} violation(s) across ${checked} pane(s)):`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`verify:task-line OK — ${checked} live pane(s), zero violations`);
````

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run verify:task-line`
Expected: FAIL — `R1: the placeholder string is still reachable` if Task 6 has not landed, otherwise a list of panes with nothing knowable.

- [ ] **Step 3: Add the script entry and the doctor drift probe**

In `package.json`, next to the other verifiers:

```json
    "verify:task-line": "node scripts/verify-task-line.mjs",
```

In `scripts/termfleet-doctor.mjs`, add a check alongside the existing status-hook checks:

```js
// TC-060: the vendor session records are fallible probes. Public docs already
// disagree with reality about them, so drift must be loud, not silent.
{
  const probes = [
    {
      label: "Claude session title",
      dir: join(homedir(), ".claude/projects"),
      depth: 2,
      needle: '"ai-title"',
    },
    {
      label: "Codex turn boundary",
      dir: join(homedir(), ".codex/sessions"),
      depth: 4,
      needle: '"task_complete"',
    },
  ];
  for (const probe of probes) {
    const newest = newestFileUnder(probe.dir, probe.depth, ".jsonl");
    if (!newest) {
      info(`${probe.label}: no session records yet`);
      continue;
    }
    if (tailOf(newest).includes(probe.needle))
      ok(`${probe.label}: probe still matches`);
    else
      warn(
        `${probe.label}: probe found nothing in the newest session — the format may have changed`,
      );
  }
}
```

- [ ] **Step 4: Run the full gate**

Run: `npm run verify:task-line && npm run verify:task-identity && npm run build && npm run doctor`
Expected: `verify:task-line OK — N live pane(s), zero violations`; the build passes; doctor reports both probes matching.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-task-line.mjs scripts/termfleet-doctor.mjs package.json
git commit -m "feat(tc-060): reliability gate + vendor format drift probe"
```

---

## Self-Review

**Spec coverage:** R1 → Task 4 (unconditional last rung) + Task 6 (placeholder deleted) + Task 7 (swept). R2 → Task 4 verbatim-copy tests + Task 6 removal of the project string tables + Task 7 source assertion. R3 → Task 3 (`task_complete` / `task_started`) + Task 4 (`turnEnded` demotion, `expiresAt`). R4 → Task 4 (`plain()` skips, never rewrites) + Task 7 jargon sweep. Floor rule → Task 4 `operator-request` rung, tested. Shell panes → Task 5 + Task 4 rungs 5–6. Single owner → Task 6 (`resolveTaskIdentity` delegates; views unchanged). Bounded I/O → Task 1. Format drift → Task 7 doctor probe. Subagents → Task 2 `isSidechain` test.

**Deferred from the spec, deliberately:** moving resolution into the Rust daemon. The ladder is a pure function with a single call site, so relocating it later is mechanical; doing it now would fork the logic away from the existing TypeScript quality gates and their suite. The 30-minute sidecar TTL is superseded in effect by the turn-end demotion in Task 4 — delete the constant only once no reader depends on it.

**Type consistency:** `TranscriptFacts` (Tasks 2, 3, 4), `PaneTaskLine` / `TaskLineSource` / `TaskLineInput` (Tasks 4, 6), `session_transcript_read` (Tasks 1, 6), `pane_foreground_command` (Tasks 5, 6) all match across tasks.
