import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('voice typing uses the Desk voice helper (Hebrew, English and mixed) and says plainly when nothing was heard', async () => {
  let got = 0;
  const helper = http.createServer((req, res) => {
    let n = 0; req.on('data', (c) => { n += c.length; });
    req.on('end', () => { got = n; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(n > 5 ? { text: 'תפתח את ה-sidebar בבקשה', secs: 0.6 } : { text: '', reason: 'silent' })); });
  });
  await new Promise((r) => helper.listen(0, '127.0.0.1', r));
  process.env.TC_DESK_STT_URL = `http://127.0.0.1:${helper.address().port}`;
  try {
    const { transcribe } = await import(`../bridge/transcribe/index.mjs?desk=${Date.now()}`);
    const r = await transcribe(Buffer.from('0123456789'), {});
    assert.equal(r.text, 'תפתח את ה-sidebar בבקשה');
    assert.equal(r.timings.engine, 'desk');
    assert.equal(got, 10, 'the whole clip was sent');
    await assert.rejects(transcribe(Buffer.from('01'), {}), /No sound reached the microphone/);
  } finally { helper.close(); delete process.env.TC_DESK_STT_URL; }
});
