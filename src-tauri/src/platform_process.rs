use std::process::{Command, Stdio};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub fn spawn_detached_current_binary(arg: &str) -> Result<(), String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let mut command = Command::new(current_exe);
    command
        .arg(arg)
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
        command.process_group(0);
    }

    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
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
