//! User-owned configuration for machine-specific paths.
//!
//! Nothing here has a built-in default that points at one person's machine: an
//! unconfigured install simply reports the feature as unavailable. Resolution
//! order is environment variable, then the config file, then nothing.

use serde::Deserialize;
use std::path::PathBuf;

const CONFIG_RELATIVE_PATH: &str = "termfleet/config.json";

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UserConfig {
    /// Directories scanned for project boards. Empty means "not configured".
    pub project_roots: Vec<String>,
    /// Root of an agent-ops style shared queue checkout, if the operator has one.
    pub agent_ops_root: Option<String>,
}

pub fn config_path() -> Option<PathBuf> {
    if let Some(explicit) = std::env::var_os("TERMFLEET_CONFIG_FILE") {
        let explicit = PathBuf::from(explicit);
        if !explicit.as_os_str().is_empty() {
            return Some(explicit);
        }
    }
    if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME") {
        let xdg = PathBuf::from(xdg);
        if !xdg.as_os_str().is_empty() {
            return Some(xdg.join(CONFIG_RELATIVE_PATH));
        }
    }
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join(".config").join(CONFIG_RELATIVE_PATH))
}

/// Read the config file. A missing or unreadable file is not an error: it means
/// the operator has not configured anything yet.
pub fn load() -> UserConfig {
    let Some(path) = config_path() else {
        return UserConfig::default();
    };
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return UserConfig::default();
    };
    serde_json::from_str(&raw).unwrap_or_default()
}

fn split_path_list(value: &str) -> Vec<String> {
    value
        .split(':')
        .map(|entry| entry.trim())
        .filter(|entry| !entry.is_empty())
        .map(|entry| entry.to_string())
        .collect()
}

fn env_value(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.to_string())
}

/// Directories to scan for project boards, environment first.
pub fn project_roots(config: &UserConfig) -> Vec<String> {
    if let Some(value) = env_value("TERMFLEET_PROJECT_ROOTS") {
        return split_path_list(&value);
    }
    config
        .project_roots
        .iter()
        .map(|root| root.trim().to_string())
        .filter(|root| !root.is_empty())
        .collect()
}

/// Root of the shared agent queue, or `None` when the operator has not set one.
pub fn agent_ops_root(config: &UserConfig) -> Option<String> {
    env_value("TERMFLEET_AGENT_OPS_ROOT").or_else(|| {
        config
            .agent_ops_root
            .as_ref()
            .map(|root| root.trim().to_string())
            .filter(|root| !root.is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unconfigured_install_has_no_project_roots() {
        let config = UserConfig::default();
        assert!(project_roots(&config).is_empty());
        assert_eq!(agent_ops_root(&config), None);
    }

    #[test]
    fn config_file_supplies_roots_when_no_environment_override() {
        let config: UserConfig = serde_json::from_str(
            r#"{ "projectRoots": ["/srv/work", " "], "agentOpsRoot": "/srv/agent-ops" }"#,
        )
        .expect("config parses");
        assert_eq!(project_roots(&config), vec!["/srv/work".to_string()]);
        assert_eq!(agent_ops_root(&config), Some("/srv/agent-ops".to_string()));
    }

    #[test]
    fn blank_values_are_treated_as_unset() {
        let config: UserConfig =
            serde_json::from_str(r#"{ "projectRoots": [], "agentOpsRoot": "   " }"#)
                .expect("config parses");
        assert_eq!(agent_ops_root(&config), None);
    }
}
