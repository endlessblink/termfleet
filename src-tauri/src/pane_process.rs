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

use serde::Serialize;

/// Programs we can recognise, mapped to the provider id the app uses.
const KNOWN_AGENTS: &[(&str, &str)] = &[
    ("opencode", "opencode"),
    ("claude", "claude"),
    ("codex", "codex"),
];

/// A full process-table scan is cheap but not free, and several panes ask at once
/// on startup, so one scan serves all of them for a short window.
const SCAN_TTL: Duration = Duration::from_millis(1500);
const PROCESS_TREE_SCAN_TTL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneAgentRuntimeInfo {
    pub provider: String,
    pub provider_session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneAgentRuntimeOwner {
    pub provider: String,
    pub provider_session_id: String,
    pub provider_pid: u32,
}

/// The provider process rooted below one daemon-owned PTY.  Unlike
/// `PaneAgentRuntimeOwner`, this deliberately does not infer a conversation id
/// from the provider argv: long-running agents are allowed to rewrite argv
/// after startup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneAgentProviderOwner {
    pub provider: String,
    pub provider_pid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct PaneAgentProcess {
    pid: u32,
    ppid: u32,
    pane_id: String,
    provider: String,
    argv: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ProcessTableEntry {
    pid: u32,
    ppid: u32,
    provider: Option<String>,
    argv: Vec<String>,
}

struct ScanCache {
    at: Instant,
    entries: Vec<PaneAgentProcess>,
}

static CACHE: Mutex<Option<ScanCache>> = Mutex::new(None);

struct ProcessTableCache {
    at: Instant,
    entries: Vec<ProcessTableEntry>,
}

static PROCESS_TABLE_CACHE: Mutex<Option<ProcessTableCache>> = Mutex::new(None);

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

fn extract_pane_id_from_environ(environ: &[u8]) -> Option<String> {
    for variable in environ.split(|byte| *byte == 0) {
        let Ok(text) = std::str::from_utf8(variable) else {
            continue;
        };
        if let Some(pane) = text.strip_prefix("TERMFLEET_PANE_ID=") {
            let pane = pane.trim();
            if !pane.is_empty() {
                return Some(pane.to_string());
            }
            return None;
        }
    }
    None
}

fn parse_proc_stat_ppid(stat: &str) -> Option<u32> {
    let rest = stat.rsplit_once(") ")?.1;
    rest.split_whitespace().nth(1)?.parse().ok()
}

fn parse_proc_cmdline(raw: &[u8]) -> Vec<String> {
    raw.split(|byte| *byte == 0)
        .filter_map(|part| {
            (!part.is_empty()).then(|| String::from_utf8_lossy(part).trim().to_string())
        })
        .filter(|part| !part.is_empty())
        .collect()
}

fn provider_for_command_line(argv: &[String]) -> Option<&'static str> {
    let executable = argv.first()?;
    provider_for_process_name(executable).or_else(|| {
        let launcher = executable.rsplit('/').next().unwrap_or(executable);
        matches!(launcher, "node" | "nodejs")
            .then(|| {
                argv.get(1)
                    .and_then(|value| provider_for_process_name(value))
            })
            .flatten()
    })
}

fn extract_resume_session_id(argv: &[String]) -> Option<String> {
    argv.windows(2).find_map(|pair| {
        let marker = pair[0].as_str();
        let candidate = pair[1].as_str();
        let uuid = candidate.len() == 36
            && candidate.chars().enumerate().all(|(index, ch)| {
                if [8, 13, 18, 23].contains(&index) {
                    ch == '-'
                } else {
                    ch.is_ascii_hexdigit()
                }
            });
        let opencode_session = candidate.strip_prefix("ses_").is_some_and(|suffix| {
            !suffix.is_empty()
                && candidate.len() <= 128
                && suffix.chars().all(|ch| ch.is_ascii_alphanumeric())
        });
        if ((marker == "resume" || marker == "--resume") && uuid)
            || (marker == "--session" && opencode_session)
        {
            Some(candidate.to_string())
        } else {
            None
        }
    })
}

fn top_level_pane_agent<'a>(
    pane_id: &str,
    entries: &'a [PaneAgentProcess],
) -> Option<&'a PaneAgentProcess> {
    let matching: Vec<&PaneAgentProcess> = entries
        .iter()
        .filter(|entry| entry.pane_id == pane_id)
        .collect();
    if matching.is_empty() {
        return None;
    }

    let by_pid: std::collections::HashMap<u32, &PaneAgentProcess> =
        matching.iter().map(|entry| (entry.pid, *entry)).collect();
    let mut roots = matching
        .into_iter()
        .filter(|entry| {
            let mut parent = entry.ppid;
            while let Some(ancestor) = by_pid.get(&parent) {
                if ancestor.pane_id == pane_id {
                    return false;
                }
                parent = ancestor.ppid;
            }
            true
        })
        .collect::<Vec<_>>();
    if roots.len() != 1 {
        return None;
    }
    roots.pop()
}

