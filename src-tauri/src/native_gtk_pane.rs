use crate::native_terminal::{NativeTerminalBounds, NativeTerminalCreateRequest};
use gtk::gdk;
use gtk::glib;
use gtk::glib::translate::from_glib_none;
use gtk::prelude::*;
use std::sync::mpsc;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

#[derive(Debug, Clone)]
pub struct NativeGtkPane {
    vte_widget_ptr: usize,
    focused: Arc<AtomicBool>,
    _child_pid: i32,
}

pub fn embedding_compiled() -> bool {
    true
}

/// Attaches a VTE widget above Tauri's WebKitGTK view.
pub fn attach(
    window: &tauri::WebviewWindow,
    request: &NativeTerminalCreateRequest,
    _handle: &str,
) -> Result<NativeGtkPane, String> {
    let overlay = ensure_native_overlay(window)?;
    let vte_widget_ptr = unsafe { crate::native_vte::create_terminal_widget_ptr()? };
    if vte_widget_ptr.is_null() {
        return Err("VTE returned a null terminal widget".to_string());
    }

    let vte_widget: gtk::Widget =
        unsafe { from_glib_none(vte_widget_ptr as *mut gtk::ffi::GtkWidget) };
    vte_widget.set_hexpand(false);
    vte_widget.set_vexpand(false);
    apply_bounds(&vte_widget, &request.bounds);
    overlay.add_overlay(&vte_widget);
    overlay.set_overlay_pass_through(&vte_widget, false);
    install_render_acceleration_hooks(&vte_widget);
    install_latency_trace_probes(&vte_widget, request);
    vte_widget.show_all();

    let child_pid = crate::native_vte::spawn_daemon_bridge(
        vte_widget_ptr,
        &request.session_id,
        request.cwd.as_deref(),
        request.command.as_deref(),
    )?;
    trace_native_vte_attach(request, child_pid);

    Ok(NativeGtkPane {
        vte_widget_ptr: vte_widget_ptr as usize,
        focused: Arc::new(AtomicBool::new(false)),
        _child_pid: child_pid,
    })
}

fn install_render_acceleration_hooks(widget: &gtk::Widget) {
    widget.connect("contents-changed", false, move |values| {
        if let Some(widget) = values
            .first()
            .and_then(|value| value.get::<gtk::Widget>().ok())
        {
            widget.queue_draw();
            if let Some(frame_clock) = widget.frame_clock() {
                frame_clock.request_phase(gdk::FrameClockPhase::PAINT);
            }
        }
        None
    });
}

fn trace_native_vte_attach(request: &NativeTerminalCreateRequest, child_pid: i32) {
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_none()
        && std::env::var_os("TERMINAL_WORKSPACE_NATIVE_VTE_LOG_LIFECYCLE").is_none()
    {
        return;
    }

    eprintln!(
        "native-terminal-vte-attached session_id={} tab_id={} pane_id={} child_pid={} cwd={}",
        request.session_id,
        request.tab_id,
        request.pane_id,
        child_pid,
        request.cwd.as_deref().unwrap_or("")
    );
}

fn install_latency_trace_probes(widget: &gtk::Widget, request: &NativeTerminalCreateRequest) {
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_none() {
        return;
    }

    let key_context = trace_context(request);
    widget.add_events(gdk::EventMask::KEY_PRESS_MASK);
    widget.connect_key_press_event(move |widget, event| {
        crate::commands::trace_terminal_latency(
            "native.vte.key.press",
            &format!(
                "{} keyval={} hardware_keycode={}",
                key_context,
                event.keyval(),
                event.hardware_keycode()
            ),
        );
        if let Some(frame_clock) = widget.frame_clock() {
            frame_clock.request_phase(gdk::FrameClockPhase::AFTER_PAINT);
        }
        glib::Propagation::Proceed
    });

    let contents_context = trace_context(request);
    widget.connect("contents-changed", false, move |_| {
        crate::commands::trace_terminal_latency("native.vte.contents.changed", &contents_context);
        None
    });

    let commit_context = trace_context(request);
    widget.connect("commit", false, move |values| {
        let committed_bytes = values
            .get(1)
            .and_then(|value| value.get::<String>().ok())
            .map(|text| text.len())
            .unwrap_or(0);
        crate::commands::trace_terminal_latency(
            "native.vte.commit",
            &format!("{commit_context} bytes={committed_bytes}"),
        );
        None
    });

    let draw_context = trace_context(request);
    widget.connect_draw(move |_, _| {
        crate::commands::trace_terminal_latency("native.vte.draw", &draw_context);
        glib::Propagation::Proceed
    });

    install_after_paint_trace_probe(widget, request);
}

fn trace_context(request: &NativeTerminalCreateRequest) -> String {
    format!(
        "session_id={} tab_id={} pane_id={}",
        request.session_id, request.tab_id, request.pane_id
    )
}

