import type { GridSnapshot } from "./gridSnapshot";

function rowText(snapshot: GridSnapshot, row: number): string {
  return snapshot.cells[row]?.map((cell) => cell.c).join("").trimEnd() ?? "";
}

function looksLikeShellPrompt(text: string): boolean {
  const trimmed = text.trim();
  return /@[^:]+:.+[$#]$/.test(trimmed);
}

export function needsLegacyPromptRepair(snapshot: GridSnapshot): boolean {
  if (snapshot.altScreen) return false;

  const prompts: Array<{ row: number; text: string }> = [];
  for (let row = 0; row < snapshot.rows; row += 1) {
    const text = rowText(snapshot, row);
    if (looksLikeShellPrompt(text)) prompts.push({ row, text: text.trim() });
  }
  if (prompts.length < 2) return false;

  const currentPrompt = prompts[prompts.length - 1];
  if (currentPrompt.row !== snapshot.cursor.line) return false;

  for (let index = prompts.length - 2; index >= 0; index -= 1) {
    const previous = prompts[index];
    if (previous.text !== currentPrompt.text) continue;
    if (currentPrompt.row - previous.row < 2) continue;

    const betweenIsBlank = Array.from(
      { length: currentPrompt.row - previous.row - 1 },
      (_, offset) => rowText(snapshot, previous.row + offset + 1).trim(),
    ).every((text) => text === "");
    if (betweenIsBlank) return true;
  }

  return false;
}
