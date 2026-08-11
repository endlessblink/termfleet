# Public release checklist

This is the publication gate for the Linux-first TermFleet preview. A release is
publishable only when every blocking item is either checked or explicitly called
out in the release notes.

## Complete

- [x] Public repository metadata is present: Apache-2.0 license, security
  disclosure process, contribution guidance, code of conduct, and README
  recovery/install instructions.
- [x] `npm run verify:oss-readiness` passes.
- [x] `npm run verify:public-audit` passes.
- [x] The Tauri bundle targets are AppImage and Debian packages.
- [x] The release workflow passes bundle targets to Tauri using the supported
  `--bundles=appimage,deb` form.
- [ ] A local release build produced both Linux artifacts for x86-64:
  `TermFleet_0.1.1_amd64.AppImage` and `TermFleet_0.1.1_amd64.deb`. The Debian
  artifact is fresh; the AppImage helper stalled during linuxdeploy bundling.
- [ ] The AppImage is an executable ELF image and responds to its AppImage
  runtime help command.
- [x] The Debian artifact is a Debian binary package in format 2.0.
- [ ] Local artifact hashes were recorded for both publishable artifacts:
  - AppImage: pending successful linuxdeploy bundling.
  - Debian: `7be7f2360e009569d31cd187bcc9f8d5014ff446c993810bf052b82a1961e23d`
- [x] `npm ci` and `npm audit --audit-level=high` pass with zero vulnerabilities;
  the release keeps Excalidraw 0.18.1 and narrowly overrides its nested Nanoid
  copies to the patched 5.1.16 release.
- [x] The installed dock release and restart smoke checks pass on the current
  Linux workstation.

## Blocking before publication

- [x] Finish and commit the task-label identity change set. Completed checklist
  items no longer become durable goals, status-sidecar user goals outrank live
  todo steps, and supervised meta-process labels fall back to `What should change?`.
  The focused task-label suite and canonical task-line gate are green.
- [x] Resolve and commit the separate guardrail/launcher workstream; its focused
  Playwright, launcher/watchdog, and Rust platform checks are green.
- [ ] Re-run the full release gate from the final commit, including the live
  desktop checks; the live reliability wrapper has previously hit the five-minute
  orchestration timeout and must not be reported as a pass without its constituent
  results.
- [ ] Build the final tagged artifacts in clean CI and publish `SHA256SUMS.txt`
  beside them. The local artifacts above are evidence, not the public release.
- [ ] Test installation and first launch from a clean Linux environment for both
  formats, including the documented WebKitGTK runtime dependency boundary.

## Release policy decisions

- [x] Keep this first release explicitly Linux-only and preview-quality.
- [x] Label artifacts unsigned unless Linux signing is added and verified.
- [x] Choose and document the public version/tag, release notes, support matrix,
  and rollback path in `docs/release-notes-v0.1.1.md` before pushing the tag.