fn is_descendant_of(
    pid: u32,
    root_pid: u32,
    by_pid: &std::collections::HashMap<u32, &ProcessTableEntry>,
) -> bool {
    let mut current = pid;
    let mut remaining = by_pid.len() + 1;
    while remaining > 0 {
        if current == root_pid {
            return true;
        }
        let Some(entry) = by_pid.get(&current) else {
            return false;
        };
        if entry.ppid == current {
            return false;
        }
        current = entry.ppid;
        remaining -= 1;
    }
    false
}

fn top_level_agent_for_process_tree(
    root_pid: u32,
    entries: &[ProcessTableEntry],
) -> Option<&ProcessTableEntry> {
    let by_pid: std::collections::HashMap<u32, &ProcessTableEntry> =
        entries.iter().map(|entry| (entry.pid, entry)).collect();
    let descendants: Vec<&ProcessTableEntry> = entries
        .iter()
        .filter(|entry| entry.provider.is_some() && is_descendant_of(entry.pid, root_pid, &by_pid))
        .collect();
    let descendant_pids: std::collections::HashSet<u32> =
        descendants.iter().map(|entry| entry.pid).collect();
    let mut roots = descendants
        .into_iter()
        .filter(|entry| {
            let mut parent = entry.ppid;
            let mut remaining = by_pid.len() + 1;
            while remaining > 0 {
                // A daemon session can exec the provider launcher directly, so
                // `root_pid` itself may be the first provider process. Its
                // provider child is then nested, not a competing top-level
                // writer. Stop only after applying that ancestor check.
                if parent == root_pid {
                    return entry.pid == root_pid || !descendant_pids.contains(&parent);
                }
                if descendant_pids.contains(&parent) {
                    return false;
                }
                let Some(ancestor) = by_pid.get(&parent) else {
                    break;
                };
                if ancestor.ppid == parent {
                    break;
                }
                parent = ancestor.ppid;
                remaining -= 1;
            }
            true
        })
        .collect::<Vec<_>>();
    if roots.len() != 1 {
        return None;
    }
    roots.pop()
}

fn runtime_info_for_process_tree(
    root_pid: u32,
    entries: &[ProcessTableEntry],
) -> Option<PaneAgentRuntimeInfo> {
    let root = top_level_agent_for_process_tree(root_pid, entries)?;
    Some(PaneAgentRuntimeInfo {
        provider: root.provider.clone()?,
        provider_session_id: extract_resume_session_id(&root.argv)?,
    })
}

fn runtime_owner_for_process_tree(
    root_pid: u32,
    entries: &[ProcessTableEntry],
) -> Option<PaneAgentRuntimeOwner> {
    let root = top_level_agent_for_process_tree(root_pid, entries)?;
    Some(PaneAgentRuntimeOwner {
        provider: root.provider.clone()?,
        provider_session_id: extract_resume_session_id(&root.argv)?,
        provider_pid: root.pid,
    })
}

fn provider_owner_for_process_tree(
    root_pid: u32,
    entries: &[ProcessTableEntry],
) -> Option<PaneAgentProviderOwner> {
    let root = top_level_agent_for_process_tree(root_pid, entries)?;
    Some(PaneAgentProviderOwner {
        provider: root.provider.clone()?,
        provider_pid: root.pid,
    })
}

