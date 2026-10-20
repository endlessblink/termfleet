import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const digest = answer => createHash('sha256').update(String(answer)).digest('hex');

// Reserve before any key is written. A lost HTTP response or bridge restart
// must never turn a retry into a second terminal action.
export class ChoiceReceipts {
  constructor(file) {
    this.file = file; this.records = {};
    try {
      const records=JSON.parse(fs.readFileSync(file, 'utf8'));
      if(!records || typeof records!=='object' || Array.isArray(records))this.unavailable=true;
      else this.records=records;
    }
    catch (error) { if (error.code !== 'ENOENT') this.unavailable = true; }
  }
  key(pane, askId) { return JSON.stringify([pane, askId]); }
  get(pane, askId) {
    const record = this.records[this.key(pane, askId)] || null;
    // A prompt read off the screen is marked sent only once it was seen to close,
    // so the same prompt showing again is a new one (a hook asking twice).
    return record && record.state === 'sent' && String(askId).includes('prompt:') ? null : record;
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temp = `${this.file}.tmp`; fs.writeFileSync(temp, JSON.stringify(this.records), { mode: 0o600 }); fs.renameSync(temp, this.file);
  }
  async send(pane, askId, answer, dispatch) {
    if (this.unavailable) return { error: 'Answer history cannot be read. Check the terminal before sending.' };
    const key = this.key(pane, askId), old = this.get(pane, askId);
    if (old && old.state !== 'not-sent') {
      if (old.answerHash !== digest(answer)) return { error: 'An answer was already sent for this question. Check the terminal.' };
      return old.state === 'sent' ? { ok: true, duplicate: true, sentAt: old.at, delivery: 'terminal' }
        : { error: 'Delivery is unconfirmed. Check the terminal before answering again.', uncertain: true };
    }
    const at = Date.now(); this.records[key] = { state:'dispatching', at, answerHash:digest(answer) };
    try { this.save(); } catch { delete this.records[key]; return { error:'Could not reserve this answer. Nothing was sent.' }; }
    let result;
    try { result = await dispatch(); } catch (error) { console.error('[bridge] answer delivery failed:', error?.message || error); result ={ error:'Delivery is unconfirmed. Check the terminal.', uncertain:true }; }
    this.records[key] = { state:result.ok?'sent':result.notSent?'not-sent':'uncertain', at, answerHash:digest(answer) };
    try { this.save(); } catch { return { error:'Delivery is unconfirmed. Check the terminal before trying again.', uncertain:true }; }
    return result.ok ? { ...result, delivery:'terminal', sentAt:result.sentAt || at } : result;
  }
}
