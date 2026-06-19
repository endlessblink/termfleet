import { expect, test } from "@playwright/test";

test.use({
  launchOptions: { executablePath: "/usr/bin/chromium", args: ["--disable-gpu"] },
});

// Full (phone-style) emoji set behind the "more" popup: all 9 Unicode groups,
// ~1900 emojis, name-based search.
test("full emoji dataset covers all groups and searches by name", async ({ page }) => {
  await page.goto("http://127.0.0.1:5177/", { waitUntil: "domcontentloaded" });

  const out = await page.evaluate(async () => {
    const { searchEmojis, EMOJI_CATEGORIES } = await import("/src/lib/emojiData.ts");
    const chars = (q: string) => searchEmojis(q).map((e) => e.char);
    return {
      categories: EMOJI_CATEGORIES.map((c) => c.label),
      total: searchEmojis("").length,
      rocket: chars("rocket"),
      grinning: chars("grinning"),
      andMatch: chars("rocket").length, // sanity
      none: chars("zzzznotanemoji"),
    };
  });

  // All nine phone-style Unicode groups are present.
  expect(out.categories).toEqual([
    "Smileys & Emotion", "People & Body", "Animals & Nature", "Food & Drink",
    "Travel & Places", "Activities", "Objects", "Symbols", "Flags",
  ]);
  expect(out.total).toBeGreaterThan(1800);
  expect(out.rocket).toContain("🚀");
  expect(out.grinning).toContain("😀");
  expect(out.none).toEqual([]);
});
