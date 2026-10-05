// Browser and bridge share this pure contract. No DOM, files, process scans, or timers.
const active = new Set(['working', 'waiting']);
const sources = new Set(['hook', 'vendor', 'operator', 'process', 'transport']);
const completions = new Set(['hook-stop', 'vendor-turn-complete', 'done-command']);
const taskSources = new Set(['task-tool','task-line','user-prompt','manual']);
const nowSources = new Set(['hook','vendor','reported','task-tool']);
const goalSources = new Set([ 'about-what', 'opening-request', 'agent-goal']);
const goalRank={'agent-goal':1,'opening-request':2,'about-what':3};
const identityKeys = ['paneId', 'sessionId', 'runId', 'epoch'];
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const finite = value => typeof value === 'number' && Number.isFinite(value);
export function sameSessionIdentity(a, b) {
  return Boolean(a && b && identityKeys.every(key => a[key] === b[key]));
}
export function createSessionState(identity, manualGoal = null) {
  return { version: 2, identity: {...identity}, lifecycle: 'unknown', confidence: 'low',
    authorityProducer:null,goalAt:null, tasks:[],task: null, goal: manualGoal?.source === 'manual' ? {...manualGoal} : null, now: null,
    question: null, completion: null, producerSeq: {}, seen: [], lastEventAt: null, lastProducer:null,
    leaseUntil: null, transportGap: false, ended: false, processToken:null,interruptionIntent:null,observationSeq:{},reason: 'no reported event' };
}
export function reduceSessionStatus(state, event, ctx) {
  if (!sameSessionIdentity(state.identity, event.identity) || !sources.has(event.source) ||
      !finite(event.at) || !finite(ctx.now) || !event.id || !event.producer) return state;
  if (state.seen.includes(event.id)) return state;
  const previousSeq = state.producerSeq[event.producer];
  if (event.seq != null && (!Number.isSafeInteger(event.seq) || event.seq < 0 ||
      (previousSeq != null && event.seq <= previousSeq))) return state;
  // A valid producer sequence survives a wall-clock reversal; legacy reports cannot.
  if (event.kind !== 'goal.set' && state.lastEventAt != null && event.at < state.lastEventAt &&
      !(event.seq != null && state.lastProducer === event.producer && previousSeq != null)) return state;
  // A bad clock must not consume the source sequence or poison later valid events.
  if (event.at > (ctx.wallNow ?? event.at) + (ctx.clockSkewMs ?? 5000))
    return event.kind === 'report' && !state.completion && !state.ended ? {...state,lifecycle:'unknown',confidence:'low',leaseUntil:null,reason:'source clock is ahead'} : state;
  const next = {...state, producerSeq:{...state.producerSeq}, seen:[...state.seen.slice(-63),event.id],
    lastEventAt:Math.max(state.lastEventAt ?? event.at,event.at),lastProducer:event.producer};
  if (event.seq != null) next.producerSeq[event.producer] = event.seq;
  if(event.observer) {
    if(!Number.isSafeInteger(event.observationSeq) || event.observationSeq<1 || event.observationSeq<=(state.observationSeq?.[event.observer] ?? 0)) return state;
    next.observationSeq={...state.observationSeq,[event.observer]:event.observationSeq};
  }
  const expire = reason => ({...next, lifecycle:'unknown', confidence:'low', leaseUntil:null, reason});
  if(event.kind==='transport.disconnected') {
    if(event.source!=='transport') return state;
    return state.ended || state.completion ? {...next,transportGap:true} : {...expire('transport disconnected'),transportGap:true};
  }
  if (event.kind === 'transport.reconnected') {
    if(event.source!=='transport') return state;
    return {...(state.ended || state.completion ? next : expire('reconnected; fresh event required')),
    identity:{...state.identity,epoch:state.identity.epoch+1},producerSeq:{},transportGap:true};
  }
  if(event.kind==='process.observed') {
    if(event.source!=='process' || state.ended || !event.processToken || (state.processToken && state.processToken!==event.processToken)) return state;
    return {...next,processToken:event.processToken};
  }
  if(event.kind==='interruption.intent') {
    if(event.source!=='operator' || state.ended || !event.intentId || !state.processToken || event.processToken!==state.processToken) return state;
    return {...next,interruptionIntent:{id:event.intentId,processToken:event.processToken}};
  }
  if(event.kind==='turn.interrupted') {
    if(event.source!=='process' || state.ended || state.completion || !state.interruptionIntent ||
      event.intentId!==state.interruptionIntent.id || event.processToken!==state.processToken) return state;
    return {...next,lifecycle:'interrupted',confidence:'high',question:null,now:null,leaseUntil:null,interruptionIntent:null,reason:'observed turn interruption'};
  }
  if (['process.gone','process.crashed','process.interrupted'].includes(event.kind)) {
    if (event.source !== 'process') return state;
    return {...next, lifecycle:event.kind === 'process.crashed' ? 'crashed' : event.kind==='process.interrupted' ? 'interrupted':'ended', ended:true,
      confidence:'high', question:null, leaseUntil:null, interruptionIntent:null,reason:event.kind, now:null};
  }
  if (event.kind === 'goal.set') {
    if (event.source !== 'operator' || event.goal?.source !== 'manual' || !text(event.goal.text) ||
        (event.seq == null && state.goalAt != null && event.at < state.goalAt)) return state;
    return {...next,lastEventAt:state.lastEventAt,lastProducer:state.lastProducer,
      goalAt:event.at,goal:{text:text(event.goal.text),source:'manual',pinned:true},reason:'operator goal'};
  }
  if (state.ended) return state; // A new process/run needs a new explicit identity binding.
  if (event.kind === 'question.resolved') {
    if (!state.question || state.question.id !== event.questionId || !['hook','vendor'].includes(event.source)) return state;
    // Answer delivery is not proof that the agent resumed work or finished.
    return {...expire('answer delivered; waiting for agent event'), question:null};
  }
  if(state.lifecycle==='interrupted' && !event.startsNewTurn) return state;
  if (event.kind !== 'report' || !['hook','vendor'].includes(event.source)) return state;
  if (!['working','waiting','idle','finished','interrupted','unknown'].includes(event.lifecycle)) return state;
  if (state.question && ['working','idle'].includes(event.lifecycle) &&
      event.resolvesQuestionId !== state.question.id && !event.startsNewTurn)
    return {...next,lifecycle:state.lifecycle,question:state.question,leaseUntil:state.leaseUntil,reason:'unresolved question retained'};
  if (state.completion && event.lifecycle !== 'finished' && !event.startsNewTurn) return state;
  if (event.lifecycle === 'finished' && (!completions.has(event.completionSource) || !finite(event.completedAt) ||
      event.completedAt > (ctx.wallNow ?? event.at) + (ctx.clockSkewMs ?? 5000) ||
      (event.source === 'vendor' && event.completionSource !== 'vendor-turn-complete') ||
      (event.source === 'hook' && !['hook-stop','done-command'].includes(event.completionSource)) ||
      (state.question && event.resolvesQuestionId !== state.question.id))) return state;
  if (event.lifecycle === 'waiting' && (!event.question?.id || !['approval','input'].includes(event.question.reason))) return state;
  next.lifecycle = event.lifecycle;
  next.confidence = event.lifecycle === 'unknown' ? 'low' : 'high';
  next.reason = event.lifecycle === 'finished' ? event.completionSource : `reported ${event.lifecycle}`;
  next.transportGap = false;
  if(event.startsNewTurn) next.interruptionIntent=null;
  const age = Math.max(0,(ctx.wallNow ?? event.at)-event.at);
  next.leaseUntil = active.has(event.lifecycle) ? ctx.now + Math.max(0,(ctx.leaseMs ?? 120000)-age) : null;
  next.question = event.lifecycle === 'waiting' ? {...event.question} : null;
  next.completion = event.lifecycle === 'finished' ? {at:event.completedAt,source:event.completionSource,id:event.id} : null;
  if(Array.isArray(event.tasks) && event.tasks.every(item=>item && text(item.id) && text(item.text) && ['pending','in_progress','completed'].includes(item.status))) next.tasks=event.tasks.map(item=>({...item}));
  if (event.task && taskSources.has(event.task.source) && text(event.task.text)) next.task = {...event.task,text:text(event.task.text)};
  if (event.goal && goalSources.has(event.goal.source) && text(event.goal.text) && next.goal?.source !== 'manual' &&
      (!next.goal || (goalRank[event.goal.source] ?? 0)>=(goalRank[next.goal.source] ?? 0)))
    next.goal = {...event.goal,text:text(event.goal.text)};
  // Only an explicit event supplies Now. Silence never manufactures a sentence.
  next.now = event.now && nowSources.has(event.now.source) && text(event.now.text)
    ? {...event.now,text:text(event.now.text),since:event.at,stale:false}
    : next.now ? {...next.now,stale:true} : null;
  return next;
}
const label = (value, max) => {
  if (!value || value.length <= max) return value;
  return value.slice(0,max-1).replace(/\s+\S*$/,'').trimEnd()+'…';
};
const field = (value,max,stale=false) => value ? {...value,label:label(value.text,max),stale:stale || Boolean(value.stale)} : null;
export function selectSessionView(state, now) {
  const stale = active.has(state.lifecycle) && (state.leaseUntil == null || now >= state.leaseUntil);
  const lifecycle = stale ? 'unknown' : state.lifecycle;
  return {version:2, identity:{...state.identity}, lifecycle, confidence:stale ? 'low' : state.confidence,
    tasks:(state.tasks ?? []).map(item=>({...item})),task:field(state.task,96),goal:field(state.goal,180),now:field(state.now,140,stale),
    question:lifecycle === 'waiting' && state.question ? {...state.question} : null,
    completion:lifecycle === 'finished' && state.completion ? {...state.completion} : null,
    attention:lifecycle === 'working' ? 'running' : lifecycle === 'waiting' ? 'waiting'
      : ['idle','finished','ended','interrupted'].includes(lifecycle) ? 'idle' : lifecycle === 'crashed' ? 'needs-attention' : 'unavailable',
    stale,reason:stale ? 'event lease expired; state unknown' : state.reason};
}
