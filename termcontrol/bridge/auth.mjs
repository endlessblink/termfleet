import crypto from 'node:crypto';

/**
 * A single shared passphrase, held in TC_TOKEN. This is the app's own lock; it
 * sits *behind* whatever the tunnel enforces, so a misconfigured tunnel can
 * never leave the cockpit open. Without TC_TOKEN the bridge refuses to bind to
 * anything except loopback.
 */
const TOKEN = process.env.TC_TOKEN || '';
export const authRequired = TOKEN.length > 0;

const COOKIE = 'tc_auth';
const stamp = TOKEN ? crypto.createHash('sha256').update(`termcontrol:${TOKEN}`).digest('hex') : '';

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthed(req) {
  if (!authRequired) return true;
  const c = cookies(req)[COOKIE];
  if (c && safeEqual(c, stamp)) return true;
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') && safeEqual(header.slice(7), TOKEN);
}

/** Returns true when it handled the request. */
export function handleLogin(req, res, url) {
  if (url.pathname !== '/login') return false;

  if (req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const given = new URLSearchParams(body).get('key') || '';
      if (!safeEqual(given, TOKEN)) return sendPage(res, 401, 'That key is not right.');
      res.writeHead(302, {
        'set-cookie': `${COOKIE}=${stamp}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 120}`,
        location: '/',
      });
      res.end();
    });
    return true;
  }

  sendPage(res, 200, '');
  return true;
}

export function requireAuth(res) {
  res.writeHead(302, { location: '/login' });
  res.end();
}

function sendPage(res, code, message) {
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>TermControl</title>
<style>
 :root{--bg:#141413;--surface:#1c1c1a;--line:#2f2f2b;--text:#f0eee6;--muted:#8b8a85;--accent:#d97757}
 *{box-sizing:border-box}
 body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);
      font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:24px}
 form{width:100%;max-width:320px;text-align:center}
 h1{font-size:19px;font-weight:600;margin:0 0 6px;letter-spacing:-.01em}
 p{color:var(--muted);font-size:14px;margin:0 0 22px}
 input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid var(--line);
       background:var(--surface);color:var(--text);font-size:16px;margin-bottom:12px}
 input:focus{outline:none;border-color:var(--accent)}
 button{width:100%;padding:14px;border-radius:12px;border:0;background:var(--accent);
        color:#1a1613;font-size:16px;font-weight:600}
 .err{color:#e0a458;font-size:13px;margin-bottom:12px}
</style>
<form method="post" action="/login">
  <h1>TermControl</h1>
  <p>Enter your key to see your terminals.</p>
  ${message ? `<div class="err">${message}</div>` : ''}
  <input type="password" name="key" autocomplete="current-password" autofocus placeholder="key">
  <button type="submit">Unlock</button>
</form>`;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
