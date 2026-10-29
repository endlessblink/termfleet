# Publication review: in progress

This candidate is a sanitized snapshot of reviewed source `74eb005` plus a
launcher placement fixture correction. It is based on GitHub main `a772f7f`.
Original local history and unrelated dirty work are preserved separately.
Newer concurrent source changes are outside this reviewed snapshot.

## Preparation

- Personal paths and private network hosts are replaced in documentation.
- Private workspace units use an operator-owned environment file. Installed
  services are unchanged; the examples require local configuration.
- The scorecard uses the current repository and requires an explicit bot ID.
- Synthetic UI and Rust fixture paths use portable example locations.
- The placement fixture uses a permitted provider and preserves launch guards.
- Independent index review found all reference paths intact, no file deletions,
  and no personal paths, personal private-network host or recognized secret
  markers in newly published lines. This is not a comprehensive entropy scan.

## Checks

Build and focused tests passed during preparation. Public audit, machine-path,
OSS-readiness, map, terminal-rendering and typography gates passed after cleanup.
The first remote CI run failed Rust dead-code warnings and five canvas tests.
The follow-up preserves the dormant native source/document guards with precise
expectations on the two enrollment entrypoints. All five native operations now
have an empty-catalog refusal regression; trusted enrollment remains unavailable.
The unchanged warnings gate passes, and the isolated Rust library suite passes
265 tests, with four ignored.

Canvas test repairs use rendered state and measured remaining pane space instead
of obsolete source strings and header-height assumptions. A new geometry check
reproduced a two-pixel terminal-body jump on longer summary text; line-height
based reserved space fixes it. The initial 105-case run passed 103 cases; two
test defects were corrected and each passed three subsequent repetitions. This
is not a single final 105-case green run; remote CI must confirm the final commit.

Exact-value palette, typography, separator, background and stacking tokens bring
the design ratchet below its existing ceilings; neither gate nor baseline was
relaxed. Board keyboard controls gain the canonical outline while retaining
their previous shadow. A focused keyboard regression is included in CI.
The final design command passes all 67 checks, including keyboard focus.

Two prompt lifecycle fixtures now provide explicit readable screen observations
for positive transitions, while retaining unknown-screen refusal. Both failed
before correction; all 34 tests in those two files pass afterward, including
new missing/mismatched-permission refusals. Production permission checks did not
change.

The broader Node run produced 1,089 passes, 79 failures and four skips. Its
isolated harness overrode per-test request directories and treated this temporary
checkout as disposable scratch; two failures pass after correcting those
conditions. Browser fixtures returned JSON for a newly imported JavaScript
asset, preventing their app from loading. A shared helper now serves only that
exact real asset with its JavaScript content type; API fixtures and behavioral
assertions remain intact. The affected 57-test coverage has 54 unique passes,
including three screenshot cases repeated with corrected isolated output mounts.
Three failures remain: a dictation menu interaction and two touch-target size
contracts. These results require further reconciliation, not an unqualified
product-failure or success claim.

This PR is a draft, not a release. It does not establish installed-runtime,
phone-behavior or measured-token-savings acceptance. Merge remains pending
required checks and any resulting corrections.

## 2026-10-29 merge follow-up

GitHub CI run40740432039 passed both jobs for exact published head00a2eb0. Current GitHub maina772f7f remains its ancestor; no whole-file deletions or diff-check errors were found. Original owner commit/push/merge authorization was verified, and the installed-release owner acknowledged GitHub-only integration without changing the frozen runtime.

Fresh isolated checks cleared the earlier dictation concern but reproduced the44px mobile target failure on both published head and current main. A minimal layout repair restores the targets while retaining the existing compact<=46px tab wrapper, keeps Close visible and reserves header height, and constrains the folder form grid without hiding overflow. New search-collapse and header-bounds guards failed before repair. Existing assertions remain intact; all four affected browser suites are now in CI.

Final local checks: affected CI command11/11; related navigation/picker/theme8/8; chat navigation4/4; dictation/day/conversation/details9/9; canonical mobile parity31/31; TypeScript/Vite build, design ratchet, public audit and machine-path checks pass. Independent source review approves the repair delta; independent synthetic visual review confirms fleet/header layout at320/1280 and folder horizontal containment. Real isolated dialog create/edit interactions pass. This does not supersede the earlier broader Node-suite limitations or establish installed/physical-phone delivery. Exact resulting-head CI and merge read-back remain the final GitHub gates.
