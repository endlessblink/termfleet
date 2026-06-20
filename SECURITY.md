# Security Policy

## Supported versions

TermFleet is in active Linux-first preview. Security fixes are made against the
latest `main` and the most recent tagged release only.

| Version            | Supported |
| ------------------ | --------- |
| latest `main`      | ✅        |
| latest tagged `v*` | ✅        |
| older tags         | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report privately through GitHub's coordinated disclosure:

1. Go to the repository's **Security** tab → **Report a vulnerability**
   (GitHub Private Vulnerability Reporting), or
2. Email the maintainer at **endlessblink@gmail.com** with the subject
   `TermFleet security: <short summary>`.

Please include:

- affected version / commit,
- a description and impact assessment,
- reproduction steps or a proof of concept,
- any relevant logs (redacted — see below).

When sharing repro context, use `npm run evidence:bundle`, which redacts common
token-shaped secrets and machine-local absolute paths before export. Do not
include real secrets, credentials, or proprietary terminal output.

### Response targets

- Acknowledgement within **3 business days**.
- An initial assessment and severity within **10 business days**.
- Coordinated disclosure once a fix or mitigation is available. Credit is given
  to reporters who request it.

## Security model

TermFleet is local-first. Its trust boundary is the local user account:

- The PTY daemon listens only on a **user-local Unix socket** in a `0700`
  user-owned directory; the socket inode is `0600` and connections are rejected
  unless the peer uid matches the daemon's own uid (`SO_PEERCRED`). There is no
  network listener.
- The daemon owns PTYs independently of the UI; only an explicit close, an
  incompatible protocol, or the OS destroys a session.
- Transport/IPC errors are never written into the terminal buffer.

### Known limitations (not vulnerabilities)

- After a full reboot, running processes are not resurrected — only terminal
  content (last ~200 KB of scrollback) and cwd/size are restored.
- RTL/Hebrew PTY shaping is best-effort (TC-018 is deferred).

These are documented in the README's Limitations section.
