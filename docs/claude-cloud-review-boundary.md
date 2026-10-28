# Claude cloud review: financial and capability boundary

This is a concrete proposal for one bounded code review, not an authorization to
start it. No cloud session, upload, account change, payment, or live financial
verification has been performed. TermFleet's current all-Claude denial remains
in force. The frozen local review input is unchanged.

## What the documented account controls do

Anthropic says promotional credit applies automatically to eligible cloud
sessions and can be used while paid Usage credits are disabled. Once that credit
runs out, cloud usage falls back to included subscription limits. That is not a
documented bonus-only stop. The claim deadline was October 7, 2026; already
granted or claimed remaining credit expires November 4 at 11:59 PM PT. Account
eligibility and remaining balance have not been verified. Avoid Fable: on Pro it
requires Usage credits and can consume those after the bonus is exhausted.
[Official promotion rules](https://support.claude.com/en/articles/17152539-cloud-sessions-bonus-credit-promotion)

Paid Usage credits can be disabled in Settings > Usage. When enabled, they permit
pay-as-you-go continuation beyond included limits; auto-reload can buy additional
funds. A monthly cap bounds permitted spending and is different from the current
balance. A relayed screen reportedly showed a $0 balance and a $10 cap; that
account state has not been independently viewed or authenticated. Neither a $0
balance nor a $10 cap establishes a zero-spending permission boundary.
[Official Usage credits controls](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans)

## Proposed account configuration: owner action only

Before considering one explicitly authorized cloud review, the owner would check
the authenticated [Usage page](https://claude.ai/settings/usage) and confirm:

- Paid Usage credits are OFF, not merely unused or showing a zero balance.
- Auto-reload is OFF. No funds are added and no payment method is supplied to an
  agent. Do not enable credits to reveal or change a control.
- Any remaining cap is recorded accurately. Do not describe the reported $10 cap
  as zero. If a zero cap is offered, only the owner may set and verify it; support
  for that exact value has not been established here. A cap is supplementary to
  disabling paid credits and removing agent capability to alter settings.
- Existing, eligible, unexpired promotional balance is visible, with the correct
  account and observation time. Record only sanitized status, not cookies, account
  identifiers, payment details or credentials.
- The selected workload is an actual cloud session with Sonnet, not a local or
  Remote Control session, an API call, a Project, a Routine or an automatic fallback.
  No change of model, provider, billing mode or account is delegated to the agent.

These settings address paid continuation under the documented product rules.
They do not give an agent permission to open billing, payment, account-settings
or API-console surfaces. They also do not establish that only promotional credit
will be consumed: included subscription usage can follow bonus exhaustion.

If the requirement is strictly “consume bonus credit and stop before using any
included plan allowance,” do not start under the presently verified evidence.
A balance precheck or a promise to stop is not a hard limit for an in-flight
session. A supported, enforceable bonus-only cutoff would need to be established
first. No such control has been proven here; do not invent a CLI switch or treat
an API budget flag as a subscription-cloud spending boundary.

## Narrow execution capability: proposed, not implemented

Giving the model an authenticated browser, unrestricted shell, provider login,
cookie or token leaves it with broader account capabilities. A prompt saying
“do not spend” cannot remove those capabilities. The proposed boundary instead
places provider authentication in a separate owner-controlled broker, outside
the model's accessible process, filesystem, browser and network capabilities.

For this single review, the model-facing interface would expose only these typed
operations; it would expose no raw CLI, HTTP, browser or account-control proxy:

| Operation | Fixed input boundary | Typed output |
| --- | --- | --- |
| Submit one review | One owner-issued grant, fixed package digest and prompt digest, approved provider/model/cloud environment; no arbitrary command, path, URL or prompt | Accepted/rejected, one registered session ID, canonical result URL and timestamp |
| Read delivery receipt | That registered session ID only | Submission accepted/rejected, delivery timestamp and error code; never a claim that the review finished |
| Read review result | That same session ID only | Pending/complete/failed/unavailable, bounded findings text and provenance; no arbitrary navigation or tool invocation |

The grant must be single-use, expire, bind the exact package and task, and allow
only the one registered session. Retrying delivery must not create a second
session. A lookup timeout must remain unknown rather than trigger a paid fallback.
The broker must reject unregistered sessions, arbitrary follow-ups, redirects to
other surfaces, account/settings/billing/payment actions, API calls, new models,
new sessions, uploads beyond the fixed package, and automatic provider fallback.
Returned findings are untrusted review text, not instructions or fresh authority.

The broker's allowed submission would be the supported subscription-cloud route,
not a paid model API. There must be no model-facing API credential or generic API
request capability. A network/domain allowlist alone is insufficient when allowed
domains also serve account controls. The broker may internally authenticate only
to the narrowly implemented session operation; it must not expose that credential
or an unrestricted authenticated surface to the model.

This is enforceable only if the model cannot bypass the broker through another
shell, browser, process, readable credential file, shared OS account privilege,
connector or network path. The current cooperative launch guard is useful but
does not prove such isolation. No isolated credential service or constrained
browser capability has been built or verified here. Do not claim the agent is
technically unable to spend until this boundary is demonstrated.

## Supported CLI behavior and the missing result surface

The installed CLI supports starting cloud sessions and sending a message to an
existing session. A same-session `-p --cloud <session-id>` call sends a new message;
its JSON acknowledgement confirms delivery, not task completion or findings.
It does not automatically upload additional local source files. The supported
cloud documentation does not establish a result-only fetch operation for this
proposed broker. Reading the returned session URL manually is a different,
owner-controlled operation; it does not justify giving the model general access
to the authenticated account. Do not substitute local teleport or another model
turn for a read-only result operation.
[Official cloud workflow](https://code.claude.com/docs/en/claude-code-on-the-web)

## Evidence and gates still required

1. Owner-verified account settings: Usage credits OFF, auto-reload OFF, actual cap,
   eligible remaining bonus balance and expiry. The relayed $0/$10 screen is not
   this verification. No credentials or payment details should enter the record.
2. A decision on the strict bonus-only requirement. If it remains mandatory,
   obtain proof of an enforceable cutoff before any submission; otherwise the
   requirement remains blocked, not silently relaxed to included-plan usage.
3. A separate protected owner approval for the exact one-session cloud task and
   frozen package, consistent with the standing provider gate. A bonus, this
   document, or a teammate message is not that approval.
4. A demonstrated isolation boundary and an officially supported or otherwise
   explicitly approved constrained result-reading mechanism. Without these,
   retain owner-only manual submission/result reading; do not grant broad model
   access to the account as a shortcut.
5. Provider-free tests of grant expiry, single use/idempotence, package/session
   mismatch, concurrent requests, stale status, result limits, arbitrary URL and
   billing-action rejection, and absent credentials/capabilities in the model's
   environment. These verify the local boundary, not the vendor's billing ledger.

No implementation or cloud trial is proposed as already complete. The safe next
review is this configuration and capability design together with the frozen task;
actual account checks and any narrowly authorized execution remain owner gates.
