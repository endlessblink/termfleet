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

use crate::daemon::{send_daemon_request, DaemonRequest};

/// The session id of the terminal that currently owns the keyboard, or `None`
/// when focus is on app chrome. Set from the frontend via `set_focused_terminal`.
pub type FocusedSession = Arc<Mutex<Option<String>>>;

/// Hook `key-press-event` on the GTK window so Tab/Shift+Tab reach the focused
/// terminal's PTY instead of moving GTK focus out of the webview.
pub fn install_tab_interceptor(gtk_window: &gtk::ApplicationWindow, focused: FocusedSession) {
    gtk_window.connect_key_press_event(move |_window, event| {
        let keyval = event.keyval();
        let is_tab =
            keyval == gdk::keys::constants::Tab || keyval == gdk::keys::constants::ISO_Left_Tab;
        if !is_tab {
            return glib::Propagation::Proceed;
        }

        // Only claim Tab while a terminal owns the keyboard; otherwise let the app
        // chrome (sidebar, command bar) keep normal Tab navigation.
        let id = match focused.lock().unwrap().clone() {
            Some(id) => id,
            None => return glib::Propagation::Proceed,
        };

        // ISO_Left_Tab is what X/GTK delivers for Shift+Tab; also honor an explicit
        // shift modifier on a plain Tab.
        let shift = keyval == gdk::keys::constants::ISO_Left_Tab
            || event.state().contains(gdk::ModifierType::SHIFT_MASK);
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
