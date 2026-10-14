import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-timing-test-'));
const file = path.join(dir, 'worker.py');
process.env.TC_WHISPER_PY = '/usr/bin/python3';
process.env.TC_STT_WORKER = file;
process.env.TC_STT_TIMEOUT_MS = '700';
process.env.TC_STT_MAX_PENDING = '2';
process.env.TC_STT_IDLE_MS = '90';
process.env.TC_STT_LOG_TIMINGS = '1';
const { transcribe, stopTranscriber, prepareTranscriber, recentTranscriptionTimings } = await import('../bridge/transcribe/index.mjs');
const fixture = `import sys,json,time
print(json.dumps({'ready':True}),flush=True)
for line in sys.stdin:
 r=json.loads(line)
 time.sleep(0.45)
 print(json.dumps({'id':r['id'],'text':'synthetic words','language':'he','timings':{'decodeMs':1,'warmupMs':2,'detectMs':3,'inferenceMs':4,'audioSeconds':1,'coldModel':False,'model':'ivrit-ai/faster-whisper-v2-d4','device':'cpu','computeType':'int8_float32','cpuThreads':4,'private':'DO-NOT-LOG','path':'/private/clip'}}),flush=True)
`;
test.after(() => { stopTranscriber(); fs.rmSync(dir, { recursive: true, force: true }); });
test('shared worker queue is bounded and deadline includes queue time', async () => {
 fs.writeFileSync(file, fixture);
 const start=performance.now();
 const first=transcribe(Buffer.alloc(64));
 const second=transcribe(Buffer.alloc(64)).then(()=>null,e=>e);
 const extra=transcribe(Buffer.alloc(64)).then(()=>null,e=>e);
 assert.match((await extra)?.message || '', /busy/i);
 assert.equal((await first).text,'synthetic words');
 assert.match((await second)?.message || '', /timed out/i);
 assert.ok(performance.now()-start<1000,'queued clip must not get another full processing deadline');
 const recovered=await transcribe(Buffer.alloc(64));
 assert.equal(recovered.text,'synthetic words','deadline recovery must still work');
 stopTranscriber();
});
test('timing metadata is allowlisted, bounded and contains no speech or path', async () => {
 fs.writeFileSync(file, fixture.replace('time.sleep(0.45)','time.sleep(0.001)'));
 const logs=[];const old=console.info;console.info=(...v)=>logs.push(v.join(' '));
 try {
  for(let i=0;i<36;i++) {
   const r=await transcribe(Buffer.alloc(64));
   assert.ok(r.timings.queueMs>=0);assert.ok(r.timings.workerStartupMs>=0);
   assert.equal(r.timings.inferenceMs,4);assert.equal(r.timings.computeType,'int8_float32');
   assert.equal(r.timings.bytes,64);
   assert.equal(r.timings.private,undefined);assert.equal(r.timings.path,undefined);
  }
  const recent=recentTranscriptionTimings();
  assert.equal(recent.length,32);assert.ok(!JSON.stringify({recent,logs}).includes('synthetic words'));
  assert.ok(!JSON.stringify({recent,logs}).includes('DO-NOT-LOG'));
  assert.ok(!JSON.stringify({recent,logs}).includes('/private/clip'));
  recent[0].bytes=-1;assert.notEqual(recentTranscriptionTimings()[0].bytes,-1);
 } finally {console.info=old;stopTranscriber();}
});

test('preparation coalesces and never joins the queue behind a clip', async () => {
 fs.writeFileSync(file, fixture.replace('time.sleep(0.45)', 'time.sleep(0.05)'));
 const hint=prepareTranscriber({ language:'he' });
 assert.equal(prepareTranscriber({ language:'en' }),hint);
 await hint;
 const clip=transcribe(Buffer.alloc(64));
 assert.equal((await prepareTranscriber()).prepared,false);
 await clip;
 assert.equal(recentTranscriptionTimings().at(-2).operation,'prepare');
 stopTranscriber();
});

test('expired queued clips are never dispatched and recovery still succeeds',async()=>{
 const counter=path.join(dir,'dispatched.txt');
 fs.writeFileSync(file,`import json,sys,time
for line in sys.stdin:
 r=json.loads(line)
 with open(${JSON.stringify(counter)},'a') as f:f.write('received\\n')
 time.sleep(5)
`);
 const jobs=await Promise.allSettled([transcribe(Buffer.alloc(64)),transcribe(Buffer.alloc(64))]);
 for(const job of jobs){assert.equal(job.status,'rejected');assert.match(job.reason.message,/timed out/i);}
 assert.equal(fs.readFileSync(counter,'utf8').trim().split('\n').length,1);
 fs.writeFileSync(file,fixture.replace('time.sleep(0.45)','time.sleep(0.001)'));
 assert.equal((await transcribe(Buffer.alloc(64))).text,'synthetic words');
 stopTranscriber();
});
test('idle release remains bounded and the next clip reports a cold worker',async()=>{
 const first=await transcribe(Buffer.alloc(64));assert.equal(first.timings.coldWorker,true);
 const warm=await transcribe(Buffer.alloc(64));assert.equal(warm.timings.coldWorker,false);
 await new Promise(r=>setTimeout(r,140));
 const cold=await transcribe(Buffer.alloc(64));assert.equal(cold.timings.coldWorker,true);
 stopTranscriber();
});
