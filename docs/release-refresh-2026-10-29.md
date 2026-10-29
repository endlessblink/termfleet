# Desktop release refresh — 2026-10-29

Status: in_progress (TF-012).

The owner reported `Current release build: release build predates the frontend
build by 15h ago`. Baseline doctor reproduced it. The immutable installed
binary passed its own checksum, but `npm run verify:installed-release` rejected
its frontend checksum against the newer local build. These are distinct checks.
The compatible older keeper was retained; no keeper restart is required to
refresh the installed desktop candidate.

Candidate: use the existing checksum-driven installer to rebuild frontend,
embed that completed tree with direct Cargo, atomically promote an immutable
release, and verify its binary, frontend and resource inventories. This should
clear the stale-build failure; any remaining checksum mismatch falsifies it.
Do not change doctor to ignore a stale build or touch timestamps to hide it.

Baseline release/doctor tests: 31 tests, 7 failures and 4 errors. Diagnosis found
outdated fixtures/source assertions: omitted resource inventories, retired
Tauri CLI double-build ordering, redirected desktop startup, changed truthful
restart labels, and a historical handoff treated as current launch policy.
Repair tests against current behavior while preserving rejection and rollback
guards. Production code is unchanged.

Acceptance: focused release tests; frontend/typecheck; locked-runtime WebKit
boot; installer; installed checksum readback; doctor; actual installed desktop
under disposable Xvfb with isolated profile/daemon and fake providers. Never
launch onto the owner's desktop without the required button approval. Preserve
the live keeper and conversations.

Pre-install verification passed: `python3 -m unittest
tests.test_installed_release tests.test_doctor_ownership` (32/32), Python
compilation of the changed test, `npm run build`, private `xvfb-run -a python3
scripts/verify-boot-smoke.py` (mounted, no errors), and `git diff --check`.
The fixture now stages actual resource receipts and rejects resource tampering;
the rollback test proves it reaches deliberate post-promotion failure before
asserting restoration. No production guard was relaxed.

First promotion completed, but standalone checksum verification exposed a real
environment-dependent defect: producer and verifier use locale-sensitive `sort`.
The unchanged frontend produced different hashes in the installer and subsequent
shell environments. Candidate: use `LC_ALL=C sort -z` in both frontend hash
pipelines. Preserve the exact files and checksum algorithm; normalize only byte
ordering. A cross-locale fixture must fail before this change and pass afterward,
while a changed asset must still fail. The first promotion is not final acceptance.

Red observed with unchanged mixed-case/non-ASCII asset fixtures under installed
en_US.UTF-8/en_US.utf8 locales; C and C.UTF-8 passed. Two production hash lines
now force byte ordering. Release/doctor suite passes 34/34 afterward, including
cross-locale verification and changed-file rejection; shell syntax passes.

Final promotion: reviewed 9a8a3a4, installed release
`9a8a3a4acc01-5388a973b7a3-3702182862a4-7b45e62702f5`, binary SHA256
`5388a973b7a35f3562f4679356d0e6295a9fdf6c989e2779d326eed4ea79ebce`.
Standalone `npm run verify:installed-release` passes. Doctor current-build and
installed-release checks pass; only older-running-window and keeper-age warnings
remain. Original app1506185 and keeper2068834 were preserved across promotion.

Actual installed private-Xvfb restart smoke started a real window, but failed its
legacy external restore step: the installed helper did not accept
`--termfleet-startup --ready-timeout 20`. This is not a passing restart/restore
claim. Evidence: `/tmp/termfleet-release-refresh-installed.log` and private
`/tmp/termfleet-release-refresh-proof`. Do not weaken that assertion or replace
the real helper with a fake success. The exact real-window reopen approval was
requested by button; pending. No owner-screen automation was performed.
