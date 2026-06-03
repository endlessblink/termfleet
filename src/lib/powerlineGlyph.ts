const POWERLINE_GLYPHS = new Set([0xe0b0, 0xe0b1, 0xe0b2, 0xe0b3]);

export function isPowerlineGlyph(codePoint: number): boolean {
  return POWERLINE_GLYPHS.has(codePoint);
}

export function drawPowerlineGlyph(
  ctx: CanvasRenderingContext2D,
  codePoint: number,
  x: number,
  y: number,
  cellW: number,
  cellH: number,
  color: string,
): boolean {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, Math.round(cellW * 0.12));
  ctx.beginPath();

  switch (codePoint) {
    case 0xe0b0:
      ctx.moveTo(x, y);
      ctx.lineTo(x + cellW, y + cellH / 2);
      ctx.lineTo(x, y + cellH);
      ctx.closePath();
      ctx.fill();
      return true;
    case 0xe0b2:
      ctx.moveTo(x + cellW, y);
      ctx.lineTo(x, y + cellH / 2);
      ctx.lineTo(x + cellW, y + cellH);
      ctx.closePath();
      ctx.fill();
      return true;
    case 0xe0b1:
      ctx.moveTo(x + cellW * 0.25, y);
      ctx.lineTo(x + cellW * 0.75, y + cellH / 2);
      ctx.lineTo(x + cellW * 0.25, y + cellH);
      ctx.stroke();
      return true;
    case 0xe0b3:
      ctx.moveTo(x + cellW * 0.75, y);
      ctx.lineTo(x + cellW * 0.25, y + cellH / 2);
      ctx.lineTo(x + cellW * 0.75, y + cellH);
      ctx.stroke();
      return true;
    default:
      return false;
  }
}
