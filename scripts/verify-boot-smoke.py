#!/usr/bin/env python3
"""Boot smoke for the built frontend (dist/) in a hidden WebKitGTK window.

Regression (TF-015, 2026-09-28): a diagnostic assigned Tauri's non-writable
`__TAURI_INTERNALS__.transformCallback`; the TypeError at module load left the
dock app on its loading screen until the watchdog killed it. Unit tests running
in Chromium without Tauri never saw it. This loads the real bundle with a
Tauri-like runtime whose callback helpers are locked the way Tauri locks them,
using the dock's graphics settings, and fails on any uncaught error or if the
app never mounts. No backend, sessions, or app state are touched.

Usage: npm run build && xvfb-run -a python3 scripts/verify-boot-smoke.py [dist-dir]
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
from pathlib import Path

os.environ.update({
    "JSC_useConcurrentJIT": "false",
    "LIBGL_ALWAYS_SOFTWARE": "1",
    "WEBKIT_DISABLE_COMPOSITING_MODE": "1",
    "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
})

import gi  # noqa: E402

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import GLib, Gtk, WebKit2  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "dist"

# Mirrors how Tauri 2 defines its internals: transformCallback/unregisterCallback
# via Object.defineProperty with no `writable`, i.e. read-only.
PRELUDE = r"""
window.__bootErrors = [];
window.addEventListener('error', e => window.__bootErrors.push(String(e.message)));
window.addEventListener('unhandledrejection', e => {
  const message = String(e.reason && e.reason.message || e.reason);
  if (!/no backend in smoke/.test(message)) window.__bootErrors.push('rejection: ' + message);
});
const internals = {};
let next = 1;
Object.defineProperty(internals, 'transformCallback', { value: () => next++ });
Object.defineProperty(internals, 'unregisterCallback', { value: () => {} });
internals.invoke = () => Promise.reject(new Error('no backend in smoke'));
internals.metadata = { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } };
internals.convertFileSrc = s => s;
window.__TAURI_INTERNALS__ = internals;
"""

PROBE = """JSON.stringify({errors: window.__bootErrors.slice(0, 5),
  rootChildren: (document.getElementById('root') || {childElementCount: -1}).childElementCount,
  workRecorderInstalled: !/native code/.test(String(window.setTimeout))})"""


def main() -> int:
    if not (DIST / "index.html").exists():
        print(f"FAIL: {DIST}/index.html missing — run `npm run build` first")
        return 1
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    handler.log_message = lambda *args: None  # type: ignore[attr-defined]
    server = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    manager = WebKit2.UserContentManager()
    manager.add_script(WebKit2.UserScript.new(
        PRELUDE, WebKit2.UserContentInjectedFrames.TOP_FRAME,
        WebKit2.UserScriptInjectionTime.START, None, None))
    view = WebKit2.WebView.new_with_user_content_manager(manager)
    window = Gtk.Window()
    window.set_default_size(1400, 900)
    window.add(view)
    result: dict = {}

    def finished(webview, task):
        try:
            result.update(json.loads(webview.evaluate_javascript_finish(task).to_string()))
        except Exception as exc:  # noqa: BLE001
            result["errors"] = [f"probe failed: {exc}"]
        Gtk.main_quit()

    def probe():
        view.evaluate_javascript(PROBE, -1, None, None, None, finished)
        return False

    view.load_uri(f"http://127.0.0.1:{server.server_address[1]}/index.html")
    window.show_all()
    GLib.timeout_add_seconds(8, probe)
    Gtk.main()
    server.shutdown()

    print(json.dumps(result))
    failures = []
    if result.get("errors"):
        failures.append(f"uncaught errors during boot: {result['errors']}")
    if result.get("rootChildren", 0) < 1:
        failures.append("the app never mounted (still on the loading screen)")
    if not result.get("workRecorderInstalled"):
        failures.append("renderer work recorder did not install")
    for failure in failures:
        print(f"FAIL: {failure}")
    if not failures:
        print("Boot smoke passed: app mounted with a locked Tauri runtime and no errors.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
