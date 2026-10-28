// A bounded presentation repair, not a rewriting/model pass. Only whitespace
// between ordinary words may change; punctuation, claims and word order cannot.
const MAX_PROSE_LINE = 200;
const atoms = /`+[^`]*`+|!?\[[^\]]*\]\([^\n]*?\)|<[^>\n]+>|https?:\/\/\S+|\S+/gu;

function boundaryRank(token) {
  // Inspect only complete ordinary tokens. Dots inside a URL, inline code,
  // decimal, filename or abbreviation cannot become a paragraph boundary.
  if (/^(?:`|!?\[|<|https?:\/\/)/u.test(token)) return 0;
  if (/(?:\b(?:Mr|Mrs|Dr|Prof|vs|etc|e\.g|i\.e)|\b[A-Z])\.$/u.test(token)) return 0;
  if (/[.!?][\])}"'’”]*$/u.test(token)) return 3;
  if (/[;:][\])}"'’”]*$/u.test(token)) return 2;
  return /,[\])}"'’”]*$/u.test(token) ? 1 : 0;
}

function proseLines(text, visit) {
  let fence = null;
  return text.split('\n').map(line => {
    const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      return line;
    }
    if (mark) { fence = mark; return line; }
    // Keep code, headings and table syntax byte-for-byte. Their length is not
    // evidence of a prose wall. Ordinary list items still receive the guard.
    if (/^(?: {4}|\t)|^\s{0,3}#{1,6}\s|^\s*\|/.test(line)) return line;
    return visit(line);
  }).join('\n');
}

export function replyStructureProblem(text) {
  let problem = null;
  proseLines(String(text || ''), line => {
    if (line.trim().length > MAX_PROSE_LINE) problem = 'a prose line is too long; separate it into readable paragraphs';
    return line;
  });
  return problem;
}

function reflowLine(line) {
  if (line.trim().length <= MAX_PROSE_LINE) return line;
  const tokens = [...line.matchAll(atoms)];
  if (tokens.length < 2) return line; // Never break a URL, code span or long word.
  const list = /^(\s*)(?:[-*+•▪◦]|\d+[.)])\s+/.exec(line);
  const continuation = list ? ' '.repeat(list[0].length) : '';
  const separator = `\n\n${continuation}`;
  const limit = MAX_PROSE_LINE - continuation.length;
  const parts = [];
  let start = 0, first = 0;
  while (line.length - start > limit && first < tokens.length - 1) {
    let choice = -1, rank = -1;
    for (let i = first; i < tokens.length - 1; i++) {
      const end = tokens[i].index + tokens[i][0].length;
      if (end - start > limit && i > first) break;
      if (!/^\s+$/.test(line.slice(end, tokens[i + 1].index))) continue;
      // Prefer a complete sentence, then an existing clause, then a word gap.
      // No punctuation is inserted and no semantic regrouping is invented.
      const nextRank = end - start >= 60 ? boundaryRank(tokens[i][0]) : 0;
      if (nextRank >= rank) { choice = i; rank = nextRank; }
    }
    if (choice < 0) break;
    const end = tokens[choice].index + tokens[choice][0].length;
    parts.push(line.slice(start, end));
    first = choice + 1;
    start = tokens[first].index;
  }
  parts.push(line.slice(start));
  return parts.join(separator);
}

export function readableReply(text) {
  const original = String(text || '');
  const before = replyStructureProblem(original);
  if (!before) return { text: original };
  const repaired = proseLines(original, reflowLine);
  const remaining = replyStructureProblem(repaired);
  return { text: repaired, structure: { repaired: repaired !== original, ...(remaining ? { remaining } : {}) } };
}
