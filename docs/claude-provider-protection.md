# Claude launch protection and the credential boundary

Owner requirements: R-19266–R-19268 and R-19277–R-19279. Implementation is tracked
by TF-124 and the external agent-ops BUG-88. This document describes boundaries;
task status belongs to those systems.

## Required behavior

Automatic work uses Codex. Claude requires an explicit, verified owner proposal;
agent-written task text, provider flags, environment variables, memory, and
forwarded prose cannot authorize it. At subscription usage **85% or higher** in
either the five-hour or weekly window, the block persists until fresh provider
data confirms that particular window reset. A predicted reset time passing is
insufficient. Unknown, stale, invalid, partial, or future-dated usage denies Claude.

The current standing owner rule denies every Claude launch. No exception-grant
endpoint exists yet. This is deliberately stricter than accepting an unverifiable
approval; it does not fulfill the eventual protected owner-exception requirement.

## What the current checks enforce

`scripts/lib/provider-launch-policy.mjs` checks actual child publication, team
creation, bot subprocesses, side responders, the web spawn route, and the provider
adapter. Explicit denials include an error and a durable audit entry. Quota uses
raw percentages, a separate latch for each window, atomic persistence, and
concurrent-request exclusion. Codex does not depend on Claude policy storage.

The Rust common PTY creation boundary also rejects recognized Claude commands
after restart/resume resolution and before opening a PTY. Existing live session
reattach returns before that check. The check is effective only in a daemon that
actually loaded the new binary. Promoting a release does not update an existing
daemon; do not stop an operator's daemon to manufacture proof.

Owner diagnostics are available through authenticated `/api/provider-policy`
after the bridge loads this implementation. The response reports the loaded
policy hash, denied decisions, quota state, and explicitly reports
`credentialIsolation: false`. It never exposes provider credentials or prompts.

## What these checks cannot enforce

They are cooperative program checks. The desktop account owns the editable
checkout and provider executable, and its agent processes share that Unix UID.
Agents with access to the provider's credential store can use an absolute binary,
another copy, an alias, another interpreter, or a direct network client; they can
also modify same-user policy or audit files. A shell recognizer, wrapper, hook,
read-only source file, or local HMAC record cannot eliminate that authority.

The current Rust recognizer covers leading Claude commands, absolute Claude
paths, `exec`, and simple environment assignments. It does not parse arbitrary
shell programs, aliases, renamed executables, or nested interpreters. The policy
file is not a credential firewall. Do not report all-route impossibility from
these checks, tests, an installed file, or an unauthenticated HTTP denial.

Existing signed owner-words receipts prove attribution within the current
application trust model. Their same-account storage and broad message scope do
not constitute a protected, single-use launch authorization.

## Concrete protected migration to review

This is the necessary next security boundary, not an already installed service.
It requires owner authorization before moving credentials, changing identities,
revoking sessions, restricting networking, or interrupting existing work.

1. Create a dedicated unprivileged **agent execution identity** and separate
   **provider transport identity**. Keep the owner desktop identity separate.
   Agents must not share the desktop session bus, authentication helpers, home,
   credential files, writable executable directories, or provider process memory.
   Restrict ptrace, `/proc` access and cross-identity signals. A container retaining
   the host UID, mounted credentials, writable host sockets, or a privileged
   container-management socket does not provide this boundary.
2. Install a root-owned broker implementation and policy under `/usr/libexec` and
   `/etc/termfleet/provider-policy`; keep authoritative usage, consumed grants,
   quota latches and audit under `/var/lib/termfleet-provider`. Only the broker
   service may write that state. An agent-writable source import, service unit,
   `PATH`, configuration override or deployment helper must not replace it.
3. Put provider credentials only in the provider transport identity's private
   store. Do not pass tokens, login files, inherited secret environment variables,
   or token-bearing errors into the agent sandbox. The transport must not expose
   arbitrary file reads, shell execution, configurable subprocesses, unrestricted
   proxying, or environment injection under its credential-bearing identity.
   Provider-native tools must run under the agent identity through a narrow tool
   boundary; running Claude with unrestricted Bash under the credential identity
   would immediately reintroduce the leak.
