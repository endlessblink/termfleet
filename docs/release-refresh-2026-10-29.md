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
