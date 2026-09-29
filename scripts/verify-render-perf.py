#!/usr/bin/env python3
"""TF-015 render-speed regression gate.

Bundles the REAL terminal renderer (src/lib/fontAtlas.ts + gridRenderer.ts) and
drives it in a hidden WebKitGTK window with the dock's graphics settings
(software GL, compositing off, DMA-BUF off, main-thread JIT). Synthetic grid
content only; no sessions, no app state, no network.

Budgets (measured 2026-09-29 on the release machine; see the constants):
- a fresh full screen where every cell is a new glyph/colour pair — the old
  one-canvas-per-glyph atlas fails this (~105-120 ms vs ~50-65 ms);
- colour-animated rows (agent "shimmer" text) stay cheap;
- JavaScript must run with the JIT on (JSC_useJIT=false fails, ~50 ms vs ~12 ms).
Checked to fail: TF_RENDER_LIB=<copy with the old atlas>, and JSC_useJIT=false.

Usage: xvfb-run -a python3 scripts/verify-render-perf.py   (npm run verify:render-perf)
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUDGET_FRESH_SCREEN_MS = 85.0   # shared sheet ~55-65 ms; one canvas per glyph ~105-120 ms+
BUDGET_SHIMMER_P95_MS = 12.0    # shared sheet 3-5 ms; loose ceiling for disasters
BUDGET_JS_LOOP_MS = 35.0        # JIT on 12-21 ms; JSC_useJIT=false ~50 ms

# Same renderer flags as scripts/termfleet-desktop-launcher.sh.
# An inherited JSC_useJIT is kept on purpose: running with JSC_useJIT=false
# must fail the JavaScript-speed budget.
for key in ("JSC_useConcurrentJIT",):
    os.environ.pop(key, None)
os.environ.update({
    "JSC_useConcurrentJIT": "false",
    "LIBGL_ALWAYS_SOFTWARE": "1",
    "WEBKIT_DISABLE_COMPOSITING_MODE": "1",
    "WEBKIT_DISABLE_DMABUF_RENDERER": "1",
})

ENTRY = """
import { GlyphAtlas, measureCell } from "%LIB%/fontAtlas";
import { renderPartial, renderSnapshot, sizeCanvasToGrid } from "%LIB%/gridRenderer";
(window as any).__tf = { GlyphAtlas, measureCell, renderPartial, renderSnapshot, sizeCanvasToGrid };
"""

PAGE_SCRIPT = r"""
(async () => {
  const { GlyphAtlas, measureCell, renderPartial, renderSnapshot, sizeCanvasToGrid } = window.__tf;
  const COLS = 138, ROWS = 27, dpr = 1;
  const metrics = measureCell("monospace", 14, dpr, 1.2);
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const atlas = new GlyphAtlas(metrics);
  const ctx = sizeCanvasToGrid(canvas, atlas, COLS, ROWS, dpr);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789{}[]()<>=+-*/";
  const hex = (n) => "#" + (n & 0xffffff).toString(16).padStart(6, "0");
  const snapshot = (colour) => ({
    cols: COLS, rows: ROWS, cursor: { col: 0, line: 0 }, altScreen: false, cursorVisible: false,
    cells: Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => ({
      c: chars[(r * COLS + c) % chars.length], fg: colour(r, c), bg: "#1d2022",
    }))),
  });
  const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

  // Warm up fonts and code paths with a plain screen.
  const plain = snapshot(() => "#d8dce0");
  for (let i = 0; i < 3; i++) renderSnapshot(ctx, atlas, plain, dpr);

  // Fresh screens: every cell is a new glyph/colour pair (three different
  // screens, so the cache also has to evict). The median is the gated figure.
  const freshRuns = [0, 1, 2].map((k) => {
    const fresh = snapshot((r, c) => hex(0x103050 + (k * ROWS * COLS + r * COLS + c) * 97));
    return time(() => renderSnapshot(ctx, atlas, fresh, dpr));
  }).sort((a, b) => a - b);
  const freshMs = freshRuns[1];

  // Shimmer: one line whose colours change every frame, like an agent's
  // animated "thinking" text. Only that row is redrawn, as the live diff path does.
  const frames = [];
  for (let f = 0; f < 60; f++) {
    const s = snapshot((r, c) => (r === 5 ? hex(0x405060 + (f * COLS + c) * 131) : "#d8dce0"));
    frames.push(time(() => renderPartial(ctx, atlas, s, [5], dpr)));
  }
  frames.sort((a, b) => a - b);

  // Pure JavaScript speed: catches the JIT being switched off again.
  const jsMs = time(() => {
    let acc = 0;
    for (let i = 0; i < 3e6; i++) acc = (acc + ((i * 2654435761) >>> 7)) % 1000003;
    window.__acc = acc;
  });

  let lit = 0;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 200) lit++;

  window.webkit.messageHandlers.result.postMessage(JSON.stringify({
    freshScreenMs: +freshMs.toFixed(1),
    shimmerP50Ms: +frames[30].toFixed(1),
    shimmerP95Ms: +frames[57].toFixed(1),
    shimmerMaxMs: +frames[59].toFixed(1),
    jsLoopMs: +jsMs.toFixed(1),
    litPixels: lit,
  }));
})().catch((error) => window.webkit.messageHandlers.result.postMessage(JSON.stringify({ error: String(error) })));
"""


def bundle() -> str:
    with tempfile.TemporaryDirectory() as tmp:
        entry = ROOT / ".verify-render-perf-entry.ts"
        out = Path(tmp) / "bundle.js"
        # TF_RENDER_LIB lets a check point the gate at another copy of the renderer.
        entry.write_text(ENTRY.replace("%LIB%", os.environ.get("TF_RENDER_LIB", "./src/lib")))
        try:
            subprocess.run(
                [str(ROOT / "node_modules/.bin/esbuild"), str(entry), "--bundle", "--format=iife",
                 f"--outfile={out}", "--log-level=error"],
                check=True, cwd=ROOT,
            )
        finally:
            entry.unlink(missing_ok=True)
        return out.read_text()


def run(script: str) -> dict:
    import gi
    gi.require_version("Gtk", "3.0")
    gi.require_version("WebKit2", "4.1")
    from gi.repository import GLib, Gtk, WebKit2

    result: dict = {}
    manager = WebKit2.UserContentManager()
    manager.register_script_message_handler("result")

    def on_result(_manager, value):
        result.update(json.loads(value.get_js_value().to_string()))
        Gtk.main_quit()

    manager.connect("script-message-received::result", on_result)
    view = WebKit2.WebView.new_with_user_content_manager(manager)
    window = Gtk.Window()
    window.set_default_size(1200, 600)
    window.add(view)
    html = f"<!doctype html><body style='margin:0;background:#111'><script>{script}\n{PAGE_SCRIPT}</script>"
    view.load_html(html, "http://termfleet-render-perf.invalid")
    window.show_all()
    GLib.timeout_add_seconds(60, lambda: (result.setdefault("error", "timed out"), Gtk.main_quit()))
    Gtk.main()
    return result


def main() -> int:
    result = run(bundle())
    print(json.dumps(result))
    if "error" in result:
        print(f"FAIL: {result['error']}")
        return 1
    failures = []
    if result["litPixels"] < 10_000:
        failures.append(f"renderer drew almost nothing ({result['litPixels']} lit pixels)")
    if result["freshScreenMs"] > BUDGET_FRESH_SCREEN_MS:
        failures.append(f"fresh screen {result['freshScreenMs']} ms > {BUDGET_FRESH_SCREEN_MS} ms")
    if result["shimmerP95Ms"] > BUDGET_SHIMMER_P95_MS:
        failures.append(f"colour-animated frame p95 {result['shimmerP95Ms']} ms > {BUDGET_SHIMMER_P95_MS} ms")
    if result["jsLoopMs"] > BUDGET_JS_LOOP_MS:
        failures.append(f"JavaScript loop {result['jsLoopMs']} ms > {BUDGET_JS_LOOP_MS} ms (JIT off?)")
    for failure in failures:
        print(f"FAIL: {failure}")
    if not failures:
        print("Render speed within budget.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
