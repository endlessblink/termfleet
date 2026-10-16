// Voice to text for the phone and desktop page, done entirely on this machine
// (faster-whisper; Hebrew model for Hebrew, large-v3 for English).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const here = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.TC_WHISPER_PY || path.join(os.homedir(), '.venvs', 'whisper', 'bin', 'python');
const IDLE_MS = Number(process.env.TC_STT_IDLE_MS || 10 * 60 * 1000);
const configuredTimeout = Number(process.env.TC_STT_TIMEOUT_MS);
const JOB_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 120000;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const configuredPending = Number(process.env.TC_STT_MAX_PENDING);
const MAX_PENDING = Number.isInteger(configuredPending) && configuredPending > 0 ? Math.min(configuredPending, 8) : 3;

let worker = null;
let buffer = '';
let idleTimer = null;
const waiting = new Map();
let chain = Promise.resolve(); // one clip at a time: models are big
let pendingJobs = 0;
let preparing = null;
const recent = [];

function safeTimings(source = {}) {
  const safe = {};
  for (const key of ['decodeMs', 'warmupMs', 'detectMs', 'inferenceMs', 'audioSeconds', 'cpuThreads']) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9) safe[key] = Math.round(value * 10) / 10;
  }
  for (const key of ['coldModel', 'coldDetector']) if (typeof source[key] === 'boolean') safe[key] = source[key];
  for (const key of ['model', 'detector']) {
    const value = source[key];
    if (typeof value === 'string' && value.length <= 120 && (/^[\w.-]+\/[\w.-]+$/.test(value) || value === 'local/custom')) safe[key] = value;
  }
  if (['cpu', 'cuda'].includes(source.device)) safe.device = source.device;
  if (['int8', 'int8_float32', 'int8_float16', 'int8_bfloat16', 'float32', 'float16', 'bfloat16', 'int16'].includes(source.computeType)) safe.computeType = source.computeType;
  return safe;
}

function remember(timings, outcome) {
  // Fixed schema, 32 entries. Never keep speech, audio, file paths or errors.
  const entry = { ...timings, outcome };
  recent.push(entry);
  if (recent.length > 32) recent.shift();
  if (process.env.TC_STT_LOG_TIMINGS === '1') console.info('[tc-stt-timing]', JSON.stringify(entry));
}

export function recentTranscriptionTimings() { return recent.map((entry) => ({ ...entry })); }

function timedOut() { return new Error('Speech recognition timed out. Try a shorter recording.'); }

function fail(child, error) {
  // A stopped worker may exit after a replacement has already started.
  if (worker !== child) return;
  worker = null; buffer = ''; clearTimeout(idleTimer);
  for (const { reject } of waiting.values()) reject(error);
  waiting.clear();
  child?.kill();
}

function stop() {
  if (worker) fail(worker, new Error('Transcription stopped.'));
}

function start() {
  if (worker) return worker;
  if (!fs.existsSync(PYTHON)) throw new Error('Speech recognition is not installed on this machine.');
  const child = worker = spawn(PYTHON, [process.env.TC_STT_WORKER || path.join(here, 'worker.py')], { stdio: ['pipe', 'pipe', 'ignore'], env: process.env });
  const started = performance.now();
  child.readyMs = null;
  buffer = '';
  child.stdout.on('data', (chunk) => {
    if (worker !== child) return;
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (message.ready === true && !message.id) { child.readyMs = performance.now() - started; continue; }
      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message);
    }
    if (buffer.length > 65536) fail(child, new Error('Speech recognition returned an invalid response.'));
  });
  child.on('error', () => fail(child, new Error('Speech recognition could not start on this machine.')));
  child.on('exit', () => fail(child, new Error('Speech recognition stopped unexpectedly.')));
  child.stdin.on('error', () => fail(child, new Error('Speech recognition stopped unexpectedly.')));
  return child;
}

function run(request, budget) {
  const coldWorker = !worker;
  const child = start();
  const started = performance.now();
  clearTimeout(idleTimer);
  let timeout;
  return new Promise((resolve, reject) => {
    waiting.set(request.id, { resolve, reject });
    timeout = setTimeout(() => fail(child, timedOut()), budget);
    child.stdin.write(JSON.stringify(request) + '\n');
  }).then((reply) => ({ ...reply, timings: { ...safeTimings(reply.timings),
    workerMs: Math.round((performance.now() - started) * 10) / 10,
    workerStartupMs: coldWorker ? (child.readyMs === null ? null : Math.round(child.readyMs * 10) / 10) : 0,
    coldWorker,
  } }), (error) => {
    error.timings = { workerMs: Math.round((performance.now() - started) * 10) / 10,
      workerStartupMs: coldWorker ? child.readyMs : 0, coldWorker };
    throw error;
  }).finally(() => {
    clearTimeout(timeout);
    if (worker === child) { idleTimer = setTimeout(stop, IDLE_MS); idleTimer.unref?.(); }
  });
}

