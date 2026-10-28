# TC-201 — approved reconciliation of the final checkout

User approval covers reviewed integration, recoverable archiving, tests and installation while preserving the canonical daemon and all live sessions. No push, history rewrite or daemon restart is part of this work.

## Review decisions

| Remaining item | Decision and reason |
| --- | --- |
| `MASTER_PLAN.md` | Keep historical TF-073/TF-018 proof and TC-199/200 backlog; preserve open acceptance items. Add fresh TC-201 evidence. |
| `docs/issue-registry.json` | Keep semantic TF-075 evidence and the TF-076 record already associated with committed fixes. Retain unresolved lifecycle states; historical evidence is not fresh runtime acceptance. Other escaped/unescaped Unicode differences are semantically identical. |
| `docs/reviews/` | Keep the five dated project audits and their scope/limitations. They supply backlog and TC-199 reproduction evidence. |
| `tests/command-bar-focus.spec.ts` | Keep both guards for already committed explicit command intent and map-card input focus; source-contract coverage only. |
| `src/App.tsx` + `src/lib/focusTrace.ts` | Archive the local prototype and App patch; restore committed App. The prototype globally patches HTMLElement.focus, installs permanent listeners/100ms interval, and adds unverified automatic recovery. The accepted watchdog release did not include it. |
| `scripts/verify-clipboard-paste.sh` | Archive the proposed restoration patch and keep committed script. The patch explicitly loses non-text clipboard data and cannot support its promise of always restoring the user's clipboard. Production clipboard verification is not run in this reconciliation. |
| Two modified TC-008/009 PNGs | Archive generated variants and retain committed evidence. `terminal-user-flows.spec.ts` writes these screenshots; there is no reviewed golden-image update to silently accept. |
| `tests/scratch-eval.spec.ts` | Archive local diagnostic; it reads real operator workspace data and asserts current approvals exist, making it unsuitable as an ordinary regression. |
| `.kilo/` | Archive local assistant settings/commands, including ignored `.gitignore`; no app runtime depends on them. |
| Three root `HANDOFF-*.md` files | Archive historical session handoffs; their useful source changes are already committed and relevant dated reports are retained. Their old live PIDs/next actions are not current instructions. |

## Recovery proof

`/opt/example/local-path`

Every one of the21 original changed/untracked files is preserved under `files/` with SHA-256, file mode and mtime in `manifest.json`; binary diff, index diff, refs and a full Git bundle are also retained. Archived untracked originals are under `retired/`. All hashes were reverified before and after mutation; staged index and HEAD were checked first. No source was hidden in a stash or discarded. Earlier inactive-checkout PNG variants and candidate frontend provenance remain in the separate 20261004T090849Z recovery archive.

The historical `release/public-preview-preparation` v0.1.2 branch retains its unique commit and licensing/packaging files in Git and the bundle. It is not merged into v0.2.2 blindly or deleted. Retaining historical refs does not create another working checkout.

## Verification

- Focus/handover/user-word suite:12 passed in host context using private fixture sessions/proc/data. One sandbox run had an empty child stderr; the unchanged failed case and complete suite pass on host. No real provider was spawned.
- `npm run verify:cockpit-heartbeat`:37 Python guards and2 frontend timer/retry cases passed.
- `npm run verify:map-terminals`, `npm run verify:terminal-rendering`:passed.
- `npm run issues -- check`:76 issue records and5 failure surfaces valid.
- Focused Cargo heartbeat tests pass2/2. The unified production build/install/live acceptance are the next gates. Do not mark TC-201 complete until installed/running/shared target hashes match, doctor passes, the original PTY IDs/PIDs and daemon survive, and one registered checkout has an empty status.

## Completed acceptance — 2026-10-04

release `b4ecac5f18ea-9e0b177f1906-9b58af6507ab`; source `b4ecac5f18ea18e57dfb62c0bde456c022e2ee96`; UI4142165; binary SHA256 `9e0b177f190608ff7a07023761079ae48ef191e05aa7b6a7a441f079758b7522`; watchdog4133321; daemon18932; all32 original PTY IDs/PIDs preserved. Canonical installer/frontend/optimized Rust build passes; actual target/install/running checksums match. Host doctor returns DOCTOR_OK; selected release manifest matches its clean source commit. UI remains alive with a fresh heartbeat past180s startup grace and current watchdog inode/hash. All32 before-install PTY IDs/PIDs and the daemon survive unchanged. Actual window screenshot inspected; current snapshot13 map entries match live daemon IDs with reconnected status.

All focused guards, Cargo tests/check, source verifiers, issue validation and diff checks pass. One registered checkout; all relevant retained work committed and original experiments/local artifacts independently recoverable. The final evidence-only receipt commit follows installed source b4ecac5; it changes no runtime, test or build input. Therefore the manifest honestly retains b4ecac5 as compiled source, while the final checkout also contains its acceptance receipt. No push/publication occurred.
