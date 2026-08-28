import {
  hasAccount, createAccount, verify, mintSession, readSession, tooManyAttempts,
} from './accounts.mjs';

const COOKIE = 'tc_session';

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function currentUser(req) {
  return readSession(cookies(req)[COOKIE]);
}

const clientIp = (req) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim();

function body(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 8192) req.destroy(); });
    req.on('end', () => resolve(new URLSearchParams(data)));
  });
}

function setSession(res, user, to = '/') {
  const s = mintSession(user);
  res.writeHead(302, {
    'set-cookie': `${COOKIE}=${s.value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${s.maxAge}`,
    location: to,
  });
  res.end();
  return true;
}

/** Returns true when this request was an auth route and has been handled. */
export async function handleAuthRoutes(req, res, url) {
  const setup = url.pathname === '/setup';
  const login = url.pathname === '/login';
  const logout = url.pathname === '/logout';
  if (!setup && !login && !logout) return false;

  if (logout) {
    res.writeHead(302, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`, location: '/login' });
    res.end();
    return true;
  }

  // First run: nobody has claimed this cockpit yet.
  if (!hasAccount()) {
    if (req.method === 'POST') {
      const f = await body(req);
      const made = createAccount(f.get('email'), f.get('password'));
      if (made.error) return page(res, 400, { mode: 'setup', error: made.error, email: f.get('email') });
      const user = verify(f.get('email'), f.get('password'));
      return setSession(res, user);
    }
    return page(res, 200, { mode: 'setup' });
  }

  if (setup) { res.writeHead(302, { location: '/login' }); res.end(); return true; }

  if (req.method === 'POST') {
    if (tooManyAttempts(clientIp(req))) {
      return page(res, 429, { mode: 'login', error: 'Too many tries. Wait five minutes.' });
    }
    const f = await body(req);
    const user = verify(f.get('email'), f.get('password'));
    if (!user) return page(res, 401, { mode: 'login', error: 'Wrong email or password.', email: f.get('email') });
    return setSession(res, user);
  }

  return page(res, 200, { mode: 'login' });
}

export function requireAuth(res) {
  res.writeHead(302, { location: hasAccount() ? '/login' : '/setup' });
  res.end();
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(res, code, { mode, error, email }) {
  const isSetup = mode === 'setup';
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#141413">
<title>TermControl</title>
<style>
 :root{--bg:#141413;--surface:#1c1c1a;--line:#2f2f2b;--text:#f0eee6;--muted:#8b8a85;--accent:#d97757}
 *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
 body{margin:0;min-height:100dvh;display:grid;place-items:center;background:var(--bg);color:var(--text);
      font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
      padding:24px calc(24px + env(safe-area-inset-left)) calc(24px + env(safe-area-inset-bottom))}
 form{width:100%;max-width:330px}
 .brand{text-align:center;margin-bottom:26px}
 .brand h1{font-size:21px;font-weight:600;margin:0 0 4px;letter-spacing:-.02em}
 .brand p{color:var(--muted);font-size:14px;margin:0}
 label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px 2px;text-transform:uppercase;letter-spacing:.05em;font-weight:600}
 input{width:100%;padding:14px 15px;border-radius:12px;border:1px solid var(--line);background:var(--surface);
       color:var(--text);font-size:16px;margin-bottom:16px;font-family:inherit}
 input:focus{outline:none;border-color:var(--accent)}
 button{width:100%;padding:15px;border-radius:12px;border:0;background:var(--accent);color:#191512;
        font-size:16px;font-weight:600;font-family:inherit;cursor:pointer}
 button:active{opacity:.85}
 .err{background:#2a1d16;border:1px solid #5a3a26;color:#e8b58c;font-size:13.5px;
      padding:10px 12px;border-radius:10px;margin-bottom:16px}
 .hint{color:var(--muted);font-size:12.5px;text-align:center;margin-top:16px;line-height:1.45}
 .rule{color:var(--muted);font-size:12.5px;margin:-8px 2px 16px}
</style>
<form method="post" action="${isSetup ? '/setup' : '/login'}">
  <div class="brand">
    <h1>TermControl</h1>
    <p>${isSetup ? 'Create your sign-in.' : 'Sign in to see your terminals.'}</p>
  </div>
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  <label for="email">Email</label>
  <input id="email" type="email" name="email" autocomplete="username" inputmode="email"
         autocapitalize="none" autocorrect="off" required value="${esc(email)}" ${isSetup ? 'autofocus' : ''}>
  <label for="password">Password</label>
  <input id="password" type="password" name="password"
         autocomplete="${isSetup ? 'new-password' : 'current-password'}" required
         ${isSetup ? 'minlength="8"' : ''}>
  ${isSetup ? '<div class="rule">Use at least 8 characters.</div>' : ''}
  <button type="submit">${isSetup ? 'Create and open' : 'Sign in'}</button>
  ${isSetup ? '<div class="hint">This is the only account. Nobody else can sign up afterwards.</div>'
            : '<div class="hint">You stay signed in on this phone.</div>'}
</form>`;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
  return true;
}
