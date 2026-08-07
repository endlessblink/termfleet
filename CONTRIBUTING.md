# Contributing to TermFleet

TermFleet is accepting focused Linux preview contributions. Before opening a
change, check the current task board and describe the user-visible problem or
improvement.

## Development expectations

- Linux is the supported preview platform.
- Preserve daemon-owned PTYs, per-pane agent identity, Canvas2D desktop
  rendering, and no-optimistic-echo behavior.
- Add or update a focused regression when changing behavior.
- Keep unrelated worktree changes intact and avoid new dependencies unless the
  change includes a clear reason and compatibility evidence.

## Checks before submitting

```bash
npm ci
npm run verify:developer-preview
npm run verify:terminal-reliability
git diff --check
```

For desktop behavior, use the dock-installed release and report the Linux
distribution, desktop session, GPU/driver details when relevant, exact command,
and verification output.

## Pull requests and issues

Keep pull requests small and explain the behavior, regression coverage, and
remaining limitations. Do not include secrets, private paths, or proprietary
terminal output. Security issues belong in [`SECURITY.md`](SECURITY.md), not in
public issues.
