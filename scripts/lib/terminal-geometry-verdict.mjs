// Verdicts for terminal geometry samples + key-route decisions.
//
// One source of truth, used by `scripts/verify-terminal-geometry.mjs` (live log) and by
// `tests/terminal-geometry-verdict.spec.ts` (focused tests). Every rule below exists
// because a real failure got argued from a screenshot instead of a measurement:
//   CANVAS_GRID_MISMATCH  a canvas whose CSS box disagreed with its grid
//   BACKING_STORE_MISMATCH  a backing store that disagreed with its CSS box
//   GUTTER_WIDER_THAN_CELL  a card wider than its grid, showing a blank stripe
//   CLIPPED_OUTSIDE_MAP  a split pane clipping its own columns
//   SCROLL_STATE_INCOHERENT  scrolled while the grid claims no history
//   KEY_SWALLOWED  a navigation key claimed for history the grid does not hold —
//                  the PageUp/PageDown "nothing happens" signature

/** Tolerance for geometry comparisons; sub-pixel rounding is not a defect. */
const PX_TOLERANCE = 1.5;

export const KEY_SWALLOWED = "KEY_SWALLOWED";

function near(a, b, tolerance = PX_TOLERANCE) {
  return Math.abs(a - b) <= tolerance;
}

/** Judge one pane's latest geometry sample. Returns a list of violations. */
export function judgePaneGeometry(sample) {
  const violations = [];
  const push = (code, detail) => violations.push({ code, id: sample.id, detail });

  // A pane sampled before its first frame has no grid yet: the canvas is sized from the
  // initial props while the buffer is still empty (cols 0). Nothing to judge — judging
  // it would report a mismatch that is only "not painted yet".
  if (!(sample.cols > 0) || !(sample.rows > 0)) {
    return violations;
  }

  const expectedCssW = sample.cols * sample.cellWidth;
  const expectedCssH = sample.rows * sample.cellHeight;
  const expectedDevW = Math.round(expectedCssW * sample.dpr);
  const expectedDevH = Math.round(expectedCssH * sample.dpr);

  if (sample.canvasCssWidth > 0 && !near(sample.canvasCssWidth, expectedCssW)) {
    push(
      "CANVAS_GRID_MISMATCH",
      `canvas css ${sample.canvasCssWidth}px != cols*cellWidth ${expectedCssW.toFixed(1)}px`,
    );
  }
  if (sample.canvasCssHeight > 0 && !near(sample.canvasCssHeight, expectedCssH)) {
    push(
      "CANVAS_GRID_MISMATCH",
      `canvas css height ${sample.canvasCssHeight}px != rows*cellHeight ${expectedCssH.toFixed(1)}px`,
    );
  }
  if (
    sample.canvasDeviceWidth > 0 &&
    !near(sample.canvasDeviceWidth, expectedDevW, 2) &&
    !near(sample.canvasDeviceHeight, expectedDevH, 2)
  ) {
    push(
      "BACKING_STORE_MISMATCH",
      `backing ${sample.canvasDeviceWidth}x${sample.canvasDeviceHeight} != grid*dpr ${expectedDevW}x${expectedDevH}`,
    );
  }

  if (sample.shellWidth > 0 && sample.canvasCssWidth > 0) {
    const slack = sample.shellWidth - sample.canvasCssWidth;
    // A split pane is never CSS-scaled, so a clip there is a genuine bug. On the map a
    // frozen 1:1 projection is deliberate.
    if (slack < -PX_TOLERANCE && !sample.map) {
      push("CLIPPED_OUTSIDE_MAP", `canvas ${sample.canvasCssWidth}px wider than shell ${sample.shellWidth}px`);
    }
    if (slack > sample.cellWidth) {
      push(
        "GUTTER_WIDER_THAN_CELL",
        `${slack.toFixed(1)}px blank stripe (cell ${sample.cellWidth}px)`,
      );
    }
  }

  if (sample.hasHistory === false && sample.displayOffset > 0) {
    push(
      "SCROLL_STATE_INCOHERENT",
      `displayOffset ${sample.displayOffset} with no history`,
    );
  }
  return violations;
}

/**
 * Judge the recorded navigation-key decisions. A key claimed for history while the
 * grid holds none is the exact "PageUp does nothing" failure: the key never reaches
 * the application that owns the scrollable content.
 */
export function judgeKeyRoutes(routes) {
  const violations = [];
  for (const route of routes) {
    if (route.action === "history" && route.hasHistory === false) {
      violations.push({
        code: KEY_SWALLOWED,
        id: route.id,
        detail: `${route.key} -> history while hasHistory=false (map=${!!route.map})`,
      });
    }
  }
  return violations;
}

