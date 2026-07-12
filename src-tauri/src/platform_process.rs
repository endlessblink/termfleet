use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

/// Environment the daemon must carry across the systemd boundary. Under
/// `systemd-run` it would otherwise inherit the user manager's environment, and a
/// missing `XDG_DATA_HOME` silently relocates every session checkpoint.
const DAEMON_ENV_PASSTHROUGH: &[&str] = &[
    "PATH",
    "HOME",
    "SHELL",
    "LANG",
    "TERM",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_RUNTIME_DIR",
];

pub fn systemd_run_available() -> bool {
    cfg!(target_os = "linux")
        && std::env::var_os("XDG_RUNTIME_DIR").is_some()
        && which_systemd_run().is_some()
}

fn which_systemd_run() -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join("systemd-run"))
        .find(|candidate| candidate.is_file())
        .map(|candidate| candidate.to_string_lossy().into_owned())
}

/// Argv that launches the daemon so it OUTLIVES the app.
///
/// `process_group(0)` alone is not enough. When the app itself runs inside a
/// systemd unit (the desktop launcher uses `systemd-run --user`), the daemon
/// inherits the app's **cgroup**, and the unit's default `KillMode=control-group`
/// kills the whole cgroup on stop — daemon, shells, and running agents with it.
/// Process groups govern signal delivery; cgroup membership is a separate axis.
///
/// So on systemd we hand the daemon to the user manager as its own transient
/// unit. Its PTY children inherit that unit's cgroup, not the app's. Elsewhere we
/// spawn the binary directly, exactly as before.
pub fn daemon_spawn_argv(exe: &str, arg: &str, unit_suffix: &str) -> Vec<String> {
    if !systemd_run_available() {
        return vec![exe.to_string(), arg.to_string()];
    }
    let mut argv = vec![
        "systemd-run".to_string(),
        "--user".to_string(),
        // Reap the unit when the daemon exits, so the next spawn cannot collide
        // with a leftover `failed` unit of the same name.
        "--collect".to_string(),
        format!("--unit=termfleet-daemon-{unit_suffix}"),
        "--property=KillMode=mixed".to_string(),
        "--quiet".to_string(),
    ];
    for key in DAEMON_ENV_PASSTHROUGH {
        if let Some(value) = std::env::var_os(key) {
            argv.push(format!("--setenv={key}={}", value.to_string_lossy()));
        }
    }
    for (key, value) in std::env::vars() {
        if key.starts_with("TERMFLEET_") || key.starts_with("TERMINAL_WORKSPACE_") {
            argv.push(format!("--setenv={key}={value}"));
        }
    }
    argv.push(exe.to_string());
    argv.push(arg.to_string());
    argv
}

pub fn spawn_detached_current_binary(arg: &str) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let suffix = std::process::id().to_string();
    let argv = daemon_spawn_argv(&current_exe.to_string_lossy(), arg, &suffix);
    let mut command = Command::new(&argv[0]);
    command
        .args(&argv[1..])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(unix)]
    {
        // The daemon owns PTYs independently of the UI lifecycle, so it must
        // outlive the app process. Put it in its own process group (detached from
        // the app's controlling terminal) so a group-directed SIGHUP/SIGINT — e.g.
        // closing the terminal that launched the app, or Ctrl-C'ing dev — does not
        // also tear down the daemon and every detached PTY (zellij/ssh/etc.) with
        // it. Without this the daemon shares the app's group and dies alongside it.
        // This guards the signal path; `daemon_spawn_argv` guards the cgroup path.
        command.process_group(0);
    }

    let spawned = command.spawn();
    match spawned {
        Ok(_) => Ok(()),
        // A systemd that refuses the transient unit must not cost the user their
        // daemon: fall back to a plain detached spawn.
        Err(error) if argv[0] == "systemd-run" => {
            spawn_detached_binary_directly(arg).map_err(|fallback| {
                format!("systemd-run failed ({error}); direct spawn failed ({fallback})")
            })
        }
        Err(error) => Err(error.to_string()),
    }
}

fn spawn_detached_binary_directly(arg: &str) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = Command::new(current_exe);
    command
        .arg(arg)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        command.process_group(0);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// The cgroup this process lives in, read from `/proc/self/cgroup`.
