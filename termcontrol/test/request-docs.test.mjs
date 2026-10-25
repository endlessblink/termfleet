// Agent-Manager 2026-10-25 (Noam: "אז תעשה את זה"): a request marked ready or done gets an
// Obsidian note with his words, what was done, the evidence, the status and the dates.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureMessage } from '../bridge/requirements.mjs';
import { requestDocsDir, VAULT_REQUESTS, docName } from '../bridge/request-docs.mjs';
import { cli } from '../../scripts/termfleet-asks.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'req-docs-'));

test('marking ready writes the note; marking done updates the same note; partial writes nothing', () => {
  const dir = tmp(), docs = tmp();
  const env = { TERMFLEET_REQ_DIR: dir, TERMFLEET_REQUEST_DOCS_DIR: docs, TERMFLEET_PANE_ID: 'terminal-t' };
  const [item] = captureMessage({ text: 'שהכפתור תמיד יופיע כאן', project: 'politic-figther_dev', source: 'bot:d557f3283bc8' }, { dir });
  const shot = path.join(tmp(), 'pinned-390.png'); fs.writeFileSync(shot, 'png');

  assert.equal(cli([`partial`, item.id, '--open', 'phone check'], env).ok, true);
  assert.deepEqual(fs.readdirSync(docs), []);

  const r = cli(['ready', item.id, '--evidence', `pinned card stays in view: ${shot}`, 'card pinned at the bottom of the chat'], env);
  assert.equal(r.ok, true, r.message);
  const [name] = fs.readdirSync(docs);
  assert.equal(name, docName(item));
  assert.match(r.message, /Note: .*\.md/);
  const note = fs.readFileSync(path.join(docs, name), 'utf8');
  assert.match(note, /^---\nrequest: R-\d+\nstatus: ready\nproject: "politic-figther_dev"/);
  assert.match(note, /## Noam's words\n\n> שהכפתור תמיד יופיע כאן/);
  assert.match(note, /## What was done\n\ncard pinned at the bottom of the chat/);
  assert.match(note, new RegExp(`\\[pinned-390\\.png\\]\\(<file://${shot.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}>\\)`), 'the screenshot is a clickable link');
  assert.match(note, /## Status\n\n\*\*ready\*\* since \d{4}-\d\d-\d\d \d\d:\d\d/);

  assert.equal(cli(['done', item.id, '--evidence', `Noam tapped it on the phone: ${shot}`], env).ok, true);
  assert.deepEqual(fs.readdirSync(docs), [name], 'one note per request');
  const after = fs.readFileSync(path.join(docs, name), 'utf8');
  assert.match(after, /status: done/);
  assert.equal((after.match(/^- /gm) || []).length, 2, 'both pieces of evidence are listed');
});

test('a test or copy ledger never writes into the real vault', () => {
  assert.equal(requestDocsDir({ TERMFLEET_REQ_DIR: '/tmp/x' }), null);
  assert.equal(requestDocsDir({ TC_CONFIG_DIR: '/tmp/x' }), null);
  assert.equal(requestDocsDir({}), VAULT_REQUESTS);
  assert.match(VAULT_REQUESTS, /OBSIDIAN_SYNCED\/MAIN VULT\/TermFleet\/Requests$/);
});