4. Deny direct provider access from the agent identity, including alternate
   binaries, SDKs, copied credentials, login refresh helpers and unbrokered egress.
   The only provider transport is the broker's fixed operation protocol. Keep
   ordinary approved development networking available through reviewed routes;
   do not deploy a machine-wide network restriction as an incidental fix.
5. Authenticate callers with OS peer credentials, not a claimed UID in JSON.
   Accept structured provider operations, not arbitrary command strings. Bind
   launch to exact provider, owning pane, task/context digest, operation ID and
   executable profile. The broker checks policy immediately before the effect;
   restart, resume, fallback, UI/API and helper paths use the same operation.
6. Register owner authorization outside agent reach. The current loopback embed
   login is insufficient: local callers can obtain that application session.
   A new grant must require owner user presence, for example a separate protected
   WebAuthn/passkey approval surface with verified origin/challenge. A forwarded
   statement or an existing application cookie alone is not a grant.
7. Persist each grant with exact operation/pane/provider/digest, expiry and random
   single-use nonce. Atomically consume it with the launch reservation. Grant
   replay, changed scope, an older approval, concurrent use or service restart
   cannot produce a second launch. Any exception above the threshold must
   explicitly authorize that quota exception; a routine Claude proposal cannot
   silently authorize credits, paid API usage or a different task.
8. Have the protected transport obtain subscription usage through an approved
   non-billable provider mechanism. Treat the existing agent-writable status-line
   cache only as a conservative reason to block, never as authority to allow.
   Latch threshold observations during ingestion as well as at launch; a missed
   poll or a later lower same-window reading cannot erase a crossing. Fresh
   post-reset data must confirm a later reset window before clearing each latch.
9. Write broker decisions and exceptions to a durable, owner-readable audit with
   operation identity and reason, without prompts or secrets. Policy service,
   usage source, storage or audit failure denies Claude. Surface denial to the
   requesting agent and owner; do not conceal it with a fallback or a success
   card. An ordinary new Codex task remains available.

## Migration and rollback gates

Before any host changes, inventory file ownership and access metadata without
opening credentials; identify every active credential-bearing process and its
launch owner. Review the identity, filesystem, tool delegation and network plan
with the owner. Build and test it in an isolated fixture first. Do not transfer
the existing live credential store, revoke sessions, restart the daemon or
change existing agents' identities without approval of that concrete migration.

Start with a new disposable agent identity with **no credentials** and a fake
provider. Verify compatibility and approved development access before moving real
work. Keep existing sessions intact until an approved cutover. Full all-route
protection cannot be claimed while older credential-capable agents continue to
run outside the boundary. Rollback must return to explicit Claude denial; it
must not restore unrestricted credential access or silently resume Claude.

## Falsifiable acceptance checks

- At84.9 quota alone is below threshold; at85 and above each affected window
  latches. Standing owner-only policy independently denies all unapproved starts.
- Missing/stale data, a passed reset timestamp, malformed state, restart, concurrent
  requests or a same-window lower reading never clears protection. Fresh data
  after the recorded reset with a later window can clear only that window.
- Agent flags, environment overrides, edited local files, forged owner prose,
  old application sessions, absolute binaries, copied/renamed binaries, aliases,
  direct SDK calls and attempted token reads cannot produce a provider request
  from the isolated identity. Test with a fake provider and a request counter.
- A valid owner grant permits exactly its one approved operation; replay, changed
  provider/pane/digest, expiry and concurrent consumption deny with durable audit.
- Kill/restart the isolated broker during reservation and during launch. No
  duplicate or unrecorded launch occurs. Never perform this trial on live owner
  terminal sessions.
- Query the loaded runtime's implementation identity and owner-visible audit,
  then attempt a denied operation and verify zero provider requests and no new
  terminal. Tests of wrappers alone satisfy only cooperative-route coverage.

The protected migration remains a required piece of the owner's all-route
requirement. It must not be replaced by a memory entry or marked complete from
the cooperative launch tests.
