//! Running / Waiting / Idle for a Codex pane from Codex's OWN live session log
//! (TF-044), with no dependency on status hooks or on the pane being drawn.
//!
//! Codex keeps its rollout (`~/.codex/sessions/**/rollout-*.jsonl`) open while it
//! runs. The log alone settles most of the lifecycle:
//! - the newest turn boundary is `task_complete` / `turn_aborted` → idle;
//! - mid-turn with no tool call awaiting its result → working (the model is thinking);
//! - a tool call with no result yet is either a command RUNNING or a command waiting
//!   for the operator's APPROVAL — Codex writes nothing while it waits, so the log
//!   cannot tell them apart. The process table can: an approved command runs as a
//!   child process started after the call; no such child → waiting for approval.
//!   `request_user_input` is always waiting.
//!
//! Hooks were switched off for a day (2026-09-22) and every Codex pane silently kept
//! its last hook state; this reader keeps the badge true regardless.

use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lifecycle {
    Working,
    Waiting,
    Idle,
}

impl Lifecycle {
    pub fn as_str(self) -> &'static str {
        match self {
            Lifecycle::Working => "working",
            Lifecycle::Waiting => "waiting",
            Lifecycle::Idle => "idle",
        }
    }
}

/// What the rollout tail says, before the process table is consulted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogState {
    Idle,
    Thinking,
    /// A tool call with no result yet: its name, start time (epoch ms), and whether
    /// Codex could be holding it for the operator's approval at all.
    PendingCall { name: String, started_ms: i64, can_need_approval: bool },
}

/// Only a shell command or a patch can sit on Codex's approval prompt. Waits, sleeps,
/// helper-agent calls and a script that only calls built-in/MCP tools run inside Codex
/// and never start a program, so the "no new child process" test misread every one of
/// them as an approval prompt (operator report 2026-09-23: panes showing "Working (7m…)"
/// listed under Pending approval). In the rollouts of the prior three days `wait`,
/// `sleep` and `wait_agent` alone accounted for ~1,000 calls pending longer than 10s.
fn call_can_need_approval(name: &str, input: &str) -> bool {
    match name {
        "wait" | "sleep" | "wait_agent" | "send_message" | "followup_task" | "list_agents"
        | "spawn_agent" | "interrupt_agent" | "request_user_input_async" | "update_plan"
        | "view_image" | "web_search" | "write_stdin" => false,
        // Code mode: a JavaScript cell that calls other tools. It can reach the
        // approval prompt only through a command or patch it runs.
        // Match the tool CALL, not a bare word: `tools.mcp__lean_ctx__ctx_shell` is an
        // auto-approved MCP tool, and the word "shell" alone flagged it.
        "exec" => ["tools.exec_command", "tools.shell", "tools.apply_patch", "sandbox_permissions"]
            .iter()
            .any(|tool| input.contains(tool)),
        _ => true,
    }
}

const TAIL_BYTES: u64 = 512 * 1024;

/// Days since 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (month + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// `2026-09-23T08:56:01.387Z` → epoch milliseconds.
pub fn parse_utc_timestamp_ms(value: &str) -> Option<i64> {
    let bytes = value.as_bytes();
    if bytes.len() < 19 || bytes[4] != b'-' || bytes[10] != b'T' {
        return None;
    }
    let num = |range: std::ops::Range<usize>| value.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let (hour, minute, second) = (num(11..13)?, num(14..16)?, num(17..19)?);
    let millis = value
        .get(19..)
        .and_then(|rest| rest.strip_prefix('.'))
        .map(|rest| rest.trim_end_matches('Z'))
        .and_then(|fraction| {
            let digits: String = fraction.chars().take(3).collect();
            let padded = format!("{digits:0<3}");
            padded.parse::<i64>().ok()
        })
        .unwrap_or(0);
    let days = days_from_civil(year, month, day);
    Some(((days * 24 + hour) * 60 + minute) * 60_000 + second * 1000 + millis)
}

