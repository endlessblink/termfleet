import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Admission and registered-work drain, not authorization or universal quiescence.
 * Records contain operation references only, never queue words or terminal input.
 * An interrupted/unknown operation is retained, never reclaimed or replayed here.
 */
export function createAutomaticActionBarrier({ file, env = process.env, stat = fs.lstatSync,
  operationsDir, now = Date.now } = {}) {
  let draining = false, storageBlocked = false;
  const active = new Map(), retained = new Map(), timers = new Set(), deliveries = new Map();
  const context = new AsyncLocalStorage();
  let omittedCompleted = 0;
  const trimCompleted = () => {
    const completed=[...deliveries.values()].filter(row=>['settled','failed-before-effect'].includes(row.state))
      .sort((a,b)=>a.at-b.at || a.id.localeCompare(b.id));
    for(const row of completed.slice(0,Math.max(0,completed.length-100))) {
      deliveries.delete(row.id);omittedCompleted++;
    }
  };
  const syncDirectory = () => {
    const fd = fs.openSync(operationsDir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  if (operationsDir) {
    try {
      for (const name of fs.readdirSync(operationsDir)) {
        const complete = name.endsWith('.receipt.json');
        if (!complete && !name.endsWith('.pending.json')) { storageBlocked = true; continue; }
        const pending = path.join(operationsDir, name);
        try {
          const row = JSON.parse(fs.readFileSync(pending, 'utf8'));
          if (row.version !== 1 || typeof row.id !== 'string' || name !== row.id + (complete ? '.receipt.json' : '.pending.json')) throw Error('invalid operation');
          if (complete) {
            if (row.kind !== 'delivery' || !['settled','failed-before-effect'].includes(row.state)) throw Error('invalid receipt');
            if (!deliveries.has(row.id)) deliveries.set(row.id, row);
            trimCompleted();
            continue;
          }
          if (row.kind === 'delivery') deliveries.set(row.id, {...row, state:'uncertain'});
          retained.set(row.id, { id: row.id, label: String(row.label || 'automatic operation'), reference: row.reference ?? null, reason: 'interrupted operation' });
        } catch { storageBlocked = true; }
      }
    } catch (error) { if (error.code !== 'ENOENT') storageBlocked = true; }
  }
  const reason = () => {
    if (draining) return 'bridge draining';
    if (storageBlocked) return 'automatic operation storage unavailable';
    if (retained.size) return 'unsettled automatic operations';
    if (env.TC_PAUSE_AUTOMATIC_ACTIONS === '1') return 'startup maintenance pause';
    if (!file) return null;
    try { stat(file); return 'maintenance marker'; }
    catch (error) { return error.code === 'ENOENT' ? null : 'maintenance marker unreadable'; }
  };
  const status = () => {
    const why = reason();
    return { protocol: 'registered-automatic-drain-v1', paused: Boolean(why), reason: why, quiescence_verified: false,
      active: [...active.values()].map(({ id, label, reference }) => ({ id, label, reference })),
      retained: [...retained.values()], deliveries:[...deliveries.values()],
      delivery_history:{completed_limit:100,completed_omitted:omittedCompleted,pending_retained_in_full:true},timers: timers.size };
  };
  const refused = () => ({ error: 'Automatic actions are paused for maintenance.', paused: true, notSent: true, ok: false });
  const beginDrain = () => {
    draining = true;
    for (const cancel of [...timers]) {
      try { cancel(); timers.delete(cancel); } catch { storageBlocked = true; }
    }
  };
  const execute = (action, { label = 'automatic operation', reference = null, kind, receipt } = {}) => {
    // An already admitted callback may finish its own delivery during drain.
    // A detached callback cannot acquire this exception after its parent returns.
    const admitted = kind === 'delivery' && active.has(context.getStore());
    if (reason() && !(admitted && !storageBlocked && !retained.size)) return refused();
    const row = { version: 1, id: randomUUID(), label, reference, at: now(), ...(kind ? {kind,state:'pending'} : {}) };
    const pending = operationsDir && path.join(operationsDir, row.id + '.pending.json');
    if (pending) {
      try {
        fs.mkdirSync(operationsDir, { recursive: true, mode: 0o700 });
        const fd = fs.openSync(pending, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(row)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        syncDirectory();
      } catch {
        storageBlocked = true;
        return { ...refused(), error: 'Automatic operation intent could not be persisted; nothing was started.' };
      }
    }
    active.set(row.id, row); // register synchronously, before invoking any callback
    if (kind === 'delivery') deliveries.set(row.id, row);
    const finish = (value, rejected = false) => {
      let proof = null;
      let settlementPersisted = kind !== 'delivery' || !pending;
      if (kind === 'delivery' && !rejected && !value?.uncertain) {
        try { proof = receipt(value); } catch { /* unverified receipt remains uncertain */ }
        if (typeof proof !== 'string' || !proof) proof=null;
      }
      const beforeEffect = !rejected && value?.notSent === true && !value?.uncertain;
      const unknown = kind === 'delivery' ? !proof && !beforeEffect
        : rejected || value?.uncertain === true || (Boolean(value?.error) && value?.notSent !== true);
      if (kind === 'delivery') {
        Object.assign(row, {state:unknown?'uncertain':beforeEffect?'failed-before-effect':'settled', receipt:proof || null});
        if (pending) {
          try {
            const tmp=pending+'.settling', fd=fs.openSync(tmp,'wx',0o600);
            try { fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
            fs.renameSync(tmp,unknown?pending:path.join(operationsDir,row.id+'.receipt.json'));syncDirectory();
            settlementPersisted=true;
          } catch {
            row.state='uncertain';row.receipt=null;storageBlocked=true;
            retained.set(row.id,{id:row.id,label,reference,reason:'delivery receipt persistence failed'});
          }
        }
      }
      if (unknown) retained.set(row.id, { id: row.id, label, reference, reason: 'operation outcome unknown' });
      else if (pending && settlementPersisted) {
        try { fs.unlinkSync(pending); syncDirectory(); }
        catch { storageBlocked = true; retained.set(row.id, { id: row.id, label, reference, reason: 'operation settlement could not be persisted' }); }
      }
      active.delete(row.id);
      trimCompleted(); // metadata on disk is retained; never trim pending/uncertain work
      return value;
    };
    try {
      const value = context.run(row.id, action);
      if (value && typeof value.then === 'function') return Promise.resolve(value).then(
        result => finish(result), error => { finish(null, true); throw error; });
      return finish(value);
    } catch (error) { finish(null, true); throw error; }
  };
  return {
    get paused() { return Boolean(reason()); }, status, beginDrain,
    run: execute,
    delivery(reference, action, {receipt = value => value?.received === true && typeof value.receipt === 'string' ? value.receipt : null} = {}) {
      if (!reference || typeof reference.source_id !== 'string' || !reference.source_id || typeof reference.pane_id !== 'string') return refused();
      return execute(action,{kind:'delivery',label:'automatic delivery',reference,receipt});
    },
    guard(action, options) { return (...args) => execute(() => action(...args), options); },
    registerTimer(cancel) {
      if (draining) { cancel(); return () => {}; }
      timers.add(cancel);
      return () => timers.delete(cancel);
    },
    persistPause() {
      if (!file) return { ok: false, error: 'No persistent maintenance marker is configured.' };
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        let fd;
        try { fd = fs.openSync(file, 'wx', 0o600); }
        catch (error) { if (error.code === 'EEXIST') return { ok: true, existing: true }; throw error; }
        try { fs.writeFileSync(fd, JSON.stringify({ version: 1, kind: 'maintenance', at: now() })); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        const parent = fs.openSync(path.dirname(file), 'r');
        try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
        return { ok: true };
      } catch {
        storageBlocked = true;
        return { ok: false, error: 'Maintenance marker could not be persisted.' };
      }
    },
    schedule(action, { label, ms, set = setInterval, clear = clearInterval,
      once = false, onError = () => {} } = {}) {
      let unregister = () => {};
      const tick = () => {
        if (once) unregister();
        try {
          const value = execute(action, { label });
          return value && typeof value.then === 'function' ? value.catch(error => { onError(error); }) : value;
        } catch (error) { onError(error); }
      };
      const timer = set(tick, ms);
      unregister = this.registerTimer(() => clear(timer));
      timer.unref?.();
      return timer;
    },
    async drain({ timeoutMs = 5000, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
      beginDrain();
      const deadline = now() + Math.max(0, timeoutMs);
      while (active.size && now() < deadline) await pause(Math.min(25, Math.max(0, deadline - now())));
      const observed = status();
      return { ...observed, settled: !active.size && !retained.size && !storageBlocked && !timers.size };
    },
  };
}
