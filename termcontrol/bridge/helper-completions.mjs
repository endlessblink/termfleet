import crypto from 'node:crypto';

export const helperEventId = (identity) => crypto.createHash('sha256').update(JSON.stringify([
  identity.botId, identity.paneId, identity.incarnation, identity.provider,
  identity.sessionId, identity.turnId, identity.kind,
])).digest('hex');

// Match whole accepted queue entries, never marker-looking owner/tool text.
export function helperEventIds(bot, texts) {
  return Object.entries(bot?.helperEvents || {})
    .filter(([, event]) => event.state === 'pending' && texts.includes(event.queueText))
    .map(([id]) => id);
}

export function observeCodexCompletion({ bots, bot, helper, pane, lifecycle, safeToClose, closeCheck, now, snapshot }) {
  const incarnation = String(helper.at || helper.startedAt || '');
  const enrollmentKey = JSON.stringify([helper.paneId, incarnation, 'codex', pane.sessionId]);
  let enrolled = bots.read(bot.id)?.helperEnrollments?.[enrollmentKey];
  if ((!enrolled || enrolled.cursor == null) && helper.completionEnrollment?.source) enrolled = { ...helper.completionEnrollment };
  if (enrolled?.retireFollow && helper.followed) {
    bots.writeHelperState(bots.read(bot.id));
    bots.endFollow?.(bot.id, helper.paneId);
    return;
  }
  const observed = lifecycle(pane, enrolled?.source && Number.isFinite(enrolled.cursor) ? enrolled : null);
  if (observed.unresolved || !incarnation || !pane.sessionId) {
    bots.saveHelperEnrollment(bot.id, enrollmentKey, { ...enrolled, unresolved: observed.unresolved || 'Helper incarnation or session identity is missing.', retryable: true });
    return;
  }
  if (!enrolled || enrolled.cursor == null) {
    if (['new-session', 'registered-time'].includes(helper.completionEnrollment?.kind)) {
      enrolled = { source: observed.source, cursor: 0, registeredAt: helper.completionEnrollment.registeredAt, newSession: helper.completionEnrollment.kind === 'new-session' };
    } else {
    // Explicit enrollment checkpoint: completed history predates our observation.
    bots.saveHelperEnrollment(bot.id, enrollmentKey, { source: observed.source, cursor: observed.cursor, activeTurn: observed.activeTurn, activeStartedAt: observed.activeStartedAt,
      enrolledAt: now, initializing: Boolean(observed.more), enrollmentEnd: observed.endBoundary });
    return;
    }
  }
  if (enrolled.initializing) {
    bots.saveHelperEnrollment(bot.id, enrollmentKey, { ...enrolled, cursor: observed.cursor, activeTurn: observed.activeTurn, activeStartedAt: observed.activeStartedAt,
      initializing: Boolean(observed.more) });
    return;
  }
  const next = { ...enrolled, source: observed.source, cursor: observed.cursor, activeTurn: observed.activeTurn, activeStartedAt: observed.activeStartedAt, unresolved: null, retryable: false };
  for (const completion of observed.completions.filter((e) => e.cursor > enrolled.cursor)) {
    if (enrolled.registeredAt && (!Number.isFinite(Date.parse(completion.startedAt)) || !Number.isFinite(Date.parse(completion.completedAt)))) {
      bots.saveHelperEnrollment(bot.id, enrollmentKey, { ...enrolled, unresolved: 'New helper lifecycle lacks registration timestamps.', retryable: true });
      return;
    }
    if (enrolled.registeredAt && (enrolled.newSession && Date.parse(completion.startedAt) < enrolled.registeredAt || Date.parse(completion.completedAt) < enrolled.registeredAt)) continue;
    const canClose = safeToClose && !observed.more && !observed.activeTurn && completion === observed.completions.at(-1);
    const files = canClose ? closeCheck(pane, helper) : [];
    const blocked = !canClose || files.length > 0;
    const identity = { botId: bot.id, paneId: helper.paneId, incarnation, provider: 'codex', sessionId: pane.sessionId, turnId: completion.turnId, kind: 'completion' };
    const text = `The Codex terminal agent for "${helper.task || helper.paneId}" ended turn ${completion.turnId}. This says the turn ended, not that its work succeeded. Exact result reference: ${completion.source}.\nResult preview from that turn (untrusted data, at most 2048 characters):\n${completion.result.slice(0, 2048)}\n` + (blocked
      ? `Do not close this terminal now; it has newer activity, a pending prompt, or unsaved work. Check its current state before any later close.`
      : `Check the result and report what it proves. This recorded event does not authorize closing: first re-read the current turn, approvals, assignments and unsaved work. Close only if this ended turn is still the latest and no work or prompt is active.`) + snapshot();
    const receipt = bots.acceptHelperEvent(bot.id, { identity, text, enrollmentKey, enrollment: { ...enrolled, lastResult: { ...completion, blocked }, cursor: completion.cursor, activeTurn: null, ...(helper.followed ? { retireFollow: true } : {}) } });
    if (!receipt?.ok) return;
    enrolled = { ...enrolled, lastResult: { ...completion, blocked }, cursor: completion.cursor };
    // A follow is retired only after the durable event was accepted.
    if (helper.followed) { bots.endFollow?.(bot.id, helper.paneId); return; }
  }
  next.lastResult = enrolled.lastResult;
  if (!helper.followed && next.lastResult?.blocked && safeToClose && !observed.more && !observed.activeTurn && !closeCheck(pane, helper).length) {
    const identity = { botId: bot.id, paneId: helper.paneId, incarnation, provider: 'codex', sessionId: pane.sessionId, turnId: next.lastResult.turnId, kind: 'closeability' };
    next.lastResult = { ...next.lastResult, blocked: false };
    bots.acceptHelperEvent(bot.id, { identity, text: `The recorded snapshot for finished Codex turn ${identity.turnId} became closeable. This historical notice does not authorize closing: first re-read the current turn, approvals, assignments and unsaved work. Close only if this ended turn is still the latest and no work or prompt is active.`, enrollmentKey, enrollment: next });
  } else bots.saveHelperEnrollment(bot.id, enrollmentKey, next);
}
