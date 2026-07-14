//! Linux/WebKitGTK Tab-key rescue.
//!
//! PROVEN (byte-level, live app): WebKitGTK consumes Tab / Shift+Tab for GTK
//! focus-traversal BEFORE the keydown ever reaches the webview's JavaScript — an
//! ungated JS keydown probe never fired for Tab, and the letter typed right after
//! Shift+Tab vanished (focus had left the terminal). So no DOM-level fix
//! (preventDefault, capture phase, tabIndex) can help: JS never sees the event.
//!
//! The reliable fix is at the GTK layer: hook the window's `key-press-event`,
//! and when a terminal is focused, write the VT byte (`\t` / `ESC [ Z`) straight
//! to that PTY via the daemon and inhibit GTK's traversal so focus stays put.
#![cfg(target_os = "linux")]

use std::sync::{Arc, Mutex};

use gtk::gdk;
use gtk::glib;
use gtk::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::append_paste_log;
use crate::daemon::{send_daemon_request, DaemonRequest};

/// The session id of the terminal that currently owns the keyboard, or `None`
/// when focus is on app chrome. Set from the frontend via `set_focused_terminal`.
pub type FocusedSession = Arc<Mutex<Option<String>>>;

pub const GTK_TERMINAL_CLIPBOARD_SHORTCUT_EVENT: &str =
    "terminal-workspace-gtk-clipboard-shortcut";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct GtkClipboardShortcut {
    id: String,
    kind: &'static str,
}

/// Hook `key-press-event` on the GTK window so Tab/Shift+Tab reach the focused
/// terminal's PTY instead of moving GTK focus out of the webview.
pub fn install_terminal_key_interceptor(
    gtk_window: &gtk::ApplicationWindow,
    focused: FocusedSession,
    app: AppHandle,
) {
    gtk_window.connect_key_press_event(move |_window, event| {
        let keyval = event.keyval();
        let key_name = format!("keyval-{keyval}");
        let is_tab =
            keyval == gdk::keys::constants::Tab || keyval == gdk::keys::constants::ISO_Left_Tab;
        let state = event.state();
        let ctrl = state.contains(gdk::ModifierType::CONTROL_MASK);
        let shift = state.contains(gdk::ModifierType::SHIFT_MASK);
        let ctrl_shift = ctrl && shift && !state.contains(gdk::ModifierType::MOD1_MASK);
        let is_copy = ctrl_shift
            && (keyval == gdk::keys::constants::c || keyval == gdk::keys::constants::C);
        let is_v = keyval == gdk::keys::constants::v || keyval == gdk::keys::constants::V;
        let is_paste = ctrl
            && is_v
            && !state.contains(gdk::ModifierType::MOD1_MASK);
        if is_v || is_copy || is_paste {
            let alt = state.contains(gdk::ModifierType::MOD1_MASK);
            let meta = state.contains(gdk::ModifierType::META_MASK)
                || state.contains(gdk::ModifierType::SUPER_MASK)
                || state.contains(gdk::ModifierType::HYPER_MASK);
            append_paste_log(&format!(
                "gtk.key key={key_name} keyval={keyval} ctrl={ctrl} shift={shift} alt={alt} meta={meta} copy={is_copy} paste={is_paste}"
            ));
        }
        if !is_tab && !is_copy && !is_paste {
            return glib::Propagation::Proceed;
        };

        // Only claim Tab while a terminal owns the keyboard; otherwise let the app
        // chrome (sidebar, command bar) keep normal Tab navigation.
        let id = match focused.lock().unwrap().clone() {
            Some(id) => id,
            None => {
                append_paste_log(&format!(
                    "gtk.shortcut.drop reason=no_focused_terminal key={key_name} copy={is_copy} paste={is_paste}"
                ));
                return glib::Propagation::Proceed;
            }
        };

        if is_copy || is_paste {
            let kind = if is_copy { "copy" } else { "paste" };
            append_paste_log(&format!(
                "gtk.shortcut.emit kind={kind} terminal={id} key={key_name}"
            ));
            let _ = app.emit(
                GTK_TERMINAL_CLIPBOARD_SHORTCUT_EVENT,
                GtkClipboardShortcut { id, kind },
            );
            return glib::Propagation::Stop;
        }

        // ISO_Left_Tab is what X/GTK delivers for Shift+Tab; also honor an explicit
        // shift modifier on a plain Tab.
        let shift = keyval == gdk::keys::constants::ISO_Left_Tab
            || state.contains(gdk::ModifierType::SHIFT_MASK);
        let data = if shift {
            "\u{1b}[Z".to_string()
        } else {
            "\t".to_string()
        };

        // The daemon write is a blocking unix-socket round-trip; do it off the GTK
        // main loop so a slow daemon can't stutter the UI.
        std::thread::spawn(move || {
            let _ = send_daemon_request(DaemonRequest::WriteSession { id, data });
        });

        // Stop GTK from also traversing focus away from the terminal.
        glib::Propagation::Stop
    });
}
