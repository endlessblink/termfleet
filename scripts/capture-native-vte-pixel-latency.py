#!/usr/bin/env python3
import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

from PIL import Image
from Xlib import X, XK, display
from Xlib.ext import xtest


def epoch_ms() -> int:
    return time.time_ns() // 1_000_000


def percentile(values: list[float], p: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil((p / 100) * len(ordered)) - 1)
    return ordered[index]


def image_from_xdata(data: bytes, width: int, height: int, bytes_per_pixel: int) -> Image.Image:
    if bytes_per_pixel == 4:
        return Image.frombytes("RGB", (width, height), data, "raw", "BGRX")
    if bytes_per_pixel == 3:
        return Image.frombytes("RGB", (width, height), data, "raw", "BGR")
    return Image.frombytes("RGB", (width, height), data)


def changed_pixels(
    baseline: bytes,
    current: bytes,
    width: int,
    height: int,
    bytes_per_pixel: int,
    channel_threshold: int,
    stop_at: int | None = None,
) -> int:
    count = 0
    pixel_count = width * height
    for index in range(pixel_count):
        offset = index * bytes_per_pixel
        if (
            abs(baseline[offset] - current[offset]) > channel_threshold
            or abs(baseline[offset + 1] - current[offset + 1]) > channel_threshold
            or abs(baseline[offset + 2] - current[offset + 2]) > channel_threshold
        ):
            count += 1
            if stop_at is not None and count >= stop_at:
                return count
    return count


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--display", required=True)
    parser.add_argument("--xauthority", required=True)
    parser.add_argument("--window-id", required=True)
    parser.add_argument("--x", type=int, required=True)
    parser.add_argument("--y", type=int, required=True)
    parser.add_argument("--width", type=int, required=True)
    parser.add_argument("--height", type=int, required=True)
    parser.add_argument("--fps", type=int, default=180)
    parser.add_argument("--chars", default="wwwwwwwwwwww")
    parser.add_argument("--warmup-chars", default="ww")
    parser.add_argument("--reset-between-samples", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--p95-limit-ms", type=float, default=25)
    parser.add_argument("--report", required=True)
    parser.add_argument("--debug-prefix", default="")
    args = parser.parse_args()

    os.environ["DISPLAY"] = args.display
    os.environ["XAUTHORITY"] = args.xauthority
    env = os.environ.copy()

    xdisplay = display.Display(args.display)
    root = xdisplay.screen().root
    first_image = root.get_image(args.x, args.y, args.width, args.height, X.ZPixmap, 0xFFFFFFFF)
    bytes_per_pixel = len(first_image.data) // (args.width * args.height)
    if bytes_per_pixel not in (3, 4):
        print(f"Unsupported XImage bytes-per-pixel: {bytes_per_pixel}", file=sys.stderr)
        return 1

    channel_threshold = int(os.environ.get("TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_CHANNEL_THRESHOLD", "6"))
    changed_pixel_threshold = max(8, int(args.width * args.height * 0.00003))
    reset_settle_seconds = float(os.environ.get("TERMINAL_WORKSPACE_NATIVE_VTE_PIXEL_RESET_SETTLE_SECONDS", "0.02"))

    def capture() -> tuple[int, bytes]:
        image = root.get_image(args.x, args.y, args.width, args.height, X.ZPixmap, 0xFFFFFFFF)
        return epoch_ms(), bytes(image.data)

    def run_xdotool(*tool_args: str) -> None:
        subprocess.run(["xdotool", *tool_args], check=True, env=env)

    def send_key(keysym_name: str, *, ctrl: bool = False) -> None:
        keysym = XK.string_to_keysym(keysym_name)
        keycode = xdisplay.keysym_to_keycode(keysym)
        if keycode == 0:
            raise RuntimeError(f"Unable to resolve X11 keycode for keysym {keysym_name}")

        ctrl_keycode = xdisplay.keysym_to_keycode(XK.string_to_keysym("Control_L"))
        if ctrl and ctrl_keycode:
            xtest.fake_input(xdisplay, X.KeyPress, ctrl_keycode)
        xtest.fake_input(xdisplay, X.KeyPress, keycode)
        xtest.fake_input(xdisplay, X.KeyRelease, keycode)
        if ctrl and ctrl_keycode:
            xtest.fake_input(xdisplay, X.KeyRelease, ctrl_keycode)
        xdisplay.flush()

    run_xdotool("windowactivate", args.window_id)
    run_xdotool("mousemove", str(args.x + 48), str(args.y + 44))
    run_xdotool("click", "--clearmodifiers", "1")
    time.sleep(0.25)

    samples = []
    debug_first_frame = None
    debug_last_frame = None
    send_key("u", ctrl=True)
    time.sleep(0.08)
    for char in args.warmup_chars:
        send_key(char)
        time.sleep(0.03)
        if args.reset_between_samples:
            send_key("BackSpace")
            time.sleep(reset_settle_seconds)
    for char in args.chars:
        baseline_ms, baseline = capture()
        if debug_first_frame is None:
            debug_first_frame = baseline

        key_ms = epoch_ms()
        send_key(char)

        first_changed_ms = None
        changed_count = 0
        max_changed_count = 0
        max_changed_ms = None
        timeout_ms = key_ms + 180
        while epoch_ms() <= timeout_ms:
            frame_ms, frame = capture()
            debug_last_frame = frame
            pixel_count = changed_pixels(
                baseline,
                frame,
                args.width,
                args.height,
                bytes_per_pixel,
                channel_threshold,
                changed_pixel_threshold,
            )
            if pixel_count > max_changed_count:
                max_changed_count = pixel_count
                max_changed_ms = frame_ms
            if pixel_count >= changed_pixel_threshold:
                first_changed_ms = frame_ms
                changed_count = pixel_count
                break
            time.sleep(0.001)

        samples.append(
            {
                "char": char,
                "baseline_frame_ms": baseline_ms,
                "key_ms": key_ms,
                "first_changed_frame_ms": first_changed_ms,
                "latency_ms": None if first_changed_ms is None else max(0, first_changed_ms - key_ms),
                "changed_pixels": changed_count,
                "max_changed_pixels": max_changed_count,
                "max_changed_frame_ms": max_changed_ms,
            }
        )
        if args.reset_between_samples:
            send_key("BackSpace")
            time.sleep(reset_settle_seconds)
        else:
            time.sleep(0.02)

    latencies = [sample["latency_ms"] for sample in samples if sample["latency_ms"] is not None]
    report = {
        "method": "xlib_get_image_after_each_key",
        "width": args.width,
        "height": args.height,
        "bytes_per_pixel": bytes_per_pixel,
        "channel_threshold": channel_threshold,
        "changed_pixel_threshold": changed_pixel_threshold,
        "sample_count": len(latencies),
        "samples": samples,
    }
    if latencies:
        report.update(
            {
                "p50_ms": percentile(latencies, 50),
                "p95_ms": percentile(latencies, 95),
                "p99_ms": percentile(latencies, 99),
                "max_ms": max(latencies),
            }
        )

    Path(args.report).write_text(json.dumps(report, indent=2))
    if args.debug_prefix and debug_first_frame:
        image_from_xdata(debug_first_frame, args.width, args.height, bytes_per_pixel).save(
            f"{args.debug_prefix}-first.png"
        )
    if args.debug_prefix and debug_last_frame:
        image_from_xdata(debug_last_frame, args.width, args.height, bytes_per_pixel).save(
            f"{args.debug_prefix}-last.png"
        )

    required_samples = min(len(args.chars), max(5, len(args.chars) // 2))
    if len(latencies) < required_samples:
        print(
            f"Only {len(latencies)} of {len(args.chars)} key events produced a visible pixel-change sample.",
            file=sys.stderr,
        )
        return 1

    print(
        "Native VTE external pixel latency: "
        f"samples={len(latencies)} "
        f"p50={report['p50_ms']:.1f}ms "
        f"p95={report['p95_ms']:.1f}ms "
        f"p99={report['p99_ms']:.1f}ms "
        f"max={report['max_ms']:.1f}ms "
        f"report={args.report}"
    )
    if report["p95_ms"] > args.p95_limit_ms:
        print(
            f"Native VTE external pixel p95 {report['p95_ms']:.1f}ms exceeds {args.p95_limit_ms:.1f}ms.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
