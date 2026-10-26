// Navigation receipts prove which bot opened a URL. Store URL hashes, never page
// content, credentials or query strings. The caller separately checks reachability.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';

const defaultDir = () => process.env.TERMFLEET_BROWSER_RECEIPTS_DIR || path.join(os.homedir(), '.local/share/terminal-workspace/bot-browser/receipts');
function keyFor(url) {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    parsed.hash = '';
    return createHash('sha256').update(parsed.href).digest('hex');
  } catch { return null; }
}
function receiptFile(botId, dir) { return /^[a-f0-9]{12}$/.test(botId || '') ? path.join(dir, `${botId}.json`) : null; }
function read(file) { try { const data=JSON.parse(fs.readFileSync(file,'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; } catch { return {}; } }

export function recordBrowserReceipt({botId,url,at=Date.now()}, {dir=defaultDir()}={}) {
  const file=receiptFile(botId,dir), key=keyFor(url), stamp=Number(at);
  if (!file || !key || !Number.isFinite(stamp)) return false;
  let tmp;
  try {
    fs.mkdirSync(dir,{recursive:true,mode:0o700});
    const data=read(file); data[key]=stamp;
    const bounded=Object.fromEntries(Object.entries(data).sort((a,b)=>b[1]-a[1]).slice(0,200));
    tmp=`${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(tmp,JSON.stringify(bounded),{mode:0o600}); fs.renameSync(tmp,file);
    return true;
  } catch { return false; }
  finally {if(tmp)try{fs.unlinkSync(tmp);}catch{}}
}

export function hasBrowserReceipt({botId,url,since=0}, {dir=defaultDir()}={}) {
  const file=receiptFile(botId,dir), key=keyFor(url);
  if (!file || !key) return false;
  const at=read(file)[key];
  return Number.isFinite(at) && at >= Number(since);
}
