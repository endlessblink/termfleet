import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'tc-worker-test-')),file=path.join(dir,'worker.py');
process.env.TC_WHISPER_PY='/usr/bin/python3';process.env.TC_STT_WORKER=file;process.env.TC_STT_TIMEOUT_MS='80';
const {transcribe,stopTranscriber}=await import('../bridge/transcribe/index.mjs');
test('a stuck local worker fails promptly and the next clip can be transcribed',async()=>{
 fs.writeFileSync(file,'import sys,time\nfor line in sys.stdin: time.sleep(5)\n');
 const job=transcribe(Buffer.alloc(64));let result;
 try{result=await Promise.race([job.then(()=> 'resolved',e=>e.message),new Promise(r=>setTimeout(()=>r('hung'),300))]);}finally{stopTranscriber();await job.catch(()=>{});}
 assert.match(result,/timed out/i,'a worker that never replies must not hold the queue forever');
 fs.writeFileSync(file,'import sys,json\nfor line in sys.stdin:\n r=json.loads(line);print(json.dumps({"id":r["id"],"text":"fixture","language":"en"}),flush=True)\n');
 const next=await transcribe(Buffer.alloc(64));assert.equal(next.text,'fixture');stopTranscriber();fs.rmSync(dir,{recursive:true,force:true});
});