/// Classify the tail of a rollout. Lines are processed oldest → newest.
pub fn classify_rollout_tail(tail: &str) -> LogState {
    let mut state_idle = false;
    // call_id → (name, started_ms), kept in arrival order.
    let mut pending: Vec<(String, String, i64, bool)> = Vec::new();
    for line in tail.lines() {
        let Ok(record) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // first line of a tail window is usually cut
        };
        let payload = record.get("payload");
        let kind = payload
            .and_then(|payload| payload.get("type"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        match (record.get("type").and_then(|value| value.as_str()), kind) {
            (Some("event_msg"), "task_complete" | "turn_aborted") => {
                state_idle = true;
                pending.clear();
            }
            (Some("event_msg"), "task_started") => {
                state_idle = false;
                pending.clear();
            }
            (Some("response_item"), "function_call" | "custom_tool_call" | "local_shell_call") => {
                state_idle = false;
                let payload = payload.expect("payload has a type");
                let call_id = payload
                    .get("call_id")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string();
                let name = payload
                    .get("name")
                    .and_then(|value| value.as_str())
                    .unwrap_or(kind)
                    .to_string();
                let started_ms = record
                    .get("timestamp")
                    .and_then(|value| value.as_str())
                    .and_then(parse_utc_timestamp_ms)
                    .unwrap_or(0);
                let input = payload
                    .get("input")
                    .or_else(|| payload.get("arguments"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                let can_need_approval = call_can_need_approval(&name, input);
                pending.push((call_id, name, started_ms, can_need_approval));
            }
            (
                Some("response_item"),
                "function_call_output" | "custom_tool_call_output" | "local_shell_call_output",
            ) => {
                let call_id = payload
                    .and_then(|payload| payload.get("call_id"))
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                pending.retain(|(id, ..)| id != call_id);
            }
            (Some("response_item"), "reasoning" | "message" | "agent_message") => {
                state_idle = false;
            }
            _ => {}
        }
    }
    if state_idle {
        return LogState::Idle;
    }
    match pending.pop() {
        Some((_, name, started_ms, can_need_approval)) => {
            LogState::PendingCall { name, started_ms, can_need_approval }
        }
        None => LogState::Thinking,
    }
}

/// Combine the log with the process table: `child_started_after(ms)` reports whether
/// the agent has a descendant process that started at or after `ms`.
pub fn lifecycle_from(log: &LogState, child_started_after: impl Fn(i64) -> bool) -> Lifecycle {
    match log {
        LogState::Idle => Lifecycle::Idle,
        LogState::Thinking => Lifecycle::Working,
        LogState::PendingCall { name, .. } if name == "request_user_input" => Lifecycle::Waiting,
        LogState::PendingCall { can_need_approval: false, .. } => Lifecycle::Working,
        // Allow a second of clock slack between the log stamp and process start.
        LogState::PendingCall { started_ms, .. } => {
            if child_started_after(started_ms - 1000) {
                Lifecycle::Working
            } else {
                Lifecycle::Waiting
            }
        }
    }
}

fn newest_open_rollout(pid: u32) -> Option<PathBuf> {
    let mut newest: Option<(PathBuf, std::time::SystemTime)> = None;
    for entry in std::fs::read_dir(format!("/proc/{pid}/fd")).ok()?.flatten() {
        let Ok(target) = std::fs::read_link(entry.path()) else {
            continue;
        };
        let text = target.to_string_lossy();
        if !text.contains("/.codex/sessions/") || !text.ends_with(".jsonl") {
            continue;
        }
        let Ok(modified) = std::fs::metadata(&target).and_then(|meta| meta.modified()) else {
            continue;
        };
        if newest.as_ref().is_none_or(|(_, best)| modified > *best) {
            newest = Some((target, modified));
        }
    }
    newest.map(|(path, _)| path)
}

fn read_tail(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    file.seek(SeekFrom::Start(len.saturating_sub(TAIL_BYTES))).ok()?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn boot_time_s() -> Option<i64> {
    std::fs::read_to_string("/proc/stat")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("btime "))
        .and_then(|value| value.trim().parse().ok())
}

/// Epoch ms at which `pid` started, from `/proc/<pid>/stat` field 22.
fn process_start_ms(pid: u32, boot_s: i64, ticks: i64) -> Option<i64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let after_comm = &stat[stat.rfind(')')? + 2..];
    // Fields after comm start at field 3 (state); starttime is field 22.
    let start_ticks: i64 = after_comm.split_whitespace().nth(19)?.parse().ok()?;
    Some(boot_s * 1000 + start_ticks * 1000 / ticks)
}

fn descendants(root: u32) -> Vec<u32> {
    let mut children_of: std::collections::HashMap<u32, Vec<u32>> = Default::default();
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok())
            else {
                continue;
            };
            let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
                continue;
            };
            let Some(close) = stat.rfind(')') else {
                continue;
            };
            let ppid = stat[close + 2..]
                .split_whitespace()
                .nth(1)
                .and_then(|value| value.parse::<u32>().ok());
            if let Some(ppid) = ppid {
                children_of.entry(ppid).or_default().push(pid);
            }
        }
    }
    let mut out = Vec::new();
    let mut stack = vec![root];
    while let Some(pid) = stack.pop() {
        for child in children_of.get(&pid).cloned().unwrap_or_default() {
            out.push(child);
            stack.push(child);
        }
    }
    out
}

