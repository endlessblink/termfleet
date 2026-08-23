#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(unix)]
fn redirect_untrusted_production_ui() -> bool {
    use std::path::PathBuf;

    if std::env::args().any(|arg| {
        arg == terminal_workspace_lib::daemon::DAEMON_ARG
            || arg == terminal_workspace_lib::daemon::DAEMON_STDIO_ARG
    }) {
        return false;
    }
    if std::env::var_os("TERMFLEET_UI_LAUNCH_CONTEXT").is_some() {
        return false;
    }

    let production_runtime = PathBuf::from(format!("/run/user/{}", unsafe { libc::geteuid() }));
    let runtime_dir = std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| production_runtime.clone());
    runtime_dir == production_runtime
}

#[cfg(unix)]
fn redirect_to_shared_desktop_launcher() -> ! {
    use std::process::Command;

    let launcher = std::env::var_os("TERMFLEET_DESKTOP_LAUNCHER")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .map(|home| home.join(".local/bin/termfleet-desktop"))
        });
    let Some(launcher) = launcher else {
        eprintln!("termfleet: refusing untrusted production UI launch; desktop launcher is unavailable");
        std::process::exit(64);
    };
    match Command::new(&launcher).arg("--agent").status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(error) => {
            eprintln!(
                "termfleet: could not route production UI through {}: {error}",
                launcher.display()
            );
            std::process::exit(64);
        }
    }
}

fn main() {
    if std::env::args().any(|arg| arg == terminal_workspace_lib::daemon::DAEMON_ARG) {
        if let Err(error) = terminal_workspace_lib::daemon::run_daemon_forever() {
            eprintln!("terminal-workspace daemon failed: {error}");
            std::process::exit(1);
        }
        return;
    }
    if std::env::args().any(|arg| arg == terminal_workspace_lib::daemon::DAEMON_STDIO_ARG) {
        if let Err(error) = terminal_workspace_lib::daemon::run_daemon_stdio_bridge_from_args() {
            eprintln!("terminal-workspace daemon stdio bridge failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    #[cfg(unix)]
    if redirect_untrusted_production_ui() {
        redirect_to_shared_desktop_launcher();
    }

    terminal_workspace_lib::run();
}

#[cfg(all(test, unix))]
mod tests {
    #[test]
    fn production_ui_guard_requires_a_trusted_context() {
        // The helper is exercised through the installed direct-binary smoke;
        // keep this test as a compile-time contract for the entry-point guard.
        let _guard: fn() -> bool = super::redirect_untrusted_production_ui;
    }
}