fn install_after_paint_trace_probe(widget: &gtk::Widget, request: &NativeTerminalCreateRequest) {
    let installed = Arc::new(AtomicBool::new(false));
    let context = trace_context(request);
    install_after_paint_trace_probe_now(widget, &context, &installed);

    let realized_context = context.clone();
    let realized_installed = Arc::clone(&installed);
    widget.connect_realize(move |widget| {
        install_after_paint_trace_probe_now(widget, &realized_context, &realized_installed);
    });
}

fn install_after_paint_trace_probe_now(
    widget: &gtk::Widget,
    context: &str,
    installed: &Arc<AtomicBool>,
) {
    if installed.swap(true, Ordering::Relaxed) {
        return;
    }

    let Some(frame_clock) = widget.frame_clock() else {
        installed.store(false, Ordering::Relaxed);
        return;
    };

    let after_paint_context = context.to_string();
    frame_clock.connect_after_paint(move |_| {
        crate::commands::trace_terminal_latency(
            "native.vte.frame.after_paint",
            &after_paint_context,
        );
    });
    frame_clock.request_phase(gdk::FrameClockPhase::AFTER_PAINT);
}

pub fn update(pane: &NativeGtkPane, bounds: &NativeTerminalBounds, visible: bool, focused: bool) {
    let widget = pane.widget();
    apply_bounds(&widget, bounds);
    widget.set_visible(visible);
    let was_focused = pane.focused.swap(focused && visible, Ordering::Relaxed);
    if focused && visible && !was_focused {
        widget.grab_focus();
    }
    trace_native_vte_update(bounds, visible, focused);
}

pub fn destroy(pane: NativeGtkPane) {
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_some() {
        eprintln!(
            "native-terminal-vte-destroyed child_pid={}",
            pane._child_pid
        );
        crate::commands::trace_terminal_latency(
            "native.vte.destroy",
            &format!("child_pid={}", pane._child_pid),
        );
    }
    unsafe {
        pane.widget().destroy();
    }
}

impl NativeGtkPane {
    fn widget(&self) -> gtk::Widget {
        unsafe { from_glib_none(self.vte_widget_ptr as *mut gtk::ffi::GtkWidget) }
    }
}

fn apply_bounds(widget: &gtk::Widget, bounds: &NativeTerminalBounds) {
    widget.set_halign(gtk::Align::Start);
    widget.set_valign(gtk::Align::Start);
    widget.set_margin_start(bounds.x.round() as i32);
    widget.set_margin_top(bounds.y.round() as i32);
    widget.set_size_request(bounds.width.round() as i32, bounds.height.round() as i32);
}

fn trace_native_vte_update(bounds: &NativeTerminalBounds, visible: bool, focused: bool) {
    if std::env::var_os("TERMINAL_WORKSPACE_TRACE_LATENCY").is_none()
        && std::env::var_os("TERMINAL_WORKSPACE_NATIVE_VTE_LOG_LIFECYCLE").is_none()
    {
        return;
    }

    eprintln!(
        "native-terminal-vte-updated x={} y={} width={} height={} visible={} focused={}",
        bounds.x.round() as i32,
        bounds.y.round() as i32,
        bounds.width.round() as i32,
        bounds.height.round() as i32,
        visible,
        focused
    );
}

fn ensure_native_overlay(window: &tauri::WebviewWindow) -> Result<gtk::Overlay, String> {
    let gtk_window = window.gtk_window().map_err(|error| error.to_string())?;
    if let Some(existing) = find_native_overlay(&gtk_window) {
        return Ok(existing);
    }

    let webview_widget = current_webview_widget(window)?;
    if let Some(parent) = webview_widget.parent() {
        let parent_container = parent
            .downcast::<gtk::Container>()
            .map_err(|_| "Tauri WebView parent is not a GTK container".to_string())?;
        parent_container.remove(&webview_widget);
    }
    if let Ok(default_vbox) = window.default_vbox() {
        if default_vbox.parent().is_some() {
            gtk_window.remove(&default_vbox);
        }
    }

    let overlay = gtk::Overlay::new();
    overlay.set_widget_name("terminal-workspace-native-overlay");
    overlay.set_hexpand(true);
    overlay.set_vexpand(true);
    overlay.add(&webview_widget);

    gtk_window.add(&overlay);
    overlay.show_all();
    Ok(overlay)
}

fn find_native_overlay(window: &gtk::ApplicationWindow) -> Option<gtk::Overlay> {
    for child in window.children() {
        if child.widget_name() != "terminal-workspace-native-overlay" {
            continue;
        }
        return child.downcast::<gtk::Overlay>().ok();
    }
    None
}

fn current_webview_widget(window: &tauri::WebviewWindow) -> Result<gtk::Widget, String> {
    let (sender, receiver) = mpsc::channel::<usize>();
    window
        .with_webview(move |platform_webview| {
            let webview = platform_webview.inner();
            let widget: gtk::Widget = webview.upcast();
            let _ = sender.send(widget.as_ptr() as usize);
        })
        .map_err(|error| error.to_string())?;
    let ptr = receiver.recv().map_err(|error| error.to_string())?;
    Ok(unsafe { from_glib_none(ptr as *mut gtk::ffi::GtkWidget) })
}
