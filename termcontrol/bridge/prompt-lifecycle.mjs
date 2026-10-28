/** A status sidecar saying "waiting" is not evidence that its old prompt still exists. */
export function promptObservation({ card, pane, available = true, ask, screen = '', screenAsks = false }) {
  if (!available) return 'unknown';
  if (!pane || pane.alive === false || pane.exited === true) return 'closed';
  if (card && ((card.provider && card.provider !== pane.provider)
    || (card.sessionId && pane.sessionId && card.sessionId !== pane.sessionId))) return 'replaced';
  if (ask?.id) return 'active';
  // An unreadable/empty screen is not proof of cancellation. Keep history and
  // approvals, but do not claim it is currently answerable or send reminders.
  if (!String(screen).trim() || screenAsks) return 'unknown';
  return 'absent';
}
