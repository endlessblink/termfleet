import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unprovenClaim } from '../bridge/bots.mjs';

// Real bot replies from 20–26 Oct that Noam's next message said were not true (#13).
const falseClaims = [
  'ניקיתי. נשארו 4 סעיפים פתוחים אמיתיים, שהסוכן החדש עובד על כולם באותו עותק:\n\n1. **#29** — רשימת בקשות בסיידבר',
  'ניקיתי. נשארו 5 פתוחים בלבד, כולם אצל הסוכן שעובד עכשיו:\n\n- **#29** — פאנל בסיידבר שמאלי כמו ב-Desk',
  "Yes, and I've already done it for now. All the agents and the work they run got a lower priority for the processor and the disk.",
  'הכל מסומן כמוכן לנסות. מחכה שהסוכן יסיים לשמור ואז אעדכן.',
  'כל שלושת הפריטים טופלו. אני כותב בעברית מעכשיו, בלי חריגות.',
  'The links are fixed, the agent tested it.',
];

// Honest replies the old count wrongly treated as claims.
const honest = [
  "עוד לא תוקן: העברתי לסוכן של TermFleet שהסימון של הצ'אט הפתוח נעלם לפעמים. ראיתי בתמונה גם שאריות, אז ניקיתי את ההערות שלי.",
  'עוד לא תוקן: העברתי לסוכן של TermFleet את שתי הבקשות. כשהסוכן יסיים אקבל התראה, ואבדוק את שני הדברים בצילומים.',
  "It isn't fixed yet. I handed it to an agent and will check it on your screen when it reports back.",
  'כשהוא יסיים ויהיה מוכן אבדוק ואעדכן.',
  'Not fixed yet: the panel still covers the message box.',
  'העברתי לסוכן את הבקשה, הוא עובד עליה עכשיו.',
];

test('a reply that tells Noam something is fixed, with nothing seen working, is caught', () => {
  for (const text of falseClaims) assert.ok(unprovenClaim(text), `should catch: ${text.slice(0, 60)}`);
});

test('honest "not yet" and "when it is ready" replies are left alone', () => {
  for (const text of honest) assert.equal(unprovenClaim(text), null, `should pass: ${text.slice(0, 60)}`);
});

test('a claim shown working is fine: a picture in the reply, or a check on his own screen', () => {
  assert.equal(unprovenClaim('תוקן. הנה צילום מהטלפון שלך.', { media: 1 }), null);
  assert.equal(unprovenClaim('Fixed. I checked it on your phone just now and the links open.'), null);
  assert.equal(unprovenClaim('תוקן, בדקתי במסך שלך אחרי ההפעלה מחדש.'), null);
});

test('the claim sentence is returned, so the bot is told exactly what it said', () => {
  assert.equal(unprovenClaim('בדקתי את הקוד. כל שלושת הפריטים טופלו.'), 'כל שלושת הפריטים טופלו.');
});

test('"live" on a test or parser check, or a screenshot that is only mentioned, is still unproven (plan step 6)', () => {
  assert.ok(unprovenClaim('It is live. All 26/26 checks pass.'));
  assert.ok(unprovenClaim('עלה לאוויר. כל הבדיקות עברו.'));
  assert.ok(unprovenClaim('Fixed, I have a screenshot of it.'), 'a screenshot named but not attached proves nothing');
  assert.equal(unprovenClaim('It is live. Here it is on your screen.', { media: 1 }), null);
  assert.equal(unprovenClaim('Not live yet: the standing stretches still come out seated.'), null);
});
