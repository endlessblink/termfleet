import { expect, test } from "@playwright/test";
import { truncateAtWordBoundary } from "../src/lib/textTruncation";

test("long cockpit text ends on a complete word with one ellipsis glyph", () => {
  expect(
    truncateAtWordBoundary(
      "load all the tasks and context from the previous session before continuing",
      34,
    ),
  ).toBe("load all the tasks and context…");
});

test("short cockpit text is unchanged", () => {
  expect(truncateAtWordBoundary("Applying approved course covers", 40)).toBe(
    "Applying approved course covers",
  );
});

test("a single long token is clipped safely without three-dot noise", () => {
  expect(truncateAtWordBoundary("supercalifragilisticexpialidocious", 12)).toBe(
    "supercalifr…",
  );
});