/// The live lifecycle of the Codex process `pid`, or None when it has no readable
/// rollout open (then the caller keeps its other signals). Only the live probe
/// test reads it; production code uses `codex_lifecycle_report`.
#[cfg(test)]
pub fn codex_lifecycle(pid: u32) -> Option<Lifecycle> {
    codex_lifecycle_report(pid).map(|(state, _)| state)
}

/// The lifecycle plus when the agent last wrote its log (epoch ms) — the agent's own
/// report time, so the app can order it against hook events and the screen.
pub fn codex_lifecycle_report(pid: u32) -> Option<(Lifecycle, i64)> {
    // The pane's agent is often the `node …/codex.js` launcher; the native Codex child
    // is the one holding the log open, so search the whole process family.
    let kids = descendants(pid);
    let rollout = std::iter::once(pid)
        .chain(kids.iter().copied())
        .filter_map(|candidate| {
            let path = newest_open_rollout(candidate)?;
            let modified = std::fs::metadata(&path).and_then(|meta| meta.modified()).ok()?;
            Some((path, modified))
        })
        .max_by_key(|(_, modified)| *modified)
        .map(|(path, _)| path)?;
    let written_ms = std::fs::metadata(&rollout)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or(0);
    let log = classify_rollout_tail(&read_tail(&rollout)?);
    let boot_s = boot_time_s()?;
    // SAFETY: sysconf is a pure libc query.
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as i64;
    let ticks = if ticks > 0 { ticks } else { 100 };
    let child_started_after = |after_ms: i64| {
        kids.iter().any(|child| {
            process_start_ms(*child, boot_s, ticks).is_some_and(|start| start >= after_ms)
        })
    };
    let state = match &log {
        LogState::PendingCall {
            name,
            started_ms,
            can_need_approval: true,
        } if name != "request_user_input" => {
            // Once a program has started under this call, the call was approved. Remember
            // that for the rest of the call: a finished command (or a code cell between
            // commands) leaves no live child, and without this the pane flipped back to
            // Waiting and into Pending approval while it was plainly working.
            let key = format!("{}#{started_ms}#{name}", rollout.display());
            let mut approved = approved_calls().lock().unwrap_or_else(|poison| poison.into_inner());
            remember_approved_call(&mut approved, key, || lifecycle_from(&log, child_started_after))
        }
        _ => lifecycle_from(&log, child_started_after),
    };
    Some((state, written_ms))
}