#[cfg(target_os = "linux")]
fn scan_process_table() -> Vec<ProcessTableEntry> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid_text) = name
            .to_str()
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid_text}/stat")) else {
            continue;
        };
        let Some(ppid) = parse_proc_stat_ppid(&stat) else {
            continue;
        };
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid_text}/cmdline")) else {
            continue;
        };
        let argv = parse_proc_cmdline(&cmdline);
        found.push(ProcessTableEntry {
            pid: pid_text.parse().unwrap_or_default(),
            ppid,
            provider: provider_for_command_line(&argv).map(str::to_string),
            argv,
        });
    }
    found
}

fn scan_process_table_cached() -> Vec<ProcessTableEntry> {
    let mut cache = PROCESS_TABLE_CACHE
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(existing) = cache.as_ref() {
        if existing.at.elapsed() < PROCESS_TREE_SCAN_TTL {
            return existing.entries.clone();
        }
    }
    let entries = scan_process_table();
    *cache = Some(ProcessTableCache {
        at: Instant::now(),
        entries: entries.clone(),
    });
    entries
}

#[cfg(not(target_os = "linux"))]
fn scan_process_table() -> Vec<ProcessTableEntry> {
    Vec::new()
}

pub fn agent_runtime_info_for_process_tree(root_pid: u32) -> Option<PaneAgentRuntimeInfo> {
    (root_pid > 1)
        .then(|| runtime_info_for_process_tree(root_pid, &scan_process_table_cached()))
        .flatten()
}

pub fn agent_runtime_owner_for_process_tree(root_pid: u32) -> Option<PaneAgentRuntimeOwner> {
    (root_pid > 1)
        .then(|| runtime_owner_for_process_tree(root_pid, &scan_process_table_cached()))
        .flatten()
}

pub fn agent_provider_owner_for_process_tree(root_pid: u32) -> Option<PaneAgentProviderOwner> {
    (root_pid > 1)
        .then(|| provider_owner_for_process_tree(root_pid, &scan_process_table_cached()))
        .flatten()
}

pub fn agent_provider_for_process_tree(root_pid: u32) -> Option<String> {
    (root_pid > 1)
        .then(|| {
            top_level_agent_for_process_tree(root_pid, &scan_process_table_cached())
                .and_then(|entry| entry.provider.clone())
        })
        .flatten()
}

#[cfg(target_os = "linux")]
pub fn process_matches_agent_provider(pid: u32, expected_provider: &str) -> bool {
    std::fs::read(format!("/proc/{pid}/cmdline"))
        .ok()
        .map(|raw| parse_proc_cmdline(&raw))
        .and_then(|argv| provider_for_command_line(&argv))
        == Some(expected_provider)
}

#[cfg(not(target_os = "linux"))]
pub fn process_matches_agent_provider(_pid: u32, _expected_provider: &str) -> bool {
    false
}

#[cfg(target_os = "linux")]
pub fn process_has_parent(pid: u32, expected_parent: u32) -> bool {
    std::fs::read_to_string(format!("/proc/{pid}/stat"))
        .ok()
        .and_then(|stat| parse_proc_stat_ppid(&stat))
        == Some(expected_parent)
}

#[cfg(not(target_os = "linux"))]
pub fn process_has_parent(_pid: u32, _expected_parent: u32) -> bool {
    false
}

#[cfg(target_os = "linux")]
fn scan_processes() -> Vec<PaneAgentProcess> {
    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return found;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(pid) = name
            .to_str()
            .filter(|value| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            continue;
        };
        let Some(ppid) = parse_proc_stat_ppid(&stat) else {
            continue;
        };
        let Ok(cmdline) = std::fs::read(format!("/proc/{pid}/cmdline")) else {
            continue;
        };
        let argv = parse_proc_cmdline(&cmdline);
        let Some(provider) = provider_for_command_line(&argv) else {
            continue;
        };
        let Ok(environ) = std::fs::read(format!("/proc/{pid}/environ")) else {
            continue;
        };
        let Some(pane_id) = extract_pane_id_from_environ(&environ) else {
            continue;
        };
        found.push(PaneAgentProcess {
            pid: pid.parse().unwrap_or_default(),
            ppid,
            pane_id,
            provider: provider.to_string(),
            argv,
        });
    }
    found
}

