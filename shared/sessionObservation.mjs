import {sameSessionIdentity} from './sessionState.mjs';
const token=value=>typeof value==='string' && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value);
/** Adapter for a trusted backend/vendor observation, not a process scan or key
 * heuristic. processToken must identify one process lifetime (PID alone is not
 * sufficient). Caller binds the observation at capture time, never at receipt. */
export function sessionObservationEnvelope(state,observation,seq) {
 if(!observation || typeof observation.type!=='string' || !sameSessionIdentity(state.identity,observation.identity) ||
  !token(observation.observer) || !Number.isSafeInteger(observation.seq) || observation.seq<1 ||
  !Number.isFinite(observation.at) || observation.seq<=(state.observationSeq?.[observation.observer] ?? 0)) return null;
 const event={version:2,identity:{...state.identity},id:`observation:${observation.observer}:${observation.seq}`,
  producer:`observer:${observation.observer}`,seq,at:observation.at,
  observationSeq:observation.seq,observer:observation.observer,source:'process',kind:''};
 if(observation.type.startsWith('transport.')) {
  if(!['transport.disconnected','transport.reconnected'].includes(observation.type)) return null;
  return {...event,source:'transport',kind:observation.type};
 }
 if(!token(observation.processToken)) return null;
 event.processToken=observation.processToken;
 if(observation.type==='agent.started') {
  if(state.ended || (state.processToken && state.processToken!==observation.processToken)) return null;
  return {...event,kind:'process.observed'};
 }
 if(state.processToken!==observation.processToken || state.ended) return null;
 if(observation.type==='agent.exited') {
  if(!Number.isInteger(observation.exitCode) && !['SIGINT','SIGTERM','SIGKILL','SIGABRT','SIGSEGV'].includes(observation.signal)) return null;
  return {...event,kind:observation.signal==='SIGINT' || observation.exitCode===130 ? 'process.interrupted'
   : observation.exitCode===0 && !observation.signal ? 'process.gone':'process.crashed'};
 }
 if(observation.type==='interruption.intent') {
  if(!token(observation.intentId) || !['Escape','Ctrl+C'].includes(observation.key)) return null;
  return {...event,source:'operator',kind:'interruption.intent',intentId:observation.intentId};
 }
 if(observation.type==='interruption.observed') {
  if(!token(observation.intentId) || state.interruptionIntent?.id!==observation.intentId ||
   state.interruptionIntent.processToken!==observation.processToken || state.completion) return null;
  return {...event,kind:'turn.interrupted',intentId:observation.intentId};
 }
 return null;
}
