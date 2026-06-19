// TC-017g — box-drawing and block-element rendering via raw fillRect.
//
// Line-drawing (U+2500..U+257F) and block elements (U+2580..U+259F) are drawn
// geometrically rather than blitted from the font atlas, so adjacent cells tile
// seamlessly with no sub-pixel gaps (the artifact that makes atlas-drawn borders
// look broken). Uncovered codepoints return false → caller falls back to the
// font glyph.

export function isBoxGlyph(codePoint: number): boolean {
  return codePoint >= 0x2500 && codePoint <= 0x259f;
}

interface Segments {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  heavy: boolean;
}

// Which half-segments each line codepoint lights up. Doubles are approximated by
// their single-line segment set (exact double rendering is a later refinement).
const LINE_SEGMENTS: Record<number, Segments> = {};
function line(cp: number, up: boolean, down: boolean, left: boolean, right: boolean, heavy = false) {
  LINE_SEGMENTS[cp] = { up, down, left, right, heavy };
}
// Horizontals / verticals (light + heavy + double).
line(0x2500, false, false, true, true);
line(0x2501, false, false, true, true, true);
line(0x2502, true, true, false, false);
line(0x2503, true, true, false, false, true);
line(0x2550, false, false, true, true);
line(0x2551, true, true, false, false);
// Corners (light, heavy, double, mixed) → same segment set.
for (const cp of [0x250c, 0x250d, 0x250e, 0x250f, 0x2552, 0x2553, 0x2554]) line(cp, false, true, false, true);
for (const cp of [0x2510, 0x2511, 0x2512, 0x2513, 0x2555, 0x2556, 0x2557]) line(cp, false, true, true, false);
for (const cp of [0x2514, 0x2515, 0x2516, 0x2517, 0x2558, 0x2559, 0x255a]) line(cp, true, false, false, true);
for (const cp of [0x2518, 0x2519, 0x251a, 0x251b, 0x255b, 0x255c, 0x255d]) line(cp, true, false, true, false);
// T-junctions.
for (const cp of [0x251c, 0x251d, 0x251e, 0x251f, 0x2520, 0x2521, 0x2522, 0x2523, 0x255e, 0x255f, 0x2560])
  line(cp, true, true, false, true);
for (const cp of [0x2524, 0x2525, 0x2526, 0x2527, 0x2528, 0x2529, 0x252a, 0x252b, 0x2561, 0x2562, 0x2563])
  line(cp, true, true, true, false);
for (const cp of [0x252c, 0x252d, 0x252e, 0x252f, 0x2530, 0x2531, 0x2532, 0x2533, 0x2564, 0x2565, 0x2566])
  line(cp, false, true, true, true);
for (const cp of [0x2534, 0x2535, 0x2536, 0x2537, 0x2538, 0x2539, 0x253a, 0x253b, 0x2567, 0x2568, 0x2569])
  line(cp, true, false, true, true);
// Crosses.
for (const cp of [0x253c, 0x253d, 0x253e, 0x253f, 0x2540, 0x2541, 0x2542, 0x2543, 0x2544, 0x2545, 0x2546, 0x2547, 0x2548, 0x2549, 0x254a, 0x254b, 0x256a, 0x256b, 0x256c])
  line(cp, true, true, true, true);

function drawLine(
  ctx: CanvasRenderingContext2D,
  seg: Segments,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const thin = Math.max(1, Math.round((seg.heavy ? 0.18 : 0.1) * h));
  const cx = x + Math.round((w - thin) / 2);
  const cy = y + Math.round((h - thin) / 2);
  // Horizontal segments span to the cell center (+thin to bridge the junction).
  if (seg.left) ctx.fillRect(x, cy, Math.ceil(w / 2) + thin, thin);
  if (seg.right) ctx.fillRect(cx, cy, Math.ceil(w / 2) + 1, thin);
  if (seg.up) ctx.fillRect(cx, y, thin, Math.ceil(h / 2) + thin);
  if (seg.down) ctx.fillRect(cx, cy, thin, Math.ceil(h / 2) + 1);
}

function withAlpha(ctx: CanvasRenderingContext2D, fg: string, alpha: number, fn: () => void) {
  const prev = ctx.globalAlpha;
  ctx.fillStyle = fg;
  ctx.globalAlpha = alpha;
  fn();
  ctx.globalAlpha = prev;
}

/**
 * Draw a box/block glyph at device-pixel position. Returns true if handled.
 * `fg` must already be set as fillStyle by the caller (we also set it for blocks
 * that change alpha).
 */