#[cfg(not(target_os = "linux"))]
fn scan_processes() -> Vec<PaneAgentProcess> {
    Vec::new()
}

fn scan_cached() -> Vec<PaneAgentProcess> {
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
    top_level_pane_agent(pane_id, &scan_cached()).map(|entry| entry.provider.clone())
}

/// The exact top-level agent runtime identity currently running in `pane_id`, or
/// None when the pane runs a plain shell, the root agent is ambiguous, or its
/// command line does not carry an exact resumable conversation id.
pub fn pane_agent_runtime_info(pane_id: &str) -> Option<PaneAgentRuntimeInfo> {
    if pane_id.trim().is_empty() {
        return None;
    }
    // Recovery confirmation must not reuse the provider badge cache: a process
    // can exit during that 1.5s window and make an injected resume look alive.
    let entries = scan_processes();
    let entry = top_level_pane_agent(pane_id, &entries)?;
    Some(PaneAgentRuntimeInfo {
        provider: entry.provider.clone(),
        provider_session_id: extract_resume_session_id(&entry.argv)?,
    })
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
        assert_eq!(
            provider_for_command_line(&[
                "node".to_string(),
                "/home/me/.npm-global/bin/codex".to_string(),
                "resume".to_string(),
                "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
            ]),
            Some("codex")
        );
    }

    #[test]
    fn exact_runtime_uses_the_daemon_session_process_tree_without_a_pane_env_tag() {
        let entries = vec![
            ProcessTableEntry {
                pid: 100,
                ppid: 50,
                provider: None,
                argv: vec!["bash".to_string()],
            },
            ProcessTableEntry {
                pid: 101,
                ppid: 100,
                provider: Some("codex".to_string()),
                argv: vec![
                    "node".to_string(),
                    "/home/me/.npm-global/bin/codex".to_string(),
                    "resume".to_string(),
                    "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                ],
            },
            ProcessTableEntry {
                pid: 102,
                ppid: 101,
                provider: Some("codex".to_string()),
                argv: vec![
                    "/vendor/bin/codex".to_string(),
                    "resume".to_string(),
                    "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                ],
            },
        ];

        assert_eq!(
            runtime_info_for_process_tree(100, &entries),
            Some(PaneAgentRuntimeInfo {
                provider: "codex".to_string(),
                provider_session_id: "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
            })
        );
        assert_eq!(
            runtime_owner_for_process_tree(100, &entries),
            Some(PaneAgentRuntimeOwner {
                provider: "codex".to_string(),
                provider_session_id: "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                provider_pid: 101,
            })
        );
    }

    #[test]
    fn exact_runtime_keeps_a_provider_daemon_root_over_its_nested_provider_child() {
        let entries = vec![
            ProcessTableEntry {
                pid: 100,
                ppid: 50,
                provider: Some("codex".to_string()),
                argv: vec![
                    "node".to_string(),
                    "/home/me/.npm-global/bin/codex".to_string(),
                    "resume".to_string(),
                    "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                ],
            },
            ProcessTableEntry {
                pid: 101,
                ppid: 100,
                provider: Some("codex".to_string()),
                argv: vec![
                    "/vendor/bin/codex".to_string(),
                    "resume".to_string(),
                    "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                ],
            },
        ];

        assert_eq!(
            runtime_owner_for_process_tree(100, &entries),
            Some(PaneAgentRuntimeOwner {
                provider: "codex".to_string(),
                provider_session_id: "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                provider_pid: 100,
            })
        );
    }

    #[test]
    fn daemon_process_tree_fails_closed_with_multiple_agent_roots() {
        let entries = vec![
            ProcessTableEntry {
                pid: 100,
                ppid: 50,
                provider: None,
                argv: vec!["bash".to_string()],
            },
            ProcessTableEntry {
                pid: 101,
                ppid: 100,
                provider: Some("codex".to_string()),
                argv: vec![
                    "codex".to_string(),
                    "resume".to_string(),
                    "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
                ],
            },
            ProcessTableEntry {
                pid: 102,
                ppid: 100,
                provider: Some("claude".to_string()),
                argv: vec![
                    "claude".to_string(),
                    "--resume".to_string(),
                    "abcdef12-1111-2222-3333-444444444444".to_string(),
                ],
            },
        ];

        assert_eq!(runtime_info_for_process_tree(100, &entries), None);
    }

    #[test]
    fn parses_resume_session_ids_from_exact_agent_argv() {
        let codex = vec![
            "codex".to_string(),
            "resume".to_string(),
            "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
        ];
        let claude = vec![
            "/opt/bin/claude".to_string(),
            "--resume".to_string(),
            "abcdef12-1111-2222-3333-444444444444".to_string(),
        ];
        let opencode = vec![
            "opencode".to_string(),
            "--session".to_string(),
            "ses_4b6273738ffer1UqWIk6zevIQA".to_string(),
        ];
        let invalid = vec![
            "claude".to_string(),
            "--resume".to_string(),
            "not-a-session".to_string(),
        ];
        assert_eq!(
            extract_resume_session_id(&codex).as_deref(),
            Some("019fe29c-6f6b-7d23-98f6-05c99d8970ce")
        );
        assert_eq!(
            extract_resume_session_id(&claude).as_deref(),
            Some("abcdef12-1111-2222-3333-444444444444")
        );
        assert_eq!(
            extract_resume_session_id(&opencode).as_deref(),
            Some("ses_4b6273738ffer1UqWIk6zevIQA")
        );
        assert_eq!(extract_resume_session_id(&invalid), None);
    }

    #[test]
    fn exact_runtime_uses_the_top_level_agent_not_a_nested_descendant() {
        let pane_id = "terminal-pane-1";
        let top_level = PaneAgentProcess {
            pid: 100,
            ppid: 50,
            pane_id: pane_id.to_string(),
            provider: "codex".to_string(),
            argv: vec![
                "codex".to_string(),
                "resume".to_string(),
                "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
            ],
        };
        let nested = PaneAgentProcess {
            pid: 101,
            ppid: 100,
            pane_id: pane_id.to_string(),
            provider: "claude".to_string(),
            argv: vec![
                "claude".to_string(),
                "--resume".to_string(),
                "abcdef12-1111-2222-3333-444444444444".to_string(),
            ],
        };
        let entries = [top_level.clone(), nested];
        let info = top_level_pane_agent(pane_id, &entries).unwrap();
        assert_eq!(info.pid, top_level.pid);
        assert_eq!(
            PaneAgentRuntimeInfo {
                provider: info.provider.clone(),
                provider_session_id: extract_resume_session_id(&info.argv).unwrap(),
            },
            PaneAgentRuntimeInfo {
                provider: "codex".to_string(),
                provider_session_id: "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
            }
        );
    }

    #[test]
    fn exact_runtime_fails_closed_when_multiple_top_level_agents_share_a_pane() {
        let pane_id = "terminal-pane-1";
        let one = PaneAgentProcess {
            pid: 100,
            ppid: 50,
            pane_id: pane_id.to_string(),
            provider: "codex".to_string(),
            argv: vec![
                "codex".to_string(),
                "resume".to_string(),
                "019fe29c-6f6b-7d23-98f6-05c99d8970ce".to_string(),
            ],
        };
        let two = PaneAgentProcess {
            pid: 200,
            ppid: 50,
            pane_id: pane_id.to_string(),
            provider: "claude".to_string(),
            argv: vec![
                "claude".to_string(),
                "--resume".to_string(),
                "abcdef12-1111-2222-3333-444444444444".to_string(),
            ],
        };
        assert!(top_level_pane_agent(pane_id, &[one, two]).is_none());
    }

    #[test]
    fn ignores_shells_and_unrelated_processes() {
        assert_eq!(provider_for_process_name("bash"), None);
        assert_eq!(provider_for_process_name("zellij"), None);
        assert_eq!(provider_for_process_name(""), None);
        assert_eq!(provider_for_command_line(&[]), None);
        // A pane id that no process carries must not match anything.
        assert_eq!(pane_agent_provider("terminal-does-not-exist"), None);
        assert_eq!(pane_agent_runtime_info("terminal-does-not-exist"), None);
        assert_eq!(pane_agent_provider("   "), None);
        assert_eq!(pane_agent_runtime_info("   "), None);
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
