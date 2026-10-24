// Noam 2026-10-24: the bot menu showed requests as "open" after the agent had answered or finished
// every part, and showed TermFleet's own bracketed notes instead of his words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stripSystemNotes, askTitle, itemsByAsk, statusFromItems } from '../../scripts/termfleet-asks.mjs';

test('the menu shows his words, not the notes TermFleet wrapped around them', () => {
  const busy = '[While you were busy, Noam asked and your quick side responder answered in the chat. Already answered: do not repeat these answers.\n- Noam: "בטוח להפעיל את זה?"\n  Answered: "אני לא יודע עדיין [עוד לא]."]\n\nתשובות כאלו לא עוזרות';
  assert.equal(askTitle(busy), 'תשובות כאלו לא עוזרות');
  const reply = '[Noam is replying to your earlier message in this chat (message 966f2ef28500), quoted as context only, not as a new request or approval:\n"הבונה צריך לעשות commit"]\nלא רוצה הארדקודינג!!! מה נסגר?';
  assert.equal(askTitle(reply), 'לא רוצה הארדקודינג!!! מה נסגר?');
  assert.equal(askTitle('[Noam\'s answer to your question "Do you want me to route to Codex?"]\nYes, start routing to Codex'), 'Yes, start routing to Codex');
  // Only a side question is left: that question is what he asked.
  const onlySide = '[While you were busy, Noam asked and your quick side responder answered in the chat. Already answered: do not repeat these answers.\n- Noam: "באיזה מודלים הסוכנים משתמשים?"\n  Answered: "לא בטוח."]\n\n[Event, not from Noam] The terminal agent you followed has finished its turn.';
  assert.equal(stripSystemNotes(onlySide), 'באיזה מודלים הסוכנים משתמשים?');
  const tagged = '[Noam tagged you (@Agent-Manager) in his chat with the bot "bina-ve-ze". He typed this himself.]\n\nThe latest messages there, word for word:\nbina: hi\n\nNoam\'s message:\nאם זו שגיאה, שלח ל @Agent-Manager';
  assert.equal(askTitle(tagged), 'אם זו שגיאה, שלח ל @Agent-Manager');
  // His own brackets stay.
  assert.equal(askTitle('[draft] make the header taller'), '[draft] make the header taller');
});

test('a request follows its items: all answered or done reads done, a mix reads partial', () => {
  const asks = [{ n: 1, text: 'אני רואה שיש 24 משימות פתוחות. מה איתן?', status: 'open' }, { n: 2, text: 'make it blue. and taller please', status: 'open' }, { n: 3, text: 'third', status: 'done' }];
  const items = [
    { words: 'אני רואה שיש 24 משימות פתוחות.', status: 'answered', askN: null },
    { words: 'מה איתן?', status: 'answered', askN: null },
    { words: 'make it blue.', status: 'done', askN: null },
    { words: 'and taller please', status: 'assigned', askN: null },
  ];
  const by = itemsByAsk(asks, items);
  assert.equal(statusFromItems(asks[0], by.get(1)), 'done');
  assert.equal(statusFromItems(asks[1], by.get(2)), 'partial');
  assert.equal(statusFromItems(asks[1], [{ status: 'ready' }, { status: 'done' }]), 'ready');
  assert.equal(statusFromItems(asks[1], [{ status: 'dropped' }]), 'dropped');
  assert.equal(statusFromItems(asks[1], [{ status: 'assigned' }]), 'open');
  assert.equal(statusFromItems(asks[1], []), 'open', 'no items: the request keeps its own mark');
  assert.equal(statusFromItems(asks[2], [{ status: 'assigned' }]), 'done', 'his own done mark is never undone');
});
