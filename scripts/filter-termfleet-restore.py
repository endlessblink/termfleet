#!/usr/bin/env python3
"""Remove explicitly closed workspaces from the startup restore manifest."""

from __future__ import annotations

import json
import os
import sys
import tomllib
from pathlib import Path


def filter_manifest(source: Path, workspace: Path, output: Path) -> list[str]:
    try:
        with workspace.open("rb") as handle:
            saved = json.load(handle)
        with source.open("rb") as handle:
            manifest = tomllib.load(handle)
    except (OSError, ValueError, tomllib.TOMLDecodeError):
        return []

    suppressed = {
        os.path.realpath(str(target["cwd"]))
        for target in saved.get("closedRestoreTargets", [])
        if isinstance(target, dict) and str(target.get("cwd", "")).strip()
    }
    represented = {
        os.path.realpath(str(tab["initialCwd"]))
        for tab in saved.get("tabs", [])
        if isinstance(tab, dict) and str(tab.get("initialCwd", "")).strip()
    }
    suppressed |= represented
    entries = []
    for entry in manifest.get("session", []):
        cwd = os.path.realpath(os.path.expanduser(str(entry.get("cwd", ""))))
        if cwd not in suppressed:
            entries.append(entry)

    try:
        with output.open("w", encoding="utf-8") as handle:
            handle.write("# Generated for this startup; already-owned and explicitly closed workspaces are suppressed.\n")
            for entry in entries:
                handle.write("\n[[session]]\n")
                for key in ("name", "cwd", "agent", "host", "pin"):
                    if key in entry:
                        value = json.dumps(str(entry[key]), ensure_ascii=False)
                        handle.write(f"{key} = {value}\n")
    except OSError:
        return []
    return [str(entry.get("name", "")) for entry in manifest.get("session", []) if entry not in entries]


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: filter-termfleet-restore.py MANIFEST WORKSPACE OUTPUT", file=sys.stderr)
        return 2
    filter_manifest(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
