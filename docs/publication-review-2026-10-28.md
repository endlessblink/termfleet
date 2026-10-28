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
The design ratchet fails on existing style violations in the reviewed snapshot:
hex colors, small/off-scale fonts, numeric stacking levels, missing outline
replacements, raw RGB colors and literal shadows. Its baseline is unchanged.
Broader isolated tests and Rust checks must be read before merging.

This PR is a draft, not a release. It does not establish installed-runtime,
phone-behavior or measured-token-savings acceptance. Merge remains pending
required checks and any resulting corrections.
