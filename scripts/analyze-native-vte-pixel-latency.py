#!/usr/bin/env python3
import json
import math
import subprocess
import sys
from pathlib import Path


def parse_ratio(value: str) -> float:
    if "/" not in value:
        return float(value)
    numerator, denominator = value.split("/", 1)
    return float(numerator) / float(denominator)


def percentile(values: list[float], p: float) -> float:
    if not values:
        raise ValueError("cannot calculate percentile for empty values")
    ordered = sorted(values)
    index = min(len(ordered) - 1, math.ceil((p / 100) * len(ordered)) - 1)
    return ordered[index]


def video_info(video_path: Path) -> tuple[int, int]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "json",
            str(video_path),
        ],
        check=True,
        text=True,
        capture_output=True,
    )
    stream = json.loads(result.stdout)["streams"][0]
    return int(stream["width"]), int(stream["height"])


def frame_changed(
    baseline: bytes,
    current: bytes,
    channel_threshold: int,
    changed_pixel_threshold: int,
) -> tuple[bool, int]:
    changed = 0
    for index in range(0, len(current), 3):
        if (
            abs(current[index] - baseline[index]) > channel_threshold
            or abs(current[index + 1] - baseline[index + 1]) > channel_threshold
            or abs(current[index + 2] - baseline[index + 2]) > channel_threshold
        ):
            changed += 1
            if changed >= changed_pixel_threshold:
                return True, changed
    return False, changed


def main() -> int:
    if len(sys.argv) != 7:
        print(
            "usage: analyze-native-vte-pixel-latency.py <video> <timestamps.jsonl> "
            "<capture_start_epoch_ms> <capture_fps> <p95_limit_ms> <report_json>",
            file=sys.stderr,
        )
        return 2

    video_path = Path(sys.argv[1])
    timestamps_path = Path(sys.argv[2])
    capture_start_ms = int(sys.argv[3])
    fps = float(sys.argv[4])
    p95_limit_ms = float(sys.argv[5])
    report_path = Path(sys.argv[6])

    width, height = video_info(video_path)
    frame_size = width * height * 3
    frame_ms = 1000.0 / fps
    channel_threshold = 18
    changed_pixel_threshold = max(8, int(width * height * 0.00003))

    key_events = [
        json.loads(line)
        for line in timestamps_path.read_text().splitlines()
        if line.strip()
    ]
    if not key_events:
        print("No key timestamps recorded.", file=sys.stderr)
        return 1

    frames: list[bytes] = []
    ffmpeg = subprocess.Popen(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ],
        stdout=subprocess.PIPE,
    )
    assert ffmpeg.stdout is not None
    while True:
        frame = ffmpeg.stdout.read(frame_size)
        if not frame:
            break
        if len(frame) != frame_size:
            print("Encountered truncated video frame.", file=sys.stderr)
            return 1
        frames.append(frame)
    if ffmpeg.wait() != 0:
        print("ffmpeg failed while decoding latency video.", file=sys.stderr)
        return 1
    if not frames:
        print("No frames decoded from latency video.", file=sys.stderr)
        return 1

    samples = []
    for event_index, event in enumerate(key_events):
        key_ms = int(event["epochMs"])
        key_offset_ms = key_ms - capture_start_ms
        baseline_index = max(0, min(len(frames) - 1, math.floor(key_offset_ms / frame_ms) - 1))
        scan_start_index = max(0, min(len(frames) - 1, math.floor(key_offset_ms / frame_ms)))
        if event_index + 1 < len(key_events):
            next_key_offset_ms = int(key_events[event_index + 1]["epochMs"]) - capture_start_ms
            scan_end_index = min(
                len(frames) - 1,
                max(scan_start_index, math.ceil(next_key_offset_ms / frame_ms) - 1),
            )
        else:
            scan_end_index = min(
                len(frames) - 1,
                scan_start_index + max(1, math.ceil(140 / frame_ms)),
            )

        baseline = frames[baseline_index]
        first_changed = None
        first_changed_pixels = 0
        for frame_index in range(scan_start_index, scan_end_index + 1):
            changed, changed_pixels = frame_changed(
                baseline,
                frames[frame_index],
                channel_threshold,
                changed_pixel_threshold,
            )
            if changed:
                first_changed = frame_index
                first_changed_pixels = changed_pixels
                break

        if first_changed is None:
            samples.append(
                {
                    "char": event["char"],
                    "key_offset_ms": key_offset_ms,
                    "latency_ms": None,
                    "baseline_frame": baseline_index,
                    "scan_start_frame": scan_start_index,
                    "scan_end_frame": scan_end_index,
                    "changed_pixels": 0,
                }
            )
            continue

        first_change_ms = first_changed * frame_ms
        samples.append(
            {
                "char": event["char"],
                "key_offset_ms": key_offset_ms,
                "latency_ms": max(0.0, first_change_ms - key_offset_ms),
                "baseline_frame": baseline_index,
                "first_changed_frame": first_changed,
                "changed_pixels": first_changed_pixels,
            }
        )

    latencies = [sample["latency_ms"] for sample in samples if sample["latency_ms"] is not None]
    if len(latencies) < max(5, len(samples) // 2):
        print(
            f"Only {len(latencies)} of {len(samples)} key events produced a visible pixel-change sample.",
            file=sys.stderr,
        )
        report_path.write_text(json.dumps({"samples": samples}, indent=2))
        return 1

    report = {
        "video": str(video_path),
        "timestamps": str(timestamps_path),
        "width": width,
        "height": height,
        "fps": fps,
        "frame_ms": frame_ms,
        "channel_threshold": channel_threshold,
        "changed_pixel_threshold": changed_pixel_threshold,
        "sample_count": len(latencies),
        "p50_ms": percentile(latencies, 50),
        "p95_ms": percentile(latencies, 95),
        "p99_ms": percentile(latencies, 99),
        "max_ms": max(latencies),
        "samples": samples,
    }
    report_path.write_text(json.dumps(report, indent=2))

    print(
        "Native VTE external pixel latency: "
        f"samples={report['sample_count']} "
        f"fps={fps:.2f} frame_ms={frame_ms:.2f} "
        f"p50={report['p50_ms']:.1f}ms "
        f"p95={report['p95_ms']:.1f}ms "
        f"p99={report['p99_ms']:.1f}ms "
        f"max={report['max_ms']:.1f}ms "
        f"report={report_path}"
    )
    if report["p95_ms"] > p95_limit_ms:
        print(
            f"Native VTE external pixel p95 {report['p95_ms']:.1f}ms exceeds {p95_limit_ms:.1f}ms.",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
