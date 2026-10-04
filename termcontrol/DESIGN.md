---
name: TermControl conversation improvements
description: Preserve the original dark shell; improve only conversation content
colors:
  background: "#141413"
  surface: "#1c1c1a"
  selected: "#232320"
  text: "#f0eee6"
  secondary: "#9a9993"
  action: "#d97757"
---

## Owner scope

The original dark shell, header, fleet cards and bottom view controls are the boundary. The rejected light theme, new agent inbox/search, top tabs and provider disclosure shell have been removed. Restore from the verified pre-deployment source, never reset functional guards. No new global visual concept or brightness change.

## Conversation region

Scoped `main` rules improve message reading, native table rows, Copy, inline questions and the read-only recorded day. User bubbles and open agent prose remain dark. Hebrew/English direction follows content; input supports native selection. Code/URLs/times remain isolated. At 320/390/430 px no horizontal overflow or inaccessible keyboard action is allowed.

## Truth and feedback

Known technical startup instructions are secondary and inspectable inside the conversation. Routine machinery collapses by known envelope or transcript metadata provenance. Actionable errors/approvals retain meaningful visible summaries and real controls. Literal code and genuine user/agent text are not generic technical noise. Debug Copy preserves exact original details.

A pending-answer control opens the current choices and focuses an actual option without submitting. Sending/error feedback scrolls into view. Terminal acknowledgment and agent acceptance stay distinct; unverified free answers remain disabled.

Last used displays explicit owner-use time; unknown visits keep deterministic map order. Background output cannot move the order. Phone visit metadata lives on the bridge and survives another phone, reconnect and restart; exact desktop focus integration needs its verified per-pane source. Shared previews are visibly synthetic, never private owner captures.
