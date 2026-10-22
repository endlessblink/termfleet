# Owner requirements ledger: design (TF-102)

Spec: `owner-requirements-ledger.md`. Tests: `termcontrol/test/requirements-ledger.test.mjs`
(one test per listed failure, each showing how the old path let it through and that it is now blocked).

## One store, built on what exists

`termcontrol/bridge/requirements.mjs` holds the ledger: one append-only event file
(`~/.local/share/termfleet/requirements/ledger.jsonl`; a private bridge with `TC_CONFIG_DIR`
or `TERMFLEET_REQ_DIR` keeps its own). Items have global ids (R-12) so a bot's R-12 is the
same item in the terminal it briefs; "per project" is a view (`project` field on each item).
Item events: capture, topic, assign, status, lock, reverify; plus escalated (gate gave up).

termfleet-asks keeps numbering whole requests (#n) as before; each item records which #n it
came from (`askN`), so the two never disagree. No second tracker.

## Where each piece hooks in

| Spec part | Hook point |
|---|---|
| 1 Atomic capture | termfleet-asks UserPromptSubmit hook (terminals) splits his prompt deterministically (numbering, Hebrew letters, bullets, lines, sentences, picture notes). Bot chats: `bots.mjs` captures at the same moment it records his signed owner words, keyed by that message id; the bot brain's own hook only shows them. Relayed "[Noam's own words" blocks map to the same message id, so nothing is captured twice. Teammate messages are never captured as his. |
| 2 No silent drops | termfleet-asks Stop hook (`itemsGate`): blocks every time (not once) while an item from this conversation is `new`. Taken = assigned (send --req), answered, waiting, context, ready, done, partial, dropped. Capped at 4 blocks in a row, then the problem is written into his list as "needs attention" instead of vanishing. |
| 3 Exact words travel | `termfleet-team send/ask/start --req R-12,R-13` (also R-ids in the text, and `--owner-words` brings its message's items). Required inside a bot and for any agent holding untaken items (`--no-req "<why>"` for a plain question). `briefBlock` adds his exact words for those items, plus every open and locked item on the same topics. Topics: `termfleet-asks topic`, auto-matched by name or alias in later messages. |
| 4 Delivery verification | `delivery.mjs`: every hand-off carries `[delivery D-…]`; received = the mark is in the agent's own conversation record, or it started a turn. Otherwise send exits 3 with a plain reason. Busy agents: "typed in, not read yet", and a bot follows it. `start` waits for the new agent to really begin; Codex's "Hooks need review" prompt is answered with "Trust all and continue" only when every waiting hook is TermFleet's or Noam's own (unknown hooks are reported, never trusted). |
| 4b Codex handovers | Codex's 40% handover rule is now disabled like Claude's (Noam 2026-10-07); a handover that cannot find its card tells the agent to keep working instead of stopping. |
| 5 Evidence per item | `termfleet-asks ready|done R-12 --evidence "<file or what ran and what it showed>"`: one item at a time, files must exist, bare claims refused. `partial` needs `--open "<what is open>"`. Stop refuses an old-style `#n done` whose parts are unresolved, and a "finished" reply without one table row per delivered item. |
| 6 Regression lock | `termfleet-asks lock R-12 --owner-words <id>` / `--noam-said "<his words>"` (only for delivered items). Marking any item on the same topic ready/done then needs `termfleet-asks reverify <locked> --for <id> --evidence …` for each locked item first. |
| 7 Visibility | Bridge `GET /api/requirements?project=&topic=&closed=1`; terminal requests carry their parts (phone list shows each part with its status; the desktop requests panel note reads "Parts 2 of 4 done, open R-13 R-15"); bot chats show "Your items". CLI: `termfleet-asks items [--project P|--all-projects] [--topic T]`. |

## Off switch

`TERMFLEET_REQUIREMENTS=off` turns the item capture and gate off (whole asks hook: `TERMFLEET_ASKS=off`).
