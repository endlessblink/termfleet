use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::sync::OnceLock;

type VteTerminalNew = unsafe extern "C" fn() -> *mut c_void;
type GSpawnChildSetupFunc = Option<unsafe extern "C" fn(*mut c_void)>;
type VteTerminalSpawnSync = unsafe extern "C" fn(
    terminal: *mut c_void,
    pty_flags: c_int,
    working_directory: *const c_char,
    argv: *mut *mut c_char,
    envv: *mut *mut c_char,
    spawn_flags: u32,
    child_setup: GSpawnChildSetupFunc,
    child_setup_data: *mut c_void,
    child_pid: *mut c_int,
    cancellable: *mut c_void,
    error: *mut *mut c_void,
) -> c_int;
type VteTerminalWatchChild = unsafe extern "C" fn(terminal: *mut c_void, child_pid: c_int);

struct VteSymbols {
    _library_handle: usize,
    terminal_new: VteTerminalNew,
    terminal_spawn_sync: VteTerminalSpawnSync,
    terminal_watch_child: VteTerminalWatchChild,
}

#[link(name = "dl")]
unsafe extern "C" {
    fn dlopen(filename: *const c_char, flags: i32) -> *mut c_void;
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
    fn dlerror() -> *const c_char;
}

const RTLD_NOW: i32 = 2;
const VTE_LIBRARY: &str = "libvte-2.91.so.0";

static VTE_SYMBOLS: OnceLock<Result<VteSymbols, String>> = OnceLock::new();

pub fn backend_compiled() -> bool {
    true
}

pub fn runtime_symbols_available() -> bool {
    symbols().is_ok()
}

pub fn direct_pty_symbols_available() -> bool {
    symbols().is_ok()
}

/// Creates the raw VTE terminal widget pointer.
///
/// The caller must attach the returned GtkWidget to the GTK hierarchy on the
/// main thread and own its lifecycle according to GTK rules.
pub unsafe fn create_terminal_widget_ptr() -> Result<*mut c_void, String> {
    let symbols = symbols()?;
    Ok(unsafe { (symbols.terminal_new)() })
}

pub fn spawn_daemon_bridge(
    terminal: *mut c_void,
    session_id: &str,
    cwd: Option<&str>,
    command: Option<&str>,
) -> Result<i32, String> {
    if terminal.is_null() {
        return Err("cannot spawn VTE shell for null terminal widget".to_string());
    }

    let argv_values = crate::daemon::daemon_stdio_bridge_argv(session_id, cwd, command)?;
    spawn_argv(terminal, cwd, &argv_values)
}

#[cfg(test)]
fn build_shell_argv(command: Option<&str>) -> Vec<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
    if let Some(command) = command.filter(|value| !value.trim().is_empty()) {
        vec![shell, "-lc".to_string(), command.to_string()]
    } else {
        vec![shell, "-l".to_string()]
    }
}

fn spawn_argv(
    terminal: *mut c_void,
    cwd: Option<&str>,
    argv_values: &[String],
) -> Result<i32, String> {
    let symbols = symbols()?;
    let cwd = cwd
        .filter(|value| !value.trim().is_empty())
        .map(CString::new)
        .transpose()
        .map_err(|error| error.to_string())?;
    let argv_cstrings = argv_values
        .iter()
        .map(|value| CString::new(value.as_str()).map_err(|error| error.to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    let mut argv = argv_cstrings
        .iter()
        .map(|value| value.as_ptr() as *mut c_char)
        .chain(std::iter::once(std::ptr::null_mut()))
        .collect::<Vec<_>>();
    let mut child_pid: c_int = 0;
    let ok = unsafe {
        (symbols.terminal_spawn_sync)(
            terminal,
            0,
            cwd.as_ref()
                .map(|value| value.as_ptr())
                .unwrap_or(std::ptr::null()),
            argv.as_mut_ptr(),
            std::ptr::null_mut(),
            0,
            None,
            std::ptr::null_mut(),
            &mut child_pid,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };

    if ok == 0 {
        return Err("VTE failed to spawn the requested shell".to_string());
    }

    unsafe {
        (symbols.terminal_watch_child)(terminal, child_pid);
    }
    Ok(child_pid)
}

fn symbols() -> Result<&'static VteSymbols, String> {
    match VTE_SYMBOLS.get_or_init(load_symbols) {
        Ok(symbols) => Ok(symbols),
        Err(error) => Err(error.clone()),
    }
}

fn load_symbols() -> Result<VteSymbols, String> {
    let library = CString::new(VTE_LIBRARY).map_err(|error| error.to_string())?;
    let handle = unsafe { dlopen(library.as_ptr(), RTLD_NOW) };
    if handle.is_null() {
        return Err(format!("failed to load {VTE_LIBRARY}: {}", last_dl_error()));
    }

    let terminal_new_symbol =
        CString::new("vte_terminal_new").map_err(|error| error.to_string())?;
    let terminal_new = unsafe { dlsym(handle, terminal_new_symbol.as_ptr()) };
    if terminal_new.is_null() {
        return Err(format!(
            "failed to resolve vte_terminal_new from {VTE_LIBRARY}: {}",
            last_dl_error()
        ));
    }
    let terminal_spawn_sync = resolve_symbol(handle, "vte_terminal_spawn_sync")?;
    let terminal_watch_child = resolve_symbol(handle, "vte_terminal_watch_child")?;

    Ok(VteSymbols {
        _library_handle: handle as usize,
        terminal_new: unsafe { std::mem::transmute::<*mut c_void, VteTerminalNew>(terminal_new) },
        terminal_spawn_sync: unsafe {
            std::mem::transmute::<*mut c_void, VteTerminalSpawnSync>(terminal_spawn_sync)
        },
        terminal_watch_child: unsafe {
            std::mem::transmute::<*mut c_void, VteTerminalWatchChild>(terminal_watch_child)
        },
    })
}

fn resolve_symbol(handle: *mut c_void, symbol: &str) -> Result<*mut c_void, String> {
    let symbol_name = CString::new(symbol).map_err(|error| error.to_string())?;
    let resolved = unsafe { dlsym(handle, symbol_name.as_ptr()) };
    if resolved.is_null() {
        return Err(format!(
            "failed to resolve {symbol} from {VTE_LIBRARY}: {}",
            last_dl_error()
        ));
    }
    Ok(resolved)
}

fn last_dl_error() -> String {
    let error = unsafe { dlerror() };
    if error.is_null() {
        return "unknown dynamic loader error".to_string();
    }

    unsafe { CStr::from_ptr(error) }
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_argv_uses_login_shell_without_command() {
        let argv = build_shell_argv(None);
        assert_eq!(argv.last().map(String::as_str), Some("-l"));
    }

    #[test]
    fn shell_argv_runs_explicit_command_through_shell() {
        let argv = build_shell_argv(Some("echo ready"));
        assert_eq!(argv[argv.len() - 2], "-lc");
        assert_eq!(argv.last().map(String::as_str), Some("echo ready"));
    }
}
