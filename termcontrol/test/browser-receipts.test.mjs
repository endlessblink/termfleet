import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { recordBrowserReceipt, hasBrowserReceipt } from '../bridge/browser-receipts.mjs';
import { mcpProxy } from '../../scripts/termfleet-browser.mjs';

const tick = () => new Promise(r => setTimeout(r, 10));
test('browser receipts are scoped to bot, URL and freshness, without storing credentials', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-browser-receipt-'));
  try {
    recordBrowserReceipt({botId:'0123456789ab',url:'https://example.test/review#fight',at:1000},{dir});
    assert.equal(hasBrowserReceipt({botId:'0123456789ab',url:'https://example.test/review#select',since:999},{dir}),true);
    assert.equal(hasBrowserReceipt({botId:'abcdef012345',url:'https://example.test/review'},{dir}),false);
    assert.equal(hasBrowserReceipt({botId:'0123456789ab',url:'https://example.test/other'},{dir}),false);
    assert.equal(hasBrowserReceipt({botId:'0123456789ab',url:'https://example.test/review',since:1001},{dir}),false);
    assert.equal(recordBrowserReceipt({botId:'0123456789ab',url:'https://user:secret@example.test/'},{dir}),false);
    assert.equal(recordBrowserReceipt({botId:'../escape',url:'https://example.test/'},{dir}),false);
    assert.doesNotMatch(fs.readFileSync(path.join(dir,'0123456789ab.json'),'utf8'),/secret|user:/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('MCP proxy records only matched successful navigations and preserves split output bytes', async () => {
  const input=new PassThrough(), output=new PassThrough();
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough()});
  const receipts=[]; let actual=''; output.on('data',c=>actual+=c);
  await mcpProxy({input,output,launch:()=>child,browser:{start:async()=>({ok:true})},server:{command:'fixture',args:[]},bot:{id:'0123456789ab'},windowProxy:async()=>null,recordReceipt:r=>receipts.push(r)});
  const request=(id,url)=>input.write(JSON.stringify({id,method:'tools/call',params:{name:'browser_navigate',arguments:{url}}})+'\n');
  request(1,'https://example.test/good'); request(2,'https://example.test/bad'); request(3,'https://example.test/transport');
  await tick(); assert.equal(receipts.length,0,'request is not proof');
  const chunks=['{"id":1,"res','ult":{"content":[{"type":"text","text":"Page URL: https://example.test/good"}]}}\n', '{"id":2,"result":{"isError":true,"content":[]}}\n{"id":3,"error":{"code":-1}}\n{"id":99,"result":{}}\n'];
  chunks.forEach(c=>child.stdout.write(c)); await tick();
  assert.equal(actual,chunks.join(''),'stdout bytes remain unchanged');
  assert.deepEqual(receipts,[{botId:'0123456789ab',url:'https://example.test/good'}]);
});
