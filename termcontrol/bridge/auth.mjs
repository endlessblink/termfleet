import {
  hasAccount, createAccount, verify, verifyOwner, resetOwnerPassword, mintRecoveryToken,
  verifyRecoveryToken, mintSession, readSession, tooManyAttempts,
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

function isLocalRecoveryRequest(req, url) {
  const remote = String(req.socket.remoteAddress || '');
  const localRemote = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const localHost = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  const forwarded = req.headers.forwarded || req.headers['x-forwarded-for']
    || req.headers['cf-connecting-ip'] || req.headers['cf-ray'];
  return localRemote && localHost && !forwarded;
}

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
  const recover = url.pathname === '/recover';
  if (!setup && !login && !logout && !recover) return false;

  if (recover && !isLocalRecoveryRequest(req, url)) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end('Not found');
    return true;
  }

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

  if (recover) {
    if (req.method === 'POST') {
      const f = await body(req);
      if (!verifyRecoveryToken(f.get('recoveryToken'))) {
        return page(res, 403, {
          mode: 'recover',
          error: 'This recovery form expired. Try again.',
          recoveryToken: mintRecoveryToken(),
        });
      }
      const reset = resetOwnerPassword(f.get('password'));
      if (reset.error) {
        return page(res, 400, {
          mode: 'recover',
          error: reset.error,
          recoveryToken: mintRecoveryToken(),
        });
      }
      return setSession(res, reset.user);
    }
    return page(res, 200, { mode: 'recover', recoveryToken: mintRecoveryToken() });
  }

  if (setup) { res.writeHead(302, { location: '/login' }); res.end(); return true; }

  if (req.method === 'POST') {
    const f = await body(req);
    const user = verifyOwner(f.get('password'));
    if (!user) {
      if (tooManyAttempts(clientIp(req))) {
        return page(res, 429, { mode: 'login', error: 'Too many tries. Wait five minutes.' });
      }
      return page(res, 401, { mode: 'login', error: 'Wrong password.' });
    }
    return setSession(res, user);
  }

  return page(res, 200, { mode: 'login' });
}

export function requireAuth(res) {
  res.writeHead(302, { location: hasAccount() ? '/login' : '/setup' });
  res.end();
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function page(res, code, { mode, error, email, recoveryToken }) {
  const isSetup = mode === 'setup';
  const isRecover = mode === 'recover';
  const html = `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#141413">
<title>TermControl</title>
<style>
 :root{color-scheme:dark;--bg:#141413;--surface:#1c1c1a;--line:#2f2f2b;--text:#f0eee6;--muted:#9a9993;--accent:#d97757}
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
 input:focus-visible{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent)}
 button:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--accent)}
 button{width:100%;padding:15px;border-radius:12px;border:0;background:var(--accent);color:#191512;
        font-size:16px;font-weight:600;font-family:inherit;cursor:pointer}
 button:active{opacity:.85}
 .err{background:#2a1d16;border:1px solid #5a3a26;color:#f0c9a6;font-size:14px;
      padding:10px 12px;border-radius:10px;margin-bottom:16px}
 .hint{color:var(--muted);font-size:13px;text-align:center;margin-top:16px;line-height:1.45}
 .rule{color:var(--muted);font-size:13px;margin:-8px 2px 16px}
</style>
<form method="post" role="main" action="${isSetup ? '/setup' : isRecover ? '/recover' : '/login'}">
  <div class="brand">
    <h1>TermControl</h1>
    <p>${isSetup ? 'Create your sign-in.' : isRecover ? 'Reset your sign-in.' : 'Sign in to see your terminals.'}</p>
  </div>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ''}
  ${isRecover ? `<input type="hidden" name="recoveryToken" value="${esc(recoveryToken)}">` : ''}
  ${isSetup ? `<label for="email">Email</label>
  <input id="email" type="email" name="email" autocomplete="username" inputmode="email"
         autocapitalize="none" autocorrect="off" required value="${esc(email)}" autofocus>` : ''}
  <label for="password">Password</label>
  <input id="password" type="password" name="password"
         autocomplete="${isSetup || isRecover ? 'new-password' : 'current-password'}" required
         ${isSetup || isRecover ? 'minlength="8"' : ''}>
  ${isSetup || isRecover ? '<div class="rule">Use at least 8 characters.</div>' : ''}
  <button type="submit">${isSetup ? 'Create and open' : isRecover ? 'Reset and open' : 'Sign in'}</button>
  ${isSetup ? '<div class="hint">This is the only account. Nobody else can sign up afterwards.</div>'
            : isRecover ? '<div class="hint">No old password is needed. This page is available only on this PC. Then use the new password on your phone.</div>'
            : '<div class="hint">No password yet? On your TermFleet PC open<br><strong>http://127.0.0.1:7810/recover</strong><br>You stay signed in on this phone.</div>'}
</form>`;
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
  return true;
}
