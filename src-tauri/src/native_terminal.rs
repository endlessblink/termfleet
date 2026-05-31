use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalCapabilities {
    pub platform: String,
    pub preferred_backend: NativeTerminalBackend,
    pub readiness_phase: NativeTerminalReadinessPhase,
    pub available: bool,
    pub reason: String,
    pub supports_embedding: bool,
    pub supports_direct_pty: bool,
    pub runtime_detected: bool,
    pub development_headers_detected: bool,
    pub runtime_symbols_available: bool,
    pub backend_compiled: bool,
    pub gtk_embedding_probe_compiled: bool,
    pub embedding_ready: bool,
    pub direct_pty_ready: bool,
    pub required_packages: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeTerminalBackend {
    VteGtk,
    Wgpu,
    WebXtermFallback,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeTerminalReadinessPhase {
    UnsupportedPlatform,
    RuntimeMissing,
    DevelopmentHeadersMissing,
    BackendNotCompiled,
    EmbeddingNotReady,
    DirectPtyNotReady,
    Ready,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalCreateRequest {
    pub session_id: String,
    pub tab_id: String,
    pub pane_id: String,
    pub window_label: Option<String>,
    pub bounds: NativeTerminalBounds,
    pub cwd: Option<String>,
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalCreateResult {
    pub handle: String,
    pub backend: NativeTerminalBackend,
    pub readiness_phase: NativeTerminalReadinessPhase,
    pub attached: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTerminalUpdateRequest {
    pub handle: String,
    pub bounds: NativeTerminalBounds,
    pub visible: bool,
    pub focused: bool,
}

#[derive(Debug, Clone)]
struct NativeTerminalHandle {
    _backend: NativeTerminalBackend,
    _session_id: String,
    _window_label: String,
    _readiness_phase: NativeTerminalReadinessPhase,
    bounds: NativeTerminalBounds,
    visible: bool,
    focused: bool,
}

static NATIVE_TERMINALS: OnceLock<Mutex<HashMap<String, NativeTerminalHandle>>> = OnceLock::new();

fn native_terminals() -> &'static Mutex<HashMap<String, NativeTerminalHandle>> {
    NATIVE_TERMINALS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[tauri::command]
pub fn native_terminal_capabilities() -> NativeTerminalCapabilities {
    #[cfg(target_os = "linux")]
    {
        let runtime_detected = linux_library_present("libvte-2.91.so.0");
        let development_headers_detected = pkg_config_exists("vte-2.91");
        let backend_compiled = native_vte_backend_compiled();
        let runtime_symbols_available = native_vte_runtime_symbols_available();
        let gtk_embedding_probe_compiled = native_gtk_embedding_probe_compiled();
        let embedding_ready = native_vte_embedding_ready();
        let direct_pty_ready = native_vte_direct_pty_ready();
        let readiness_phase = linux_native_vte_readiness_phase(
            runtime_detected,
            development_headers_detected || runtime_symbols_available,
            backend_compiled,
            embedding_ready,
            direct_pty_ready,
        );
        let reason = native_vte_reason(&readiness_phase);
        trace_native_terminal_capabilities(
            &readiness_phase,
            runtime_detected,
            development_headers_detected,
            runtime_symbols_available,
            backend_compiled,
            gtk_embedding_probe_compiled,
            embedding_ready,
            direct_pty_ready,
        );

        return NativeTerminalCapabilities {
            platform: "linux".to_string(),
            preferred_backend: NativeTerminalBackend::VteGtk,
            readiness_phase: readiness_phase.clone(),
            available: readiness_phase == NativeTerminalReadinessPhase::Ready,
            reason,
            supports_embedding: embedding_ready,
            supports_direct_pty: direct_pty_ready,
            runtime_detected,
            development_headers_detected,
            runtime_symbols_available,
            backend_compiled,
            gtk_embedding_probe_compiled,
            embedding_ready,
            direct_pty_ready,
            required_packages: vec!["libvte-2.91-0".to_string()],
        };
    }

    #[allow(unreachable_code)]
    NativeTerminalCapabilities {
        platform: std::env::consts::OS.to_string(),
        preferred_backend: NativeTerminalBackend::WebXtermFallback,
        readiness_phase: NativeTerminalReadinessPhase::UnsupportedPlatform,
        available: false,
        reason: "native terminal panes are only planned for Linux in this build".to_string(),
        supports_embedding: false,
        supports_direct_pty: false,
        runtime_detected: false,
        development_headers_detected: false,
        runtime_symbols_available: false,
        backend_compiled: false,
        gtk_embedding_probe_compiled: false,
        embedding_ready: false,
        direct_pty_ready: false,
        required_packages: Vec::new(),
    }
}

#[cfg(target_os = "linux")]
#[allow(clippy::too_many_arguments)]
fn trace_native_terminal_capabilities(
    readiness_phase: &NativeTerminalReadinessPhase,
    runtime_detected: bool,
    development_headers_detected: bool,
    runtime_symbols_available: bool,
    backend_compiled: bool,
    gtk_embedding_probe_compiled: bool,
    embedding_ready: bool,
    direct_pty_ready: bool,
) {
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_none() {
        return;
    }

    eprintln!(
        "native-terminal-capabilities readiness_phase={:?} available={} runtime_detected={} development_headers_detected={} runtime_symbols_available={} backend_compiled={} gtk_embedding_probe_compiled={} embedding_ready={} direct_pty_ready={}",
        readiness_phase,
        matches!(readiness_phase, NativeTerminalReadinessPhase::Ready),
        runtime_detected,
        development_headers_detected,
        runtime_symbols_available,
        backend_compiled,
        gtk_embedding_probe_compiled,
        embedding_ready,
        direct_pty_ready
    );
}

#[cfg(target_os = "linux")]
fn linux_native_vte_readiness_phase(
    runtime_detected: bool,
    development_headers_detected: bool,
    backend_compiled: bool,
    embedding_ready: bool,
    direct_pty_ready: bool,
) -> NativeTerminalReadinessPhase {
    if !runtime_detected {
        NativeTerminalReadinessPhase::RuntimeMissing
    } else if !backend_compiled {
        NativeTerminalReadinessPhase::BackendNotCompiled
    } else if !development_headers_detected {
        NativeTerminalReadinessPhase::DevelopmentHeadersMissing
    } else if !embedding_ready {
        NativeTerminalReadinessPhase::EmbeddingNotReady
    } else if !direct_pty_ready {
        NativeTerminalReadinessPhase::DirectPtyNotReady
    } else {
        NativeTerminalReadinessPhase::Ready
    }
}

fn native_vte_reason(readiness_phase: &NativeTerminalReadinessPhase) -> String {
    match readiness_phase {
        NativeTerminalReadinessPhase::UnsupportedPlatform => {
            "native terminal panes are only planned for Linux in this build"
        }
        NativeTerminalReadinessPhase::RuntimeMissing => {
            "native VTE runtime library is missing; install libvte-2.91-0"
        }
        NativeTerminalReadinessPhase::DevelopmentHeadersMissing => {
            "native VTE runtime exists, but vte_terminal_new could not be resolved from libvte-2.91.so.0"
        }
        NativeTerminalReadinessPhase::BackendNotCompiled => {
            "native VTE is retired; the desktop terminal uses the Canvas2D renderer, so no GTK/VTE backend is linked"
        }
        NativeTerminalReadinessPhase::EmbeddingNotReady => {
            "native VTE backend is linked, but GTK child-widget embedding is not wired to Tauri panes yet"
        }
        NativeTerminalReadinessPhase::DirectPtyNotReady => {
            "native VTE GTK embedding is wired, but direct PTY ownership/input routing is not wired yet"
        }
        NativeTerminalReadinessPhase::Ready => "native VTE backend is ready",
    }
    .to_string()
}

// Native VTE/GTK embedding is retired (see CLAUDE.md): the GTK-over-WebKitGTK
// overlay was a dead end superseded by the Canvas2D renderer. These probes now
// always report "not compiled/ready" so the capability surface stays honest
// without linking any GTK/VTE backend.
fn native_vte_backend_compiled() -> bool {
    false
}

fn native_vte_runtime_symbols_available() -> bool {
    false
}

fn native_vte_direct_pty_ready() -> bool {
    false
}

fn native_gtk_embedding_probe_compiled() -> bool {
    false
}

fn native_vte_embedding_ready() -> bool {
    false
}

#[cfg(target_os = "linux")]
fn pkg_config_exists(package: &str) -> bool {
    Command::new("pkg-config")
        .arg("--exists")
        .arg(package)
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn linux_library_present(library: &str) -> bool {
    [
        "/usr/lib",
        "/usr/lib/x86_64-linux-gnu",
        "/lib",
        "/lib/x86_64-linux-gnu",
    ]
    .iter()
    .any(|prefix| std::path::Path::new(prefix).join(library).exists())
}

#[tauri::command]
pub fn native_terminal_create(
    window: tauri::WebviewWindow,
    request: NativeTerminalCreateRequest,
) -> Result<NativeTerminalCreateResult, String> {
    native_terminal_create_inner(Some(&window), request)
}

fn native_terminal_create_inner(
    window: Option<&tauri::WebviewWindow>,
    request: NativeTerminalCreateRequest,
) -> Result<NativeTerminalCreateResult, String> {
    validate_create_request(&request)?;

    let capabilities = native_terminal_capabilities();
    if !capabilities.available {
        return Err(capabilities.reason);
    }

    let window_label = request
        .window_label
        .clone()
        .unwrap_or_else(|| "main".to_string());
    let handle = format!(
        "native-terminal-{}-{}-{}",
        window_label, request.tab_id, request.pane_id
    );

    attach_native_pane(window, &request, &handle)?;

    native_terminals()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(
            handle.clone(),
            NativeTerminalHandle {
                _backend: capabilities.preferred_backend.clone(),
                _session_id: request.session_id,
                _window_label: window_label,
                _readiness_phase: capabilities.readiness_phase.clone(),
                bounds: request.bounds,
                visible: true,
                focused: true,
            },
        );

    Ok(NativeTerminalCreateResult {
        handle,
        backend: capabilities.preferred_backend,
        readiness_phase: capabilities.readiness_phase,
        attached: true,
        reason: "native terminal pane attached".to_string(),
    })
}

fn attach_native_pane(
    _window: Option<&tauri::WebviewWindow>,
    _request: &NativeTerminalCreateRequest,
    _handle: &str,
) -> Result<(), String> {
    Ok(())
}

fn validate_create_request(request: &NativeTerminalCreateRequest) -> Result<(), String> {
    if request.session_id.trim().is_empty() {
        return Err("native terminal session_id is required".to_string());
    }
    if request.tab_id.trim().is_empty() {
        return Err("native terminal tab_id is required".to_string());
    }
    if request.pane_id.trim().is_empty() {
        return Err("native terminal pane_id is required".to_string());
    }
    if request.bounds.width <= 0.0 || request.bounds.height <= 0.0 {
        return Err("native terminal bounds must have positive width and height".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn native_terminal_update(request: NativeTerminalUpdateRequest) -> Result<(), String> {
    let mut terminals = native_terminals()
        .lock()
        .map_err(|error| error.to_string())?;
    let terminal = terminals
        .get_mut(&request.handle)
        .ok_or_else(|| format!("native terminal handle {} not found", request.handle))?;
    terminal.bounds = request.bounds;
    terminal.visible = request.visible;
    terminal.focused = request.focused;
    Ok(())
}

#[tauri::command]
pub fn native_terminal_destroy(handle: String) -> Result<(), String> {
    native_terminals()
        .lock()
        .map_err(|error| error.to_string())?
        .remove(&handle);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_terminal_capability_is_explicitly_gated() {
        // Native VTE is retired: the capability surface must always report the
        // backend as unavailable / not embeddable (no GTK/VTE is ever linked).
        let capabilities = native_terminal_capabilities();
        assert!(!capabilities.available);
        assert!(!capabilities.supports_embedding);
        assert!(!capabilities.reason.is_empty());
        #[cfg(target_os = "linux")]
        assert!(capabilities
            .required_packages
            .contains(&"libvte-2.91-0".to_string()));
    }

    #[test]
    fn create_refuses_when_backend_is_unavailable() {
        let result = native_terminal_create_inner(
            None,
            NativeTerminalCreateRequest {
                session_id: "session".to_string(),
                tab_id: "tab".to_string(),
                pane_id: "pane".to_string(),
                window_label: Some("main".to_string()),
                bounds: NativeTerminalBounds {
                    x: 0.0,
                    y: 0.0,
                    width: 800.0,
                    height: 400.0,
                },
                cwd: None,
                command: None,
            },
        );

        assert!(result.is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_vte_reason_reports_dependency_gate_order() {
        assert_eq!(
            linux_native_vte_readiness_phase(false, false, false, false, false),
            NativeTerminalReadinessPhase::RuntimeMissing
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, false, false, false, false),
            NativeTerminalReadinessPhase::BackendNotCompiled
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, false, true, false, false),
            NativeTerminalReadinessPhase::DevelopmentHeadersMissing
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, true, false, false, false),
            NativeTerminalReadinessPhase::BackendNotCompiled
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, true, true, false, false),
            NativeTerminalReadinessPhase::EmbeddingNotReady
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, true, true, true, false),
            NativeTerminalReadinessPhase::DirectPtyNotReady
        );
        assert_eq!(
            linux_native_vte_readiness_phase(true, true, true, true, true),
            NativeTerminalReadinessPhase::Ready
        );
    }

    #[test]
    fn create_request_validation_rejects_unaddressable_native_panes() {
        let request = NativeTerminalCreateRequest {
            session_id: "".to_string(),
            tab_id: "tab".to_string(),
            pane_id: "pane".to_string(),
            window_label: Some("main".to_string()),
            bounds: NativeTerminalBounds {
                x: 0.0,
                y: 0.0,
                width: 800.0,
                height: 400.0,
            },
            cwd: None,
            command: None,
        };
        assert!(validate_create_request(&request).is_err());

        let request = NativeTerminalCreateRequest {
            session_id: "session".to_string(),
            tab_id: "tab".to_string(),
            pane_id: "pane".to_string(),
            window_label: Some("main".to_string()),
            bounds: NativeTerminalBounds {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 400.0,
            },
            cwd: None,
            command: None,
        };
        assert!(validate_create_request(&request).is_err());
    }
}
