export function truncateAtWordBoundary(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…".slice(0, Math.max(0, maxLength));

  const prefix = value.slice(0, maxLength - 1).trimEnd();
  const wholeWords = prefix.includes(" ")
    ? prefix.replace(/\s+\S*$/, "").trimEnd()
    : prefix;
  return `${wholeWords || prefix}…`;
}
