import {reduceSessionStatus} from './sessionState.mjs';
/** Trusted publishers supply the binding and a persistent per-stream sequence.
 * Poll/receive timestamps and array indexes are deliberately not substitutes. */
export function reduceSessionEnvelope(state, envelope, context) {
  if (!envelope || envelope.version !== 2 || !Number.isSafeInteger(envelope.seq) || envelope.seq < 0 ||
      !envelope.identity || !Number.isSafeInteger(envelope.identity.epoch) || envelope.identity.epoch < 0 ||
      !['paneId','sessionId','runId'].every(key=>typeof envelope.identity[key]==='string' && envelope.identity[key].trim() && envelope.identity[key]!=='unbound')) return state;
  const lifecycleEvent=envelope.kind==='report' || envelope.kind==='question.resolved';
  // One explicit source owns lifecycle; an independent stream is a shadow observation,
  // never a competing status writer. Changing ownership requires a new binding/epoch.
  if (lifecycleEvent && state.authorityProducer &&
      (state.authorityProducer.producer!==envelope.producer || state.authorityProducer.source!==envelope.source)) return state;
  const next=reduceSessionStatus(state,envelope,context);
  if (next===state) return state;
  if (envelope.kind==='transport.reconnected') return {...next,authorityProducer:null};
  return lifecycleEvent && next.lastEventAt===Math.max(state.lastEventAt ?? envelope.at,envelope.at) &&
      next.seen.includes(envelope.id) ? {...next,authorityProducer:{producer:envelope.producer,source:envelope.source}} : next;
}
