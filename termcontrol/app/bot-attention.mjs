// Presentation only: questions must already have been reconciled by the caller.
// Historical chat messages and requirement statuses never imply a new question.
const text = value => typeof value === 'string' && value.trim() ? value : '';
const list = value => Array.isArray(value) ? value : [];
const pair = value => [value, value];
const status = (label, words, details) => ({
  kind: 'status', label, text: words, action: ['View details', 'הצגת פרטים'], target: null, details,
});

export function botAttention(bot, { questions = [], messages = [], full = false } = {}) {
  if (!bot || typeof bot !== 'object' || Array.isArray(bot)) return null;
  const question = list(questions).find(q => q && text(q.id) && ['bot', 'terminal'].includes(q.kind) && text(q.text));
  if (question) return {
    kind: 'question', label: ['Needs you', 'נדרש מענה'], text: pair(question.text),
    action: ['Open question', 'פתיחת השאלה'], target: { id: question.id, kind: question.kind }, details: [],
  };

  const ask = text(bot.blocked?.ask);
  if (bot.state === 'needs-you' && ask) {
    const blockedAt = Number.isFinite(bot.blocked.at) ? bot.blocked.at : null;
    const matching = list(messages).filter(m => m && m.role === 'needs-you' && text(m.id)
      && text(m.text).trim() === ask.trim()
      && (blockedAt === null || (Number.isFinite(m.at) && m.at >= blockedAt)))
      .sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    return {
      kind: 'blocked', label: ['Needs you', 'נדרש מענה'], text: pair(ask),
      action: matching ? ['Open request', 'פתיחת הבקשה'] : ['Open chat', 'פתיחת השיחה'],
      target: matching ? { id: matching.id, kind: 'blocked' } : null,
      details: matching ? [] : [full ? 'The current request is not attached to a message in this chat.' : 'Open the chat to check the current request; its message is not attached here.'],
    };
  }

  const sources = list(bot.helperDelivery?.sources).filter(value => text(value));
  const unresolved = bot.helperDelivery?.unresolved;
  if (sources.length || (typeof unresolved === 'number' && Number.isFinite(unresolved) && unresolved > 0)) return status(
    ['Update not verified', 'העדכון לא אומת'],
    ['A helper update could not be checked. No question for you is attached.', 'לא ניתן לבדוק עדכון מסוכן עזר. לא מצורפת שאלה עבורכם.'],
    sources.length ? [...sources] : ['The helper update has not been verified.'],
  );

  if (typeof bot.helpersAsking === 'number' && bot.helpersAsking > 0) return status(
    ['Question unavailable', 'השאלה אינה זמינה'],
    ['A helper may have a question, but its current question is not attached.', 'ייתכן שלסוכן עזר יש שאלה, אך השאלה הנוכחית אינה מצורפת.'],
    ['No current helper question is attached.'],
  );

  if (bot.state === 'needs-you') return status(
    ['Status needs checking', 'צריך לבדוק את המצב'],
    ['This status has no current question or request attached.', 'לא מצורפת למצב הזה שאלה או בקשה נוכחית.'],
    [full ? 'No current question, request or unverified helper update was attached.' : 'Open the chat to check its current status.'],
  );
  return null;
}
