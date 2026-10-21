import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { applyEnglishTerms } from '../bridge/english-terms.mjs';

// Noam 2026-10-21: "כשאני מקליט בעברית אבל משתמש במושגים ובמילים באנגלית תוך כדי, הם צריכים
// להופיע באנגלית בלי שגיאות במקום הנכון תוך כדי שמירה על right to left."
const html = fs.readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../bridge/transcribe/worker.py', import.meta.url), 'utf8');

test('English terms heard as Hebrew sounds go back to English, in place, prefix kept with a dash', () => {
  // Real outputs of the Hebrew model on mixed clips (2026-10-21).
  const cases = [
    ['אני רוצה ש-Claude יבדוק את ה-dashboard, ואחר כך נעבור לאפתר אפקטס.', 'אני רוצה ש-Claude יבדוק את ה-dashboard, ואחר כך נעבור ל-After Effects.'],
    ['תריץ גריל me על התוכנית, ואז תעדכן את הוורקפלו ב-n8n.', 'תריץ grill me על התוכנית, ואז תעדכן את ה-workflow ב-n8n.'],
    ['ותשלח לקלוד קוד את הקובץ', 'ותשלח ל-Claude Code את הקובץ'],
    ['הדשבורת של הפרילנס, דסק, לא מראה את המשרות', 'ה-dashboard של ה-Freelance Desk, לא מראה את המשרות'],
    ['תפתח את ראף קאט ותבקש מקלוד', 'תפתח את Rough Cut ותבקש מ-Claude'],
  ];
  for (const [heard, want] of cases) assert.equal(applyEnglishTerms(heard).text, want);
  assert.equal(applyEnglishTerms('Open the dashboard in Claude').text, 'Open the dashboard in Claude', 'English dictation untouched');
  assert.equal(applyEnglishTerms('הלכנו לים והיה כיף').changed, 0, 'plain Hebrew untouched');
  assert.equal(applyEnglishTerms('המשקלות כבדים').changed, 0, 'a term inside a longer Hebrew word is not touched');
});

test('the Hebrew model starts from a mixed Hebrew-English example', () => {
  assert.match(worker, /if language == "he" and MIXED_PROMPT:\n\s+options\["initial_prompt"\] = MIXED_PROMPT/);
  assert.match(worker, /MIXED_PROMPT = .*"[^"]*ש?Claude[^"]*ה-dashboard[^"]*"/s);
});

// The worker stand-in answers what the Hebrew model really wrote for such a clip.
const STUB = `
import json, sys
print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    r = json.loads(line)
    print(json.dumps({"id": r["id"], "text": "קלוד צריך לבדוק את הדשבורד באפטר אפקטס.", "language": "he", "seconds": 0.01}, ensure_ascii=False), flush=True)
`;

test('end to end in a bot chat: dictated Hebrew with English terms comes out in English and reads right to left', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-mixed-'));
  const configDir = path.join(tmp, 'cfg'), botsHome = path.join(tmp, 'home');
  for (const d of [configDir, botsHome]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'stub.py'), STUB);
  const port = 7550 + Math.floor(Math.random() * 200);
  // A private bridge; the brain is /bin/false, so no model is ever called.
  const bridge = spawn(process.execPath, [fileURLToPath(new URL('../bridge/server.mjs', import.meta.url))], { env: { ...process.env, TC_PORT: String(port), TC_CONFIG_DIR: configDir, TC_HOST: '127.0.0.1', TC_BOTS_HOME: botsHome, TC_CLAUDE_BIN: '/bin/false', TC_CODEX_BIN: '/bin/false', TC_NO_AGENT_HEALTH: '1', TC_STT_WORKER: path.join(tmp, 'stub.py'), TC_WHISPER_PY: '/usr/bin/python3' }, stdio: 'ignore' });
  const browser = await chromium.launch();
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${port}/login`); break; } catch { await new Promise((r) => setTimeout(r, 150)); } }
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => {
      localStorage.setItem('termcontrol-fleet-tab', 'bots');
      Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
      window.MediaRecorder = class {
        static isTypeSupported(t) { return t === 'audio/webm'; }
        constructor() { this.mimeType = 'audio/webm'; }
        start() {}
        stop() { this.ondataavailable({ data: new Blob([new Uint8Array(64)]) }); this.onstop(); }
      };
    });
    await page.goto(`http://localhost:${port}/`);
    await page.evaluate(() => { const e = document.querySelector('#email'); if (e) e.value = 'owner@example.test'; document.querySelector('#password').value = 'a-good-password'; document.querySelector('form').requestSubmit(); });
    await page.waitForFunction(() => document.querySelector('.bots-home'), null, { timeout: 20000, polling: 250 });
    const botId = await page.evaluate(async () => (await (await fetch('/api/bots', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Freelance-desk_dev' }) })).json()).bot.id);
    await page.evaluate((bid) => { location.hash = 'bot:' + bid; }, botId);
    const box = page.locator('.composer textarea').first();
    await box.waitFor({ timeout: 15000 });
    await box.focus();   // already focused: no focus event after dictation
    await page.evaluate(() => document.querySelector('.bot-mic').click());   // start
    await page.waitForSelector('.bot-mic.rec', { state: 'attached', timeout: 5000 });
    await page.evaluate(() => document.querySelector('.bot-mic').click());   // stop -> transcribe
    const want = 'Claude צריך לבדוק את ה-dashboard ב-After Effects.';
    await page.waitForFunction((t) => document.querySelector('.composer textarea').value === t, want, { timeout: 15000 });
    assert.equal(await box.getAttribute('dir'), 'rtl', 'a Hebrew line that starts with an English word reads right to left');
  } finally { await browser.close(); bridge.kill('SIGKILL'); fs.rmSync(tmp, { recursive: true, force: true }); }
});
