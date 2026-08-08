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
- [x] A local release build produced both Linux artifacts for x86-64:
  `TermFleet_0.1.0_amd64.AppImage` and `TermFleet_0.1.0_amd64.deb`.
- [x] The AppImage is an executable ELF image and responds to its AppImage
  runtime help command.
- [x] The Debian artifact is a Debian binary package in format 2.0.
- [x] Local artifact hashes were recorded during the build audit:
  - AppImage: `33c3085a46baf1b1db59f983c87df4b0c9aec3d3e4afc70be35b897934ed4daf`
  - Debian: `10158f316f2a66acfa758f10f818cb3e00425280f6be21780194ee96bd4cc650`
- [x] The installed dock release and restart smoke checks pass on the current
  Linux workstation.

## Blocking before publication

- [x] Finish and commit the task-label identity change set. Completed checklist
  items no longer become durable goals, status-sidecar user goals outrank live
  todo steps, and supervised meta-process labels fall back to `No task declared`.
  The focused task-label suite and canonical task-line gate are green.
- [ ] Resolve the separate shared-worktree guardrail/launcher workstream before
  publishing. Seven files remain modified outside the task-label commits; review
  and commit them as their own coherent change set, or restore only after their
  owner confirms they are not release work.
- [ ] Re-run the full release gate from the final commit, including the live
  desktop checks; the live reliability wrapper has previously hit the five-minute
  orchestration timeout and must not be reported as a pass without its constituent
  results.
- [ ] Build the final tagged artifacts in clean CI and publish `SHA256SUMS.txt`
  beside them. The local artifacts above are evidence, not the public release.
- [ ] Test installation and first launch from a clean Linux environment for both
  formats, including the documented WebKitGTK runtime dependency boundary.

## Release policy decisions

- [ ] Keep this first release explicitly Linux-only and preview-quality.
- [ ] Label artifacts unsigned unless Linux signing is added and verified.
- [ ] Choose and document the public version/tag, release notes, support matrix,
  and rollback path before pushing the tag.
