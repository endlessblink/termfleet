#!/usr/bin/env node
// Bot steer hook (R-7173): after each tool step of a bot's running turn, hands it the
// messages Noam sent meanwhile that ask for something (the bridge leaves them in the bot's
// steer inbox, named by TERMFLEET_BOT_STEER). Claude gets it through --settings on the
// bot's own command; Codex through the action-log hook, which calls steer() below.
// Outside a bot brain it does nothing. Never blocks, always exits 0.
import { steerHookOutput } from '../termcontrol/bridge/side-reply.mjs';

export function steer(payload = {}, env = process.env) {
  const folder = String(env.TERMFLEET_BOT_STEER || '');
  if (!folder || !env.TERMFLEET_BOT_ID) return null;
  const event = String(payload.hook_event_name || payload.hookEventName || 'PostToolUse');
  if (event !== 'PostToolUse') return null;
  return steerHookOutput(folder);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => { raw += c; });
  process.stdin.on('end', () => {
    try { const out = steer(JSON.parse(raw || '{}')); if (out) process.stdout.write(JSON.stringify(out)); } catch { /* never in the bot's way */ }
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