/// A call seen Working once (a program started under it) stays Working until the log
/// moves on to another call.
fn remember_approved_call(
    approved: &mut std::collections::HashSet<String>,
    key: String,
    settle: impl FnOnce() -> Lifecycle,
) -> Lifecycle {
    if approved.contains(&key) {
        return Lifecycle::Working;
    }
    let state = settle();
    if state == Lifecycle::Working {
        if approved.len() > 4096 {
            approved.clear();
        }
        approved.insert(key);
    }
    state
}

/// Tool calls already seen with a program running under them (see above).
fn approved_calls() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static APPROVED: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> =
        std::sync::OnceLock::new();
    APPROVED.get_or_init(Default::default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_call_seen_running_stays_running_after_its_command_exits() {
        let mut approved = std::collections::HashSet::new();
        let key = "rollout#1000#exec".to_string();
        // First poll: the approved command is running under the call.
        assert_eq!(
            remember_approved_call(&mut approved, key.clone(), || Lifecycle::Working),
            Lifecycle::Working
        );
        // Later poll: the command finished, the code cell is still going — no live
        // child. Without the memory this read as Waiting (a false approval).
        assert_eq!(
            remember_approved_call(&mut approved, key, || Lifecycle::Waiting),
            Lifecycle::Working
        );
        // A different, never-started call can still be a real approval prompt.
        assert_eq!(
            remember_approved_call(&mut approved, "rollout#2000#exec".to_string(), || {
                Lifecycle::Waiting
            }),
            Lifecycle::Waiting
        );
    }

    fn line(ts: &str, kind: &str, payload: &str) -> String {
        format!(r#"{{"timestamp":"{ts}","type":"{kind}","payload":{payload}}}"#)
    }

    #[test]
    fn parses_rollout_timestamps() {
        assert_eq!(parse_utc_timestamp_ms("1970-01-01T00:00:01.500Z"), Some(1500));
        assert_eq!(
            parse_utc_timestamp_ms("2026-09-23T08:56:01.387Z"),
            // `date -u -d 2026-09-23T08:56:01Z +%s` = 1790153761
            Some(1_790_153_761_387)
        );
    }

    #[test]
    fn finished_turn_is_idle() {
        let tail = [
            line("2026-09-23T08:00:00.000Z", "event_msg", r#"{"type":"task_started"}"#),
            line("2026-09-23T08:00:01.000Z", "response_item", r#"{"type":"custom_tool_call","call_id":"a","name":"exec"}"#),
            line("2026-09-23T08:00:02.000Z", "event_msg", r#"{"type":"task_complete"}"#),
        ]
        .join("\n");
        assert_eq!(classify_rollout_tail(&tail), LogState::Idle);
        assert_eq!(lifecycle_from(&LogState::Idle, |_| true), Lifecycle::Idle);
    }

    #[test]
    fn unanswered_command_with_no_new_child_is_waiting_for_approval() {
        // Live flow-state case 2026-09-23: exec call, no output, no command process.
        let tail = [
            line("2026-09-23T08:55:47.201Z", "response_item", r#"{"type":"custom_tool_call_output","call_id":"x"}"#),
            line("2026-09-23T08:56:01.387Z", "response_item", r#"{"type":"custom_tool_call","call_id":"y","name":"exec","input":"const r=await tools.exec_command({cmd:\"curl x\",sandbox_permissions:\"require_escalated\"});"}"#),
        ]
        .join("\n");
        let log = classify_rollout_tail(&tail);
        assert!(matches!(log, LogState::PendingCall { ref name, .. } if name == "exec"));
        assert_eq!(lifecycle_from(&log, |_| false), Lifecycle::Waiting);
        // Once approved, the command runs as a fresh child → working.
        assert_eq!(lifecycle_from(&log, |_| true), Lifecycle::Working);
    }

    #[test]
    fn answered_calls_and_thinking_are_working() {
        let tail = [
            line("2026-09-23T08:00:00.000Z", "event_msg", r#"{"type":"task_started"}"#),
            line("2026-09-23T08:00:01.000Z", "response_item", r#"{"type":"function_call","call_id":"a","name":"shell"}"#),
            line("2026-09-23T08:00:02.000Z", "response_item", r#"{"type":"function_call_output","call_id":"a"}"#),
            line("2026-09-23T08:00:03.000Z", "response_item", r#"{"type":"reasoning"}"#),
        ]
        .join("\n");
        assert_eq!(classify_rollout_tail(&tail), LogState::Thinking);
        assert_eq!(lifecycle_from(&LogState::Thinking, |_| false), Lifecycle::Working);
    }

    #[test]
    fn a_question_to_the_operator_is_always_waiting() {
        let log = LogState::PendingCall {
            name: "request_user_input".into(),
            started_ms: 0,
            can_need_approval: false,
        };
        assert_eq!(lifecycle_from(&log, |_| true), Lifecycle::Waiting);
    }

    #[test]
    fn in_process_tools_without_a_child_are_working_not_awaiting_approval() {
        // Live 2026-09-23: panes drawing "Working (7m…)" were listed as Pending approval
        // because a wait / helper-agent / MCP-only script never starts a program.
        for call in [
            r#"{"type":"function_call","call_id":"w","name":"wait","arguments":"{}"}"#,
            r#"{"type":"function_call","call_id":"w","name":"sleep","arguments":"{}"}"#,
            r#"{"type":"function_call","call_id":"w","name":"wait_agent","arguments":"{}"}"#,
            r#"{"type":"custom_tool_call","call_id":"w","name":"exec","input":"const r = await tools.mcp__lean_ctx__ctx_read({path:\"a\"});text(r);"}"#,
            r#"{"type":"custom_tool_call","call_id":"w","name":"exec","input":"const r = await tools.mcp__lean_ctx__ctx_shell({command:\"sha256sum a\"});text(r);"}"#,
        ] {
            let tail = line("2026-09-23T08:00:01.000Z", "response_item", call);
            let log = classify_rollout_tail(&tail);
            assert_eq!(lifecycle_from(&log, |_| false), Lifecycle::Working, "{call}");
        }
        // A plain shell command still reads Waiting until its program starts.
        let tail = line(
            "2026-09-23T08:00:01.000Z",
            "response_item",
            r#"{"type":"function_call","call_id":"s","name":"exec_command","arguments":"{\"cmd\":\"ls\"}"}"#,
        );
        assert_eq!(lifecycle_from(&classify_rollout_tail(&tail), |_| false), Lifecycle::Waiting);
    }

    /// Live probe: `cargo test --lib live_codex_lifecycles -- --ignored --nocapture`
    /// prints the lifecycle of every Codex process on this machine.
    #[test]
    #[ignore]
    fn live_codex_lifecycles() {
        for entry in std::fs::read_dir("/proc").unwrap().flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|name| name.parse::<u32>().ok()) else {
                continue;
            };
            let comm = std::fs::read_to_string(format!("/proc/{pid}/comm")).unwrap_or_default();
            if comm.trim() != "codex" {
                continue;
            }
            let cwd = std::fs::read_link(format!("/proc/{pid}/cwd")).unwrap_or_default();
            // The app asks with the pane's top agent, which is often the node launcher.
            let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
            let launcher: u32 = stat
                .rfind(')')
                .and_then(|close| stat[close + 2..].split_whitespace().nth(1)?.parse().ok())
                .unwrap_or(pid);
            println!(
                "{pid} self={:?} via-launcher={:?} {}",
                codex_lifecycle(pid),
                codex_lifecycle(launcher),
                cwd.display()
            );
        }
    }

    #[test]
    fn a_cut_first_line_is_ignored() {
        let tail = format!(
            "partial\":\"garbage}}\n{}",
            line("2026-09-23T08:00:00.000Z", "event_msg", r#"{"type":"turn_aborted"}"#)
        );
        assert_eq!(classify_rollout_tail(&tail), LogState::Idle);
    }
}
