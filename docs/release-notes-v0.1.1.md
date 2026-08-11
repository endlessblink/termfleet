# TermFleet v0.1.1

TermFleet v0.1.1 is an unsigned Linux preview of the local-first terminal
operations cockpit. Publish it from the `v0.1.1` tag after the final CI release
workflow succeeds; the workflow creates an AppImage, a Debian package, and
`SHA256SUMS.txt`.

This patch release supersedes the unreleased local v0.1.0 candidate while
preserving the already-published v0.1.0 tag.

## Highlights

- Recoverable daemon-owned PTYs across app restart and cold restore.
- Headless-VT plus Canvas2D terminal rendering with split and map workspaces.
- Per-pane task identity and agent status summaries.
- Local-only Unix-socket terminal ownership and redaction-safe evidence bundles.
- Correct dock-installed release workflow and public README guidance.

## Support matrix

| Target | Status |
|---|---|
| Linux x86-64 | Supported preview target |
| Debian/Ubuntu with WebKitGTK 4.1, JavaScriptCoreGTK 4.1, and libsoup 3 | Supported runtime boundary |
| Linux ARM or other architectures | Not built by this release |
| macOS and Windows | Not supported |

The AppImage is intended for systems with the documented WebKitGTK runtime
dependencies available. The `.deb` expresses the Debian/Ubuntu packaging
boundary. Both artifacts are unsigned; verify the published checksum file before
installing.

The local Debian build was verified as a Debian format-2 package
(`7be7f2360e009569d31cd187bcc9f8d5014ff446c993810bf052b82a1961e23d`). The
AppImage checksum remains pending until the linuxdeploy bundling step completes.

## Known limitations

- This is a Linux-first preview, not a cross-platform release.
- Full BiDi/Hebrew nikud terminal shaping remains deferred.
- A reboot restores terminal content, cwd, and size, but cannot resurrect the
  processes that were running before the reboot.
- The browser review surface does not prove native PTY, WebKit, or desktop
  behavior; use the installed-release and live desktop checks for those claims.

## Rollback

The installer promotes immutable releases and keeps the previous release
available under `~/.local/share/termfleet/releases/`. If a published build is
bad, stop using the affected dock entry, restore the previous known-good release
symlink, and relaunch from the dock; do not delete the daemon runtime or its
session data.
