// Voice to text for the phone and desktop page, done entirely on this machine
// (faster-whisper; Hebrew model for Hebrew, large-v3 for English).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const PYTHON = process.env.TC_WHISPER_PY || path.join(os.homedir(), '.venvs', 'whisper', 'bin', 'python');
const IDLE_MS = Number(process.env.TC_STT_IDLE_MS || 10 * 60 * 1000);
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

let worker = null;
let buffer = '';
let idleTimer = null;
const waiting = new Map();
let chain = Promise.resolve(); // one clip at a time: models are big

function stop() {
  if (worker) { worker.kill(); worker = null; }
  for (const { reject } of waiting.values()) reject(new Error('Transcription stopped.'));
  waiting.clear();
}

function start() {
  if (worker) return;
  if (!fs.existsSync(PYTHON)) throw new Error('Speech recognition is not installed on this machine.');
  worker = spawn(PYTHON, [process.env.TC_STT_WORKER || path.join(here, 'worker.py')], { stdio: ['pipe', 'pipe', 'ignore'], env: process.env });
  buffer = '';
  worker.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      let message; try { message = JSON.parse(line); } catch { continue; }
      const pending = waiting.get(message.id);
      if (!pending) continue;
      waiting.delete(message.id);
      if (message.error) pending.reject(new Error(message.error)); else pending.resolve(message);
    }
  });
  worker.on('exit', () => { worker = null; for (const { reject } of waiting.values()) reject(new Error('Speech recognition stopped unexpectedly.')); waiting.clear(); });
}

function run(file, language) {
  start();
  clearTimeout(idleTimer);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    worker.stdin.on('error', () => {});
    worker.stdin.write(JSON.stringify({ id, path: file, language: language || null }) + '\n');
  }).finally(() => { idleTimer = setTimeout(stop, IDLE_MS); idleTimer.unref?.(); });
}

/** Turns one recorded clip into text. `language` is 'he', 'en' or empty for automatic. */
export function transcribe(audio, { language } = {}) {
  if (!audio?.length) return Promise.reject(new Error('No audio was received.'));
  if (audio.length > MAX_AUDIO_BYTES) return Promise.reject(new Error('That recording is too long.'));
  const job = chain.then(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-stt-'));
    const file = path.join(dir, 'clip');
    fs.writeFileSync(file, audio, { mode: 0o600 });
    try { return await run(file, language); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  chain = job.catch(() => {});
  return job;
}

export const stopTranscriber = stop;
