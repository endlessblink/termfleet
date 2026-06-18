import type { GridSnapshot } from "./gridSnapshot";

export function snapshotPreviewRows(snapshot: GridSnapshot | undefined, maxRows = 14, maxCols = 72) {
  if (!snapshot?.cells.length) {
    return Array.from({ length: maxRows }, () => ({
      segments: [{ text: " ".repeat(maxCols), color: "rgba(148, 163, 184, 0.22)", active: false }],
    }));
  }

  const rowCount = Math.min(maxRows, snapshot.cells.length);
  return Array.from({ length: rowCount }, (_, index) => {
    const sourceRow = snapshot.cells[Math.floor(index * snapshot.cells.length / rowCount)] ?? [];
    const colCount = Math.min(maxCols, Math.max(1, snapshot.cols));
    const cells = Array.from({ length: colCount }, (_, colIndex) => {
      const sourceIndex = Math.floor(colIndex * Math.max(1, sourceRow.length) / colCount);
      const cell = sourceRow[sourceIndex];
      const active = Boolean(cell?.c?.trim());
      const char = cell?.c && cell.c !== "\u0000" ? cell.c : " ";
      const color = active
        ? cell?.fg ?? "var(--terminal-fg)"
        : "rgba(148, 163, 184, 0.16)";
      return { char, color, active };
    });
    const segments = cells.reduce<Array<{ text: string; color: string; active: boolean }>>((acc, cell) => {
      const prev = acc[acc.length - 1];
      if (prev && prev.color === cell.color && prev.active === cell.active) {
        prev.text += cell.char;
        return acc;
      }
      acc.push({ text: cell.char, color: cell.color, active: cell.active });
      return acc;
    }, []);
    return { segments };
  });
}