function submit(audio, language, op, uploadMs) {
  if (pendingJobs >= MAX_PENDING) return Promise.reject(Object.assign(new Error('Speech recognition is busy. Try again shortly.'), { statusCode: 503 }));
  pendingJobs++;
  const enqueued = performance.now(), id = crypto.randomUUID();
  const base = { id, operation: op, bytes: audio?.length || 0 };
  if (typeof uploadMs === 'number' && Number.isFinite(uploadMs) && uploadMs >= 0 && uploadMs <= 1e9) base.uploadMs = Math.round(uploadMs * 10) / 10;
  let expired = false, queueTimer, resolve, reject;
  const result = new Promise((yes, no) => { resolve = yes; reject = no; });
  queueTimer = setTimeout(() => {
    expired = true;
    const timings = { ...base, queueMs: Math.round((performance.now() - enqueued) * 10) / 10,
      totalMs: Math.round((performance.now() - enqueued) * 10) / 10 };
    remember(timings, 'queue-timeout');
    reject(Object.assign(timedOut(), { timings }));
  }, JOB_MS);
  const job = chain.then(async () => {
    if (expired) return;
    clearTimeout(queueTimer);
    const queueMs = Math.round((performance.now() - enqueued) * 10) / 10;
    const budget = JOB_MS - (performance.now() - enqueued);
    let dir;
    try {
      if (budget <= 0) throw timedOut();
      let file;
      if (audio) {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stt-'));
        file = path.join(dir, 'clip');
        fs.writeFileSync(file, audio, { mode: 0o600 });
      }
      const reply = await run({ id, op, path: file, language: language || null }, budget);
      const timings = { ...reply.timings, ...base, queueMs, totalMs: Math.round((performance.now() - enqueued) * 10) / 10 };
      remember(timings, 'ok');
      resolve({ ...reply, timings });
    } catch (error) {
      const timings = { ...error.timings, ...base, queueMs, totalMs: Math.round((performance.now() - enqueued) * 10) / 10 };
      remember(timings, 'error');
      reject(Object.assign(error, { timings }));
    } finally { if (dir) fs.rmSync(dir, { recursive: true, force: true }); }
  });
  chain = job.catch(() => {});
  return result.finally(() => { clearTimeout(queueTimer); pendingJobs--; });
}

// Freelance Desk's voice helper (one Hebrew fine-tune of Whisper large-v3 that writes
// Hebrew, English and mixed speech correctly) already runs on this PC. Use it first;
// our own worker is the fallback when it is not running. Tests bring their own worker.
const deskUrl = () => process.env.TC_DESK_STT_URL || 'http://127.0.0.1:8791';
const useDesk = () => process.env.TC_DESK_STT !== '0' && (!process.env.TC_STT_WORKER || Boolean(process.env.TC_DESK_STT_URL));

async function viaDesk(audio, uploadMs) {
  const started = performance.now();
  let res;
  try {
    res = await fetch(`${deskUrl()}/transcribe`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: audio, signal: AbortSignal.timeout(JOB_MS) });
  } catch { return null; }   // not running: fall back
  if (!res.ok) return null;
  const out = await res.json().catch(() => null);
  if (!out) return null;
  const timings = { engine: 'desk', bytes: audio.length, totalMs: Math.round((performance.now() - started) * 10) / 10, ...(typeof uploadMs === 'number' ? { uploadMs } : {}) };
  remember(timings, out.text ? 'ok' : 'error');
  if (!out.text) throw Object.assign(new Error(out.reason === 'silent' ? 'No sound reached the microphone.' : 'No words were heard. Try again a little closer to the mic.'), { timings });
  return { text: out.text, language: /[֐-׿]/.test(out.text) ? 'he' : 'en', seconds: out.secs, timings };
}

/** Turns one recorded clip into text. `language` is 'he', 'en' or empty for automatic. */
export async function transcribe(audio, { language, uploadMs } = {}) {
  if (!audio?.length) throw new Error('No audio was received.');
  if (audio.length > MAX_AUDIO_BYTES) throw new Error('That recording is too long.');
  if (useDesk()) { const r = await viaDesk(audio, uploadMs); if (r) return r; }
  return submit(audio, language, 'transcribe', uploadMs);
}

/** Best effort while recording. Coalesce hints and never queue behind dictation. */
export function prepareTranscriber({ language } = {}) {
  if (process.env.TC_STT_PREPARE === '0') return Promise.resolve({ prepared: false });
  if (preparing) return preparing;
  if (pendingJobs) return Promise.resolve({ prepared: false });
  preparing = submit(null, language, 'prepare').finally(() => { preparing = null; });
  return preparing;
}

export const stopTranscriber = stop;
