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

    # A directory is not a terminal identity: multiple independent panes can
    # legitimately share it. Match the provider manifest by stable human label
    # plus CWD, and ignore legacy cwd-only tombstones rather than deleting a
    # sibling terminal by accident.
    closed = {
        (
            os.path.realpath(str(target["cwd"])),
            str(target.get("title", "")).strip(),
            str(target.get("providerName", "")).strip(),
        )
        for target in saved.get("closedRestoreTargets", [])
        if isinstance(target, dict)
        and str(target.get("cwd", "")).strip()
        and str(target.get("title", "")).strip()
    }
    restore_represented_tabs = os.environ.get("TERMFLEET_EXTERNAL_RESTORE") == "1"
    represented = set()
    if not restore_represented_tabs:
        represented = {
            (
                os.path.realpath(str(tab["initialCwd"])),
                str(tab.get("title", "")).strip(),
                str(tab.get("restoreName", "")).strip(),
            )
            for tab in saved.get("tabs", [])
            if isinstance(tab, dict)
            and str(tab.get("initialCwd", "")).strip()
            and str(tab.get("title", "")).strip()
        }
    suppressed = closed | represented
    # When dock startup restore is active, represented tabs still need their
    # provider sessions relaunched in place. Explicit close tombstones remain
    # authoritative; represented-tab suppression is only for non-restore reuse.
    closed_cwds = {cwd for cwd, _title, _provider_name in closed}
    represented_cwds = {cwd for cwd, _title, _restore_name in represented}
    closed_provider_names = {
        (cwd, provider_name)
        for cwd, _title, provider_name in closed
        if provider_name
    }
    represented_provider_names = {
        (cwd, restore_name)
        for cwd, _title, restore_name in represented
        if restore_name
    }
    manifest_cwd_counts = {}
    for entry in manifest.get("session", []):
        entry_cwd = os.path.realpath(os.path.expanduser(str(entry.get("cwd", ""))))
        manifest_cwd_counts[entry_cwd] = manifest_cwd_counts.get(entry_cwd, 0) + 1
    entries = []
    for entry in manifest.get("session", []):
        cwd = os.path.realpath(os.path.expanduser(str(entry.get("cwd", ""))))
        name = str(entry.get("name", "")).strip()
        identity = (cwd, name, "")
        provider_identity = (cwd, name)
        if (
            provider_identity not in closed_provider_names
            and identity not in suppressed
            and provider_identity not in represented_provider_names
            and not (
            cwd in closed_cwds
            and cwd not in represented_cwds
            and manifest_cwd_counts.get(cwd, 0) == 1
            )
        ):
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
