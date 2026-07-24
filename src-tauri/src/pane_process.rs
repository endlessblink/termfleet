//! Which agent is actually running in a pane, discovered from the process table.
//!
//! Every PTY termfleet spawns carries `TERMFLEET_PANE_ID` in its environment
//! (`pty.rs`), and every process started inside that terminal inherits it. So the
//! pane a process belongs to can be read straight off the process, without asking
//! the daemon (no IPC protocol change, so no daemon replacement and no killed
//! terminals) and without the agent cooperating.
//!
//! That matters because an operator simply TYPES `opencode` in a shell. Nothing
//! about that pane records which program is running — not the launch command
//! (`/bin/bash`), not a status sidecar (the vendor plugin may not be installed, and
//! its first write lands only after the agent starts). Reading the process table is
//! the one signal that is true immediately, for hand-started agents, with zero setup.
//!
//! Linux-only (procfs); other platforms report nothing, which callers treat as
//! "unknown" and fall back to their previous behaviour.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Programs we can recognise, mapped to the provider id the app uses.
const KNOWN_AGENTS: &[(&str, &str)] = &[
    ("opencode", "opencode"),
    ("claude", "claude"),
    ("codex", "codex"),
];

/// A full process-table scan is cheap but not free, and several panes ask at once
/// on startup, so one scan serves all of them for a short window.
const SCAN_TTL: Duration = Duration::from_millis(1500);

struct ScanCache {
    at: Instant,
    entries: Vec<(String, String)>,
}

static CACHE: Mutex<Option<ScanCache>> = Mutex::new(None);

/// Map a process name to a provider id. Matches the executable name, so a wrapper
/// path (`~/.opencode/bin/opencode`) and a bare command both resolve.
pub fn provider_for_process_name(name: &str) -> Option<&'static str> {
    let file = name.rsplit('/').next().unwrap_or(name).trim();
    // Strip a version/extension suffix some installers add (opencode-1.2, claude.js).
    let base = file
        .split(['.', ' '])
        .next()
        .unwrap_or(file)
        .trim_end_matches(|ch: char| ch.is_ascii_digit() || ch == '-');
    KNOWN_AGENTS
        .iter()
        .find(|(process, _)| *process == file || *process == base)
        .map(|(_, provider)| *provider)
}

#[cfg(target_os = "linux")]
fn scan_processes() -> Vec<(String, String)> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name.to_str().filter(|value| {
            !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit())
        }) else {
            continue;
        };
        // Read the process name FIRST: it is one tiny file, and only a handful of
        // processes are agents, so most candidates are rejected before the (larger)
        // environment read.
        let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) else {
            continue;
        };
        let Some(provider) = provider_for_process_name(comm.trim()) else {
            continue;
        };
        let Ok(environ) = std::fs::read(format!("/proc/{pid}/environ")) else {
            continue;
        };
        for variable in environ.split(|byte| *byte == 0) {
            let Ok(text) = std::str::from_utf8(variable) else {
                continue;
            };
            if let Some(pane) = text.strip_prefix("TERMFLEET_PANE_ID=") {
                let pane = pane.trim();
                if !pane.is_empty() {
                    found.push((pane.to_string(), provider.to_string()));
                }
                break;
            }
        }
    }
    found
}

#[cfg(not(target_os = "linux"))]
fn scan_processes() -> Vec<(String, String)> {
    Vec::new()
}

fn scan_cached() -> Vec<(String, String)> {
    let mut cache = CACHE.lock().unwrap_or_else(|error| error.into_inner());
    if let Some(existing) = cache.as_ref() {
        if existing.at.elapsed() < SCAN_TTL {
            return existing.entries.clone();
        }
    }
    let entries = scan_processes();
    *cache = Some(ScanCache {
        at: Instant::now(),
        entries: entries.clone(),
    });
    entries
}

/// The agent provider currently running in `pane_id`, or None when the pane runs a
/// plain shell (or the platform has no process table we can read).
pub fn pane_agent_provider(pane_id: &str) -> Option<String> {
    if pane_id.trim().is_empty() {
        return None;
    }
    scan_cached()
        .into_iter()
        .find(|(pane, _)| pane == pane_id)
        .map(|(_, provider)| provider)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_agent_process_names_including_wrapper_paths() {
        assert_eq!(provider_for_process_name("opencode"), Some("opencode"));
        assert_eq!(
            provider_for_process_name("/home/me/.opencode/bin/opencode"),
            Some("opencode")
        );
        assert_eq!(provider_for_process_name("claude"), Some("claude"));
        assert_eq!(provider_for_process_name("codex"), Some("codex"));
    }

    #[test]
    fn ignores_shells_and_unrelated_processes() {
        assert_eq!(provider_for_process_name("bash"), None);
        assert_eq!(provider_for_process_name("zellij"), None);
        assert_eq!(provider_for_process_name(""), None);
        // A pane id that no process carries must not match anything.
        assert_eq!(pane_agent_provider("terminal-does-not-exist"), None);
        assert_eq!(pane_agent_provider("   "), None);
    }

    #[test]
    fn finds_the_agent_running_in_this_very_pane_when_there_is_one() {
        // Self-check: when the suite itself runs inside a termfleet agent pane, the
        // scan must find that agent. Skipped otherwise so CI stays deterministic.
        let Ok(pane) = std::env::var("TERMFLEET_PANE_ID") else {
            return;
        };
        if pane.trim().is_empty() {
            return;
        }
        let found = pane_agent_provider(&pane);
        assert!(
            found.is_some(),
            "expected to detect the agent running in pane {pane}"
        );
    }
}
