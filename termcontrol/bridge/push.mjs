import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * Phone notifications for bots (TF-096 part 7; Noam chose "App notification":
 * a normal phone notification from the agents app, on/off per bot).
 *
 * Standard Web Push without a payload: the push only wakes the phone's service
 * worker, which then fetches the newest notification from the signed-in bridge.
 * So no message text passes through the push service, and no payload encryption
 * is needed. The bridge signs each push with its own VAPID key (ES256).
 */

const defaultDir = () => process.env.TC_CONFIG_DIR || path.join(os.homedir(), '.config', 'termcontrol');
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class Push {
  constructor({ dir = defaultDir(), now = () => Date.now(), fetchImpl = (...a) => fetch(...a) } = {}) {
    this.file = path.join(dir, 'push.json');
    this.now = now;
    this.fetch = fetchImpl;
    this.lastSeenVisible = 0;
  }

  read() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return { subscriptions: [], queue: [] }; }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  /** The bridge's own key pair, made once. The public half goes to the phone. */
  keys() {
    const data = this.read();
    if (data.vapid?.privateKey && data.vapid?.publicKey) return data.vapid;
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = publicKey.export({ format: 'jwk' });
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
    data.vapid = { privateKey: privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey: b64url(raw) };
    this.write(data);
    return data.vapid;
  }

  subscribe(subscription) {
    const endpoint = String(subscription?.endpoint || '');
    if (!/^https:\/\//.test(endpoint)) return { error: 'That is not a notification address.' };
    const data = this.read();
    data.subscriptions = (data.subscriptions || []).filter((s) => s.endpoint !== endpoint);
    data.subscriptions.push({ endpoint, at: this.now() });
    this.write(data);
    return { ok: true };
  }

  /** Noam is looking at the app right now (the page says so while it is visible). */
  seen() { this.lastSeenVisible = this.now(); }

  /** The signed token a push service asks for (RFC 8292). */
  token(endpoint) {
    const { privateKey, publicKey } = this.keys();
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(this.now() / 1000) + 12 * 3600, sub: 'mailto:termfleet@localhost' }));
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return { jwt: `${header}.${claims}.${b64url(signature)}`, publicKey };
  }

  /**
   * Queue a notification and wake the phone, unless Noam has the app open
   * (Grok Bot does not notify while the app is focused).
   */
  async notify({ title, body, url = '/' }) {
    const data = this.read();
    const entry = { id: crypto.randomBytes(6).toString('hex'), title: String(title).slice(0, 80), body: String(body).slice(0, 240), url, at: this.now() };
    data.queue = [...(data.queue || []), entry].slice(-50);
    this.write(data);
    if (this.now() - this.lastSeenVisible < 60_000) return { queued: true, sent: 0, reason: 'app open' };
    let sent = 0;
    const keep = [];
    for (const sub of data.subscriptions || []) {
      try {
        const { jwt, publicKey } = this.token(sub.endpoint);
        const res = await this.fetch(sub.endpoint, { method: 'POST', headers: { TTL: '3600', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${publicKey}`, 'Content-Length': '0' }, signal: AbortSignal.timeout(10_000) });
        if (res.status === 404 || res.status === 410) continue;   // the phone unsubscribed
        if (res.ok) sent++;
        keep.push(sub);
      } catch { keep.push(sub); }
    }
    if (keep.length !== (data.subscriptions || []).length) { const fresh = this.read(); fresh.subscriptions = keep; this.write(fresh); }
    return { queued: true, sent };
  }

  /** The last phone sign-up failure, kept for diagnosis. */
  noteProblem(text) { const data = this.read(); data.lastProblem = { text: String(text).slice(0, 400), at: this.now() }; this.write(data); }

  /** What the phone shows when woken: the newest notification. */
  latest() { return (this.read().queue || []).at(-1) || null; }
}
