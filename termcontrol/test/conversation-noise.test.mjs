import test from 'node:test';
import assert from 'node:assert/strict';

import { clean } from '../bridge/noise.mjs';
import { messageFromRecord } from '../bridge/adapters/codex.mjs';

const briefing = 'Remote sync remains unverified.\n\n<!-- FD-DAY-V1 {"id":"day-1"} -->\n' +
  '{"latest_revision_truncated":false,"pending_updates":{"count":0}}\n' +
  'For planning, start with initial_briefing_command and inspect the relevant notes.';

test('a briefing envelope following readable text stays out of the conversation', () => {
  assert.equal(clean(briefing), 'Remote sync remains unverified.');
  assert.equal(clean('<!-- FD-DAY-V1 {"id":"day-1"} -->\n{"pending_updates":{}}'), '');
  assert.equal(clean('Show me this JSON: {"pending_updates":0}'), 'Show me this JSON: {"pending_updates":0}');
});

test('only real conversation roles become Codex chat messages', () => {
  const record = (role, content) => ({ timestamp: '2026-09-24T08:00:00Z', payload: {
    type: 'message', role, content: [{ type: 'input_text', text: content }],
  } });
  assert.equal(messageFromRecord(record('developer', briefing)), null);
  assert.equal(messageFromRecord(record('system', briefing)), null);
  assert.equal(messageFromRecord(record('tool', briefing)), null);
  assert.deepEqual(messageFromRecord(record('user', briefing)), {
    kind: 'user', at: '2026-09-24T08:00:00Z', text: 'Remote sync remains unverified.',
  });
  assert.deepEqual(messageFromRecord(record('assistant', 'I can help with that.')), {
    kind: 'assistant', at: '2026-09-24T08:00:00Z', text: 'I can help with that.',
  });
});
