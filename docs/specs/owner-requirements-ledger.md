# Owner requirements ledger: never miss what Noam says, enforce end-to-end delivery

Noam (2026-10-23, exact words): "ותבנה מערכת שתבטיח ב100% שאתה לא יכול לפספס דברים שאני אומר ושמחייבת אותך ליישם אותם מקצה לקצה". Earlier: "אתה חייב תמיד לתעד ולעקוב אחרי מה שאני אומר!"

## Failures this must prevent (all real, from the politic-fighter bot on 2026-10-22)
- A message with several numbered parts, (1) to (4), was tracked as one request and marked "partial" on a vague note, so some parts were silently dropped.
- Earlier requirements for the same screen were forgotten. Noam said the title strip faces must fill the strip and loop endlessly. When the strip later broke, the bot only passed on "it's empty" and lost the original requirement.
- Briefs to terminal agents paraphrased Noam instead of carrying his exact words for every item.
- Messages sent to idle Codex terminals were silently not delivered, and the bot believed they were.
- Approved work regressed: the title strip and portraits broke after later changes, and nothing re-checked the approved state.
- Agents reported "done" and the bot relayed it without checking each of Noam's items against evidence.

## Required system
1. **Atomic capture.** Every Noam message, in bot chats and terminals, is split into atomic requirement items. Each numbered part, each separate sentence that asks for something, and each picture annotation becomes its own item. Every item stores Noam's exact words, the message id, a timestamp, the project and a topic/screen tag. Each item gets a stable id (for example R-123), and the ledger is kept per project.
2. **No silent drops.** The bot's Stop hook blocks ending a turn while any new item is not yet one of these: assigned to an agent brief by id, answered, or explicitly marked waiting-for-Noam.
3. **Exact words travel with the work.** When the bot hands work to an agent, the hand-off must name requirement ids. TermFleet then injects Noam's exact words for those items, plus all still-open and locked items with the same topic, into the agent's task.
4. **Delivery verification.** Sending to a terminal confirms the agent actually received the message (it appears in its transcript or it started a turn). If not, the bot gets an error. This fixes the idle Codex terminal problem.
5. **Evidence per item.** An item can be marked ready or done only with evidence attached to that item, such as a screenshot from the live link or a test output. Agents' Stop hooks require a per-item table of id, Noam's words, what was done and evidence. "partial" requires listing exactly which parts are open.
6. **Regression lock.** When Noam confirms an item works, it becomes locked. Any later delivery that touches the same topic must re-verify every locked item for that topic before it can be marked ready.
7. **Visibility.** Noam can see his items and their status, by project and topic, in the cockpit and on the phone.

## Constraints
- Build on the existing termfleet-asks, termfleet-team and owner-words mechanisms; don't create a competing tracker.
- Keep it fast; no cloud LLM calls for the splitting. Use deterministic splitting on numbering, lines and sentences, with a local fallback only if needed.
- Write tests for each failure listed above, reproduce each one, and prove the system now blocks it.
- Report to Noam in plain words. No commits to other repos.
