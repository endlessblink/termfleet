// Regenerate src/lib/emojiData.ts (the full bundled Unicode emoji set) from
// unicode-emoji-json. That package is a TRANSIENT generator-only dependency — it
// is NOT a runtime dependency of the app (the generated data file is committed).
//
// Usage (from repo root):
//   npm i --no-save unicode-emoji-json && node scripts/generate-emoji-data.mjs
import groups from "unicode-emoji-json/data-by-group.json" with { type: "json" };
import { writeFileSync } from "node:fs";

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
let total = 0;
const cats = groups.map((g) => {
  const emojis = g.emojis.map((em) => {
    total++;
    const kw = `${em.name} ${em.slug.replace(/_/g, " ")}`.toLowerCase();
    return `    { char: "${esc(em.emoji)}", name: "${esc(em.name)}", keywords: "${esc(kw)}" }`;
  });
  return `  {\n    id: "${g.slug}",\n    label: "${esc(g.name)}",\n    emojis: [\n${emojis.join(",\n")},\n    ],\n  }`;
});

const header = `// AUTO-GENERATED from unicode-emoji-json (data-by-group). Do not edit by hand;
// regenerate with scripts/generate-emoji-data.mjs. Bundled full Unicode emoji set
// (${total} emojis, phone-style groups) — no runtime dependency.

export interface EmojiEntry {
  char: string;
  name: string;
  /** Space-separated lowercase search terms (name + slug words). */
  keywords: string;
}

export interface EmojiCategory {
  id: string;
  label: string;
  emojis: EmojiEntry[];
}

export const EMOJI_CATEGORIES: EmojiCategory[] = [
${cats.join(",\n")},
];

const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap((category) => category.emojis);

/** Filter by free-text query against name + keywords (AND across terms). Empty -> all. */
export function searchEmojis(query: string): EmojiEntry[] {
  const terms = query.trim().toLowerCase().split(/\\s+/).filter(Boolean);
  if (terms.length === 0) return ALL_EMOJIS;
  return ALL_EMOJIS.filter((emoji) => terms.every((term) => emoji.keywords.includes(term)));
}
`;
writeFileSync(new URL("../src/lib/emojiData.ts", import.meta.url), header);
console.log(`wrote ${total} emojis in ${cats.length} categories`);