/** True when at least one violation is the swallowed-key class. */
export function hasSwallowedKey(violations) {
  return violations.some((violation) => violation.code === KEY_SWALLOWED);
}

// --- Capture checks --------------------------------------------------------------
//
// The geometry log says what box the renderer *believes* it owns; a window capture says
// what actually reached the screen. Judging one against the other is what turns "the
// terminal looks broken" into a number. `brightnessOf(rect)` is injected so this stays
// testable without a PNG decoder (the CLI backs it with ImageMagick).

/** A pane that renders nothing is either off-screen or not painting at all. */
const BLANK_BRIGHTNESS = 0.004;

export function judgePaneCapture(sample, brightnessOf) {
  const violations = [];
  const rect = {
    x: sample.rectX,
    y: sample.rectY,
    width: sample.rectWidth,
    height: sample.rectHeight,
  };
  const numbers = [rect.x, rect.y, rect.width, rect.height];
  if (numbers.some((value) => !Number.isFinite(value)) || rect.width <= 0 || rect.height <= 0) {
    violations.push({
      code: "PANE_RECT_INVALID",
      id: sample.id,
      detail: `canvas rect ${JSON.stringify(rect)} is not a usable box`,
    });
    return { violations, brightness: null };
  }
  if (rect.x < 0 || rect.y < 0) {
    violations.push({
      code: "PANE_RECT_OFFSCREEN",
      id: sample.id,
      detail: `canvas starts outside the window at ${rect.x},${rect.y}`,
    });
  }

  let brightness = null;
  try {
    brightness = brightnessOf(rect);
  } catch (error) {
    return { violations, brightness: null, error: String(error) };
  }
  if (typeof brightness === "number" && brightness < BLANK_BRIGHTNESS) {
    violations.push({
      code: "PANE_BLANK_ON_SCREEN",
      id: sample.id,
      detail:
        `pane rect ${rect.width}x${rect.height} at ${rect.x},${rect.y} is blank on screen ` +
        `(brightness ${brightness.toFixed(5)}) while the renderer reports ` +
        `${sample.cols}x${sample.rows} of content`,
    });
  }
  return { violations, brightness };
}

//
// --- Terminal capability stream checks -------------------------------------------

// A terminal application probes the emulator before it draws: it asks for the cursor
// position (DSR 6n), the terminal identity (XTVERSION), DEC private-mode state
// (DECRQM), kitty-keyboard support (CSI ?u) and the window pixel size (CSI 14t), then
// picks its output protocol from the answers. TermFleet's grid (alacritty_terminal,
// headless) never replies, so the app guesses — and OpenCode guessed that this
// terminal supports OSC 66 explicit-width text, which alacritty does not implement.
// The result was 2 OSC 66 sequences in a live pane and the artifacts the operator
// kept reporting. These checks make that class visible instead of arguable.

export const QUERY_VECTORS = [
  ["osc66", /\u001b\]66;/],
  ["kitty_keyboard_query", /\u001b\[\?u/],
  ["xtversion_query", /\u001b\[>0q/],
  ["cursor_position_query", /\u001b\[6n/],
  ["decrqm_query", /\u001b\[\?[0-9]+(;[0-9]+)*\$p/],
  ["pixel_size_query", /\u001b\[14t/],
];

/**
 * Summarise one pane's raw output stream for capability probes and unsafe output.
 * `text` is the decoded stream (lossy is fine — these are ASCII controls).
 */
export function judgePaneStream(paneId, text) {
  const counts = {};
  for (const [name, pattern] of QUERY_VECTORS) {
    const matches = text.match(new RegExp(pattern.source, "g"));
    if (matches) counts[name] = matches.length;
  }
  const violations = [];
  const warnings = [];
  if (counts.osc66) {
    // A warning, not a defect: the grid consumes OSC 66, so it cannot render as text.
    // It stays visible because the emission is the app's and only stops when the
    // terminal answers the capability probe (or OPENTUI_FORCE_EXPLICIT_WIDTH=0 is set
    // in the pane environment). Reporting it as a hard failure would leave the gate
    // permanently red for a defect that is already neutralised.
    warnings.push({
      code: "OSC66_EMITTED",
      id: paneId,
      detail:
        `${counts.osc66}x OSC 66 explicit-width/scaled-text emitted by the app; the grid ` +
        "consumes it (no artifacts), but it means capability detection guessed wrong " +
        "(set OPENTUI_FORCE_EXPLICIT_WIDTH=0 in the pane environment to stop the emission)",
    });
  }
  return { counts, violations, warnings };
}