export function drawBoxGlyph(
  ctx: CanvasRenderingContext2D,
  codePoint: number,
  x: number,
  y: number,
  w: number,
  h: number,
  fg: string,
): boolean {
  const seg = LINE_SEGMENTS[codePoint];
  if (seg) {
    ctx.fillStyle = fg;
    drawLine(ctx, seg, x, y, w, h);
    return true;
  }

  // Block elements.
  const cw = Math.ceil(w) + 1;
  const ch = Math.ceil(h) + 1;

  // Lower partial blocks ▁▂▃▄▅▆▇█ (U+2581..U+2588): N/8 of cell height, from bottom.
  if (codePoint >= 0x2581 && codePoint <= 0x2588) {
    const eighths = codePoint - 0x2580;
    const fillH = Math.round((h * eighths) / 8);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y + Math.floor(h) - fillH, cw, fillH + 1);
    return true;
  }
  // Left partial blocks █▉▊▋▌▍▎▏ (U+2589..U+258F): N/8 of cell width, from left.
  if (codePoint >= 0x2589 && codePoint <= 0x258f) {
    const eighths = 0x2590 - codePoint;
    const fillW = Math.round((w * eighths) / 8);
    ctx.fillStyle = fg;
    ctx.fillRect(x, y, fillW + 1, ch);
    return true;
  }

  switch (codePoint) {
    case 0x2588: // █ full block
      ctx.fillStyle = fg;
      ctx.fillRect(x, y, cw, ch);
      return true;
    case 0x2580: // ▀ upper half
      ctx.fillStyle = fg;
      ctx.fillRect(x, y, cw, Math.ceil(h / 2));
      return true;
    case 0x2584: // ▄ lower half
      ctx.fillStyle = fg;
      ctx.fillRect(x, y + Math.floor(h / 2), cw, Math.ceil(h / 2) + 1);
      return true;
    case 0x258c: // ▌ left half
      ctx.fillStyle = fg;
      ctx.fillRect(x, y, Math.ceil(w / 2), ch);
      return true;
    case 0x2590: // ▐ right half
      ctx.fillStyle = fg;
      ctx.fillRect(x + Math.floor(w / 2), y, Math.ceil(w / 2) + 1, ch);
      return true;
    case 0x2594: // ▔ upper one eighth
      ctx.fillStyle = fg;
      ctx.fillRect(x, y, cw, Math.round(h / 8) + 1);
      return true;
    case 0x2595: // ▕ right one eighth
      ctx.fillStyle = fg;
      ctx.fillRect(x + Math.floor(w) - Math.round(w / 8), y, Math.round(w / 8) + 1, ch);
      return true;
    case 0x2591: // ░ light shade
      withAlpha(ctx, fg, 0.25, () => ctx.fillRect(x, y, cw, ch));
      return true;
    case 0x2592: // ▒ medium shade
      withAlpha(ctx, fg, 0.5, () => ctx.fillRect(x, y, cw, ch));
      return true;
    case 0x2593: // ▓ dark shade
      withAlpha(ctx, fg, 0.75, () => ctx.fillRect(x, y, cw, ch));
      return true;
    default:
      break;
  }

  // Quadrant blocks ▖▗▘▙▚▛▜▝▞▟ (U+2596..U+259F): combinations of the four cell
  // quarters. Heavily used by htop/btop meters, so draw them geometrically.
  const quadrants = QUADRANTS[codePoint];
  if (quadrants) {
    ctx.fillStyle = fg;
    const lw = Math.ceil(w / 2);
    const rw = Math.ceil(w / 2) + 1;
    const th = Math.ceil(h / 2);
    const bh = Math.ceil(h / 2) + 1;
    const midX = x + Math.floor(w / 2);
    const midY = y + Math.floor(h / 2);
    if (quadrants[0]) ctx.fillRect(x, y, lw, th); // upper-left
    if (quadrants[1]) ctx.fillRect(midX, y, rw, th); // upper-right
    if (quadrants[2]) ctx.fillRect(x, midY, lw, bh); // lower-left
    if (quadrants[3]) ctx.fillRect(midX, midY, rw, bh); // lower-right
    return true;
  }

  return false;
}

// [upper-left, upper-right, lower-left, lower-right]
const QUADRANTS: Record<number, [boolean, boolean, boolean, boolean]> = {
  0x2596: [false, false, true, false], // ▖
  0x2597: [false, false, false, true], // ▗
  0x2598: [true, false, false, false], // ▘
  0x2599: [true, false, true, true], // ▙
  0x259a: [true, false, false, true], // ▚
  0x259b: [true, true, true, false], // ▛
  0x259c: [true, true, false, true], // ▜
  0x259d: [false, true, false, false], // ▝
  0x259e: [false, true, true, false], // ▞
  0x259f: [false, true, true, true], // ▟
};
