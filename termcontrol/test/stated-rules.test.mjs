import test from 'node:test';
import assert from 'node:assert/strict';
import { statedRules, withRules } from '../bridge/stated-rules.mjs';

// His real messages (bot chats, 25-26 Oct 2026).
test('his real rule statements are recognised', () => {
  assert.equal(statedRules('חוק חשוב - אם אני מדבר אתך בעברית תענה לי בעברית -').length, 1);
  assert.equal(statedRules('לא ביקשתי upwork! אנחנו לא משתמשים בupwork ואמרתי את זה כבר כמה פעמים!').length, 1);
  assert.equal(statedRules('אם אני כותב לך בעברית - תכתוב לי באנגלית מעכשיו - שזה יהיב בחוקים').length, 1);
  assert.equal(statedRules('I already told you I have no testers').length, 1);
  assert.equal(statedRules('Never open a terminal in my home folder.').length, 1);
});

test('ordinary requests and questions are not rules', () => {
  assert.deepEqual(statedRules('תתקן את הכפתור בבקשה'), []);
  assert.deepEqual(statedRules('Can you make the header taller?'), []);
  assert.deepEqual(statedRules('Should it always show the goal?'), []);
  assert.deepEqual(statedRules(''), []);
});

test('a long message gives only the sentences that carry the rule, and a repeat adds nothing', () => {
  const long = `${'Please look at the page and tell me what you see. '.repeat(8)}From now on answer in Hebrew. ${'Then continue the work. '.repeat(5)}`;
  assert.deepEqual(statedRules(long), ['From now on answer in Hebrew.']);
  const first = withRules('Be brief', ['From now on answer in Hebrew.']);
  assert.equal(first.rules, 'Be brief\nFrom now on answer in Hebrew.');
  assert.equal(withRules(first.rules, ['from now on answer in hebrew']), null);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bots } from '../bridge/bots.mjs';

test('a rule he writes in the chat is saved to that bot once, shown once, and used by its next turn', async () => {
  const bots = new Bots({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'tc-rule-')), run: async () => ({ text: 'ok' }), fill: () => null, checks: { home: os.homedir() } });
  const { bot } = bots.create({ name: 'Desk', cwd: os.tmpdir(), rules: 'Be brief' });
  const said = 'לא ביקשתי upwork! אנחנו לא משתמשים בupwork ואמרתי את זה כבר כמה פעמים!';
  bots.send(bot.id, said, { owner: true });
  assert.match(bots.read(bot.id).rules, /upwork/);
  assert.ok(bots.read(bot.id).rules.startsWith('Be brief'));
  assert.equal(bots.messages(bot.id).filter((m) => /^Saved as a rule/.test(m.text || '')).length, 1);
  bots.send(bot.id, said, { owner: true });
  assert.equal(bots.messages(bot.id).filter((m) => /^Saved as a rule/.test(m.text || '')).length, 1, 'a repeat is not saved twice');
  bots.send(bot.id, 'תתקן את הכפתור בבקשה', { owner: true });
  assert.equal(bots.read(bot.id).rules.split('\n').length, 2, 'an ordinary request adds nothing');
  await bots.drain?.(bot.id);
});
