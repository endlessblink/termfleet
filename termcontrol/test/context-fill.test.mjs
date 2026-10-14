import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeFill, codexFill } from '../bridge/context-fill.mjs';

// Checked 2026-10-12 against the agents' own readouts on 19 live panes:
// Claude "ctx:18%" ↔ 182k of a 1M window; Codex "Context 16% used" ↔ 49k of 258.4k minus its 12k baseline.
test('Claude memory fill matches its own ctx readout', () => {
  const usage = { input_tokens: 2_000, cache_read_input_tokens: 170_000, cache_creation_input_tokens: 10_000, output_tokens: 900 };
  const records = [
    { type: 'assistant', message: { model: 'claude-opus-5-5', usage } },
    { type: 'assistant', isSidechain: true, message: { model: 'claude-opus-5-5', usage: { input_tokens: 999_000 } } },
    { type: 'user', message: { content: 'next' } },
  ];
  assert.deepEqual(claudeFill(records), { used: 182_000, window: 1_000_000, percent: 18 });
  assert.equal(claudeFill([{ type: 'assistant', message: { model: 'claude-haiku-4-5', usage: { input_tokens: 100_000 } } }]).percent, 50);
  assert.equal(claudeFill([{ type: 'user' }]), null);
});

test('Codex memory fill matches its own "Context N% used"', () => {
  const records = [{ payload: { type: 'token_count', info: { model_context_window: 258_400, last_token_usage: { input_tokens: 49_100 } } } }];
  assert.equal(codexFill(records).percent, 15);
  assert.equal(codexFill([{ payload: { type: 'token_count', info: null } }]), null);
});
