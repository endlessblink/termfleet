async function test(name, run) { await run(); console.log(`PASS ${name}`); }
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/lib/cockpitHeartbeat.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 } }).outputText;
const { startCockpitHeartbeat } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const settle = () => new Promise(resolve => setImmediate(resolve));

await test('heartbeat starts with no panes and continues during a 60-second snapshot stall', async () => {
  let tick, writes = 0;
  const snapshotWrite = new Promise(() => {}); // snapshot IO never resolves
  assert.ok(snapshotWrite);
  const stop = startCockpitHeartbeat(async () => { writes++; }, (fn, ms) => {
    assert.equal(ms, 10_000); tick = fn; return 1;
  }, () => {});
  await settle();
  for (let i=0; i<6; i++) { tick(); await settle(); }
  assert.equal(writes, 7);
  stop(); tick(); await settle(); assert.equal(writes, 7);
});

await test('a stuck heartbeat does not accumulate IO requests; failure permits a retry', async () => {
  let tick, reject, writes=0;
  const stop = startCockpitHeartbeat(() => { writes++; return new Promise((_, r) => { reject=r; }); },
    fn => { tick=fn; return 1; }, () => {});
  await settle();
  for (let i=0; i<100; i++) tick();
  await settle(); assert.equal(writes,1);
  reject(new Error('temporary IO failure')); await settle();
  tick(); await settle(); assert.equal(writes,2);
  stop(); reject(new Error('stopped')); await settle();
});