///
/// This is how we tell whether the daemon got its OWN systemd unit or inherited
/// the app's: a daemon in `…/termfleet-daemon-<pid>.service` survives the app
/// unit's teardown; one still in `…/termfleet-desktop-<id>.service` dies with the
/// app and takes the user's shells/agents with it. `None` on non-Linux or when
/// the file can't be read.
pub fn current_cgroup() -> Option<String> {
    let contents = std::fs::read_to_string("/proc/self/cgroup").ok()?;
    // cgroup v2 (unified): the single `0::<path>` line is authoritative.
    for line in contents.lines() {
        if let Some(path) = line.strip_prefix("0::") {
            return Some(path.trim().to_string());
        }
    }
    // cgroup v1 fallback: take the path from the first controller line.
    contents
        .lines()
        .next()
        .and_then(|line| line.rsplit_once(':'))
        .map(|(_, path)| path.trim().to_string())
}

/// Whether `cgroup` is the daemon's own transient unit (safe) rather than the
/// app's desktop unit (its PTYs die on the next app relaunch). An unknown shape
/// (e.g. the hand-made `termfleet-rescue` unit, or a plain detached spawn) is
/// reported verbatim by the caller rather than judged here.
pub fn cgroup_is_own_daemon_unit(cgroup: &str) -> bool {
    cgroup.contains("/termfleet-daemon-")
}

/// Whether `cgroup` is the app's desktop unit — the failure mode this whole fix
/// exists to prevent.
pub fn cgroup_is_app_unit(cgroup: &str) -> bool {
    cgroup.contains("/termfleet-desktop-")
}

pub fn terminate_process(pid: u32) {
    let _ = Command::new("kill").arg(pid.to_string()).status();
}

pub fn force_terminate_process(pid: u32) {
    let _ = Command::new("kill")
        .arg("-KILL")
        .arg(pid.to_string())
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn daemon_argv_targets_the_binary_and_daemon_flag() {
        let argv = daemon_spawn_argv("/opt/tw/terminal-workspace", "--terminal-workspace-daemon", "42");
        assert_eq!(argv[argv.len() - 2], "/opt/tw/terminal-workspace");
        assert_eq!(argv[argv.len() - 1], "--terminal-workspace-daemon");
    }

    #[test]
    fn daemon_argv_uses_a_transient_unit_when_systemd_is_available() {
        let argv = daemon_spawn_argv("/opt/tw/terminal-workspace", "--terminal-workspace-daemon", "42");
        if systemd_run_available() {
            // The daemon must land in its OWN cgroup, not the app's unit, or the
            // app's KillMode=control-group takes the user's shells down with it.
            assert_eq!(argv[0], "systemd-run");
            assert!(argv.iter().any(|a| a == "--user"));
            assert!(argv.iter().any(|a| a == "--unit=termfleet-daemon-42"));
        } else {
            assert_eq!(argv, vec!["/opt/tw/terminal-workspace", "--terminal-workspace-daemon"]);
        }
    }

    #[test]
    fn cgroup_classifier_distinguishes_own_unit_from_app_unit() {
        let own = "/user.slice/user-1000.slice/user@1000.service/app.slice/termfleet-daemon-1234.service";
        let app = "/user.slice/user-1000.slice/user@1000.service/app.slice/termfleet-desktop-9876.service";
        assert!(cgroup_is_own_daemon_unit(own));
        assert!(!cgroup_is_app_unit(own));
        assert!(cgroup_is_app_unit(app));
        assert!(!cgroup_is_own_daemon_unit(app));
        // The hand-made rescue unit is neither — reported verbatim, not judged.
        let rescue = "/user.slice/user-1000.slice/user@1000.service/app.slice/termfleet-rescue.service";
        assert!(!cgroup_is_own_daemon_unit(rescue));
        assert!(!cgroup_is_app_unit(rescue));
    }

    #[test]
    fn daemon_argv_forwards_the_data_dir_so_scrollback_does_not_move() {
        if !systemd_run_available() {
            return;
        }
        std::env::set_var("XDG_DATA_HOME", "/tmp/tw-data");
        let argv = daemon_spawn_argv("/opt/tw/terminal-workspace", "--terminal-workspace-daemon", "7");
        assert!(argv.iter().any(|a| a == "--setenv=XDG_DATA_HOME=/tmp/tw-data"));
    }
}
