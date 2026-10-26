const URL_RE = /https?:\/\/[^\s<>"'\]\)]+/g;
export function testingInstructions(text) {
  const line = String(text || '').split('\n').find((s) => /^\s*(?:Try|What to try|נסו|נסה|לבדיקה)\s*:/i.test(s));
  if (!line) return null;
  const link = (line.match(URL_RE) || [])[0]?.replace(/[.,;!]+$/, '') || null;
  const tryText = line.replace(/^\s*(?:Try|What to try|נסו|נסה|לבדיקה)\s*:\s*/i, '').replace(URL_RE, '').replace(/[[\]()*_]/g, '').trim();
  return { link, tryText };
}
