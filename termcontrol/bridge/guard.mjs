// Request guards for the TermControl bridge (TC-086 / TC-122 / TC-123).

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export const isLoopbackPeer = (req) => LOOPBACK.has(String(req.socket?.remoteAddress || ''));

/**
 * Who is asking, for rate limiting. Forwarding headers are written by the client
 * unless a proxy on this machine sets them, so they are only believed when the
 * connection itself comes from this machine (the tunnel/proxy).
 */
export function clientKey(req) {
  const peer = String(req.socket?.remoteAddress || 'unknown');
  if (!isLoopbackPeer(req)) return peer;
  const forwarded = String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
    .split(',')[0].trim();
  return forwarded || peer;
}

/**
 * A page on another site must not be able to make this browser send commands.
 * Browsers always attach Origin to cross-site writes; it has to name this server.
 * No Origin (curl, the app's own tools) is allowed.
 */
export function crossSiteWrite(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false;
  const origin = req.headers.origin;
  if (!origin) return false;
  let host;
  try { host = new URL(origin).host; } catch { return true; }
  const allowed = [req.headers.host, req.headers['x-forwarded-host']]
    .filter(Boolean).map((value) => String(value).split(',')[0].trim());
  return !allowed.includes(host);
}

/** A malformed Host header must not be able to crash the request handler. */
export function safeUrl(req) {
  try { return new URL(req.url, `http://${req.headers.host}`); } catch { return null; }
}
