// Saved terminal output still holds colour/cursor codes; strip them so an old chat reads as text.
export function plainTerminalText(raw: string) {
  return raw
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

/** What an earlier session keeps: the tail of its text, so one long chat cannot fill storage. */
export const EARLIER_SESSION_TEXT_LIMIT = 300_000;

export function clipEarlierSessionText(text: string) {
  const trimmed = text.trim();
  return trimmed.length > EARLIER_SESSION_TEXT_LIMIT
    ? `[earlier part of this session was cut]\n${trimmed.slice(-EARLIER_SESSION_TEXT_LIMIT)}`
    : trimmed;
}
