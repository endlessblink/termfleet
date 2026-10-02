# DESIGN.md — termfleet design system

The canonical map of termfleet's visual language. If a value here disagrees with
the code, the code wins — but update this file. Tokens live in
`src/styles/theme.css`; global rules in `src/styles/global.css`; per-component
styles are inline `CSSProperties` objects.

The typography, **focus-ring and border rules** below are enforced in CI by
`npm run verify:typography` (`scripts/verify-typography.mjs`): it fails the build
on any `outline:` other than the tokenised focus ring, or a full `border:`
shorthand in a raw colour (token borders are allowed) in component styles.
Don't relitigate these without updating the verifier too.

> **Design update (muted near-black redesign, step 0.5).** The approved design
> reverses three older rules: (1) a visible 2px keyboard focus ring now exists
> (`--focus-ring-*`, one global rule); (2) panes, fields, dialogs, cards and menus
> use full 1px token borders (`--border-default|strong|control`); (3) `--font-mono`
> (Hack) is the approved *data tier* (paths, branches, ids, counters, kbd) and may
> be used outside the terminal. Where the sections below still say "no outlines" or
> "no monospace outside the terminal", this note wins.

---

## 1. Philosophy

termfleet is a **terminal-first cockpit**. The terminal is the star; everything
else (sidebar, command bar, explorer, map) is supporting chrome that must
**recede**. The aesthetic is **calm, muted near-black**: a `#0a0a0b` floor that is
also the terminal background (no seam), a small neutral surface ladder, and **one
muted, low-chroma accent**.

Four rules drive every decision:

1. **One accent, used in five places only:** the 2px focus ring, the 2px left edge
   of selected rows, the active rail item / active pane border / active block
   marker, links and the active prompt marker, and the single filled primary
   button in a dialog (dark label). Never for status. Never light text on accent fill.
2. **State is never fill alone.** Surface steps are only 1.04–1.29:1 apart, so
   selected = fill **+ 2px accent edge**; hover = fill only; focus = the ring;
   active pane = 1px accent border.
3. **Status = glyph + word + colour** (Running ● / Waiting for you ◆ / Idle ○ /
   Failed ▲ / Done ✓). Muted state colours, always paired with a glyph and a word.
   Amber exists only as "Waiting for you".
4. **Depth is a surface step plus a 1px token border.** Shadows are invisible on
   near-black; menus and dialogs add `--elev-*` on top of a raised surface and a
   strong border.

Accent variants live in `theme.css` as `:root[data-accent="A|B|C"]` (A slate blue,
B dusty violet, C sand/clay) and change only four tokens (`--accent`,
`--accent-hi`, `--accent-fill`, `--accent-tint`). The default is A; switch the whole
UI with `<html data-accent="B">` in `index.html` (the design handoff calls this
`ACCENT_VARIANT`). Run `tools/contrast-check.py` (or `tests/design-tokens.spec.ts`)
after touching any token.

History worth knowing: neon lime was too loud, warm amber clashed with cool grey,
cyan was "not it", and a neutral near-white accent left state unreadable. Graphite
and emerald palettes were rejected in the 2026-10 redesign.

---

## 2. Color & surface tokens

Source: `src/styles/theme.css` (the token block is the single source; the JS/canvas
mirror is `src/lib/tokens.ts`). Old names (`--text-primary`, `--accent-live`, …)
remain as legacy aliases that point at the new tokens and are deleted as usage
reaches zero.

### Surface ladder (identical for A/B/C)
| Token | Value | Use |
|---|---|---|
| `--surface-base` | `#0a0a0b` | App floor **and** terminal background |
| `--surface-chrome` | `#0d0d0e` | Header, rail, status bar |
| `--surface-sidebar` | `#101012` | Sidebars, git cards, input wells |
| `--surface-panel` | `#131315` | Pane frame, map node, task card |
| `--surface-raised` | `#1a1a1d` | Chips, fields, buttons, menus, dialogs |
| `--surface-hover` | `#202023` | Hover row / control |
| `--surface-selected` | `#28282c` | Selected row (+ 2px accent edge) |

### Borders
| Token | Value | Use |
|---|---|---|
| `--border-default` | `#2a2a2e` | Hairline, decorative only |
| `--border-strong` | `#46464b` | kbd, menus, dialogs, open card |
| `--border-control` | `#74747b` | Fields, outlined buttons (≥3:1) |

### Text
| Token | Value | Use |
|---|---|---|
| `--text-1` | `#ececee` | Primary |
| `--text-2` | `#a1a1a8` | Secondary |
| `--text-3` | `#8a8a91` | Tertiary; inside selected rows it rebinds to `--text-2` (4.28:1 < 4.5) |
| `--text-disabled` | `#5d5d63` | Never carries information |

### Accent (variant A shown; B/C swap four values)
| Token | A | Use |
|---|---|---|
| `--accent` | `#85a1c5` | Text, links, caret, active icon |
| `--accent-hi` | `#9db7d8` | Link hover / pressed |
| `--accent-fill` | `#7188a6` | Focus ring, selected edge, active indicator, filled primary button |
| `--accent-tint` | `#1e2127` | Selection wash, active scope chip |

### Agent state (always glyph + word)
`--state-running #93bda1`, `--state-waiting #dcb875` (the only amber),
`--state-idle #8a8a91`, `--state-failed #d88383`, `--state-done #81b6b8`. Pill =
14% tint fill + 45% border of the state colour, 999px radius, 11px/500.

### Elevation
Menus/popovers/palette = `--surface-raised` + 1px `--border-strong` + `--elev-menu`;
dialogs add `--elev-dialog` and `--scrim`.

---

## 3. Radius, spacing, sizing

| Token | Value |
|---|---|
| `--radius-xs` | `4px` (kbd, tags, pane-toolbar buttons) |
| `--radius-sm` | `6px` (chips, status-bar chips, 24px buttons) |
| `--radius-md` | `8px` (rows, fields, ≥28px buttons, menus, palette) |
| `--radius-lg` | `12px` (pane frame, map node, dialog, git cards) |
| `--radius-pill` | `999px` (status pills, progress bar) |
| `--commandbar-height` | `44px` |
| `--pane-chrome-height` | `42px` |

**Comfortable ("Warp") sizing** for chrome:
- Sidebar/map rows: `min-height 44–48px`, `padding 9px 10px`, `gap 11px`.
- Icon tiles (avatars, project dots): `30×30`, `radius 8`, filled `--surface-raised`.
- Section labels: `11px` uppercase, `--text-secondary`, `letter-spacing 0`.
- Command field: `32px` tall, `min(620px)` wide, centered.

---

## 4. State model (the core pattern)

Applied uniformly to **project rows, session rows, map (canvas) rows, explorer
rows**. Implemented via the shared `.workspace-sidebar-row` / `.canvas-sidebar-row`
classes in `global.css` plus per-row inline layout.

| State | Background | Text | Edge |
|---|---|---|---|
| Rest (non-selected) | `transparent` | `--text-2` | none |
| Hover | `--surface-hover` / `--surface-raised` | `--text-1` | none |
| Selected / active | `--surface-selected` | `--text-1` (tertiary rebinds to `--text-2`) | **2px `--accent-fill` left edge** |
| Keyboard focus | unchanged | unchanged | 2px focus ring, inset (`outline-offset: -2px`) |

- Rows set `border: none !important`; the selected edge is an inset
  `box-shadow` (or a 2px `::before`), never a full border.
- Selection is fill **plus** the accent edge — surface steps alone are only
  1.04–1.29:1 apart and fail 1.4.11.
- Project rows are buttons that opt into this system via
  `className="workspace-sidebar-row"` + `data-active`, so there is one source of
  truth, not per-component borders.

**Focus:** every interactive element shows a 2px `--focus-ring-color` outline
(`--focus-ring-width`, offset `--focus-ring-offset`) on `:focus-visible`, defined
once in `global.css`; list rows inset it (`outline-offset: -2px`). Hover remains a
fill; focus is a ring. The terminal's hidden `<textarea class="terminal-canvas-input">`
shows no ring — the active pane border carries focus.

---

## 5. Typography

Source: `--font-ui`, `--font-mono` in `theme.css`; faces in `global.css`.
**Enforced by `verify-typography.mjs`.**

- **UI font:** Rubik (`--font-ui`). Weights **300 / 400 / 500 only**. No 600+ in
  visible UI. No letter-spacing (stays `0`) except the one uppercase label style.
  The raw `monospace` keyword stays out of UI; `var(--font-mono)` (Hack) is the
  **data tier** for paths, branches, ids, counters and key caps.
- **Terminal font:** **Hack** (`--font-mono`) — matches Warp's default terminal
  font. Bundled as `@font-face` from TTFs in `src/styles/fonts/hack/` (regular,
  bold, italic, bold-italic) so rendering is identical regardless of system fonts.
  Monospace is **reserved for the terminal buffer only** (allowed files:
  `Terminal.tsx`, `TerminalCanvas.tsx`, `MagicCanvas.tsx`, the two CSS files).
- The verifier ignores `@font-face` blocks for the "no 600+ weight" rule — the
  Hack 700 face is the terminal bold, not a UI weight.

---

## 6. Terminal rendering

The desktop terminal is the Canvas2D renderer over the Rust headless-VT grid
(`TerminalCanvas.tsx`, `lib/gridRenderer.ts`, `lib/fontAtlas.ts`). Design-relevant
choices:

- **Background gray `#1d2022`.** Set in BOTH `--terminal-bg` (CSS) and Rust
  `DEFAULT_BG = (0x1d,0x20,0x22)` in `vt_grid.rs` (the grid's default-cell color),
  so default cells blend into the surface instead of rendering pure black. ANSI
  "black" stays true black.
- **Font:** Hack, `14px`, line-height `1.2`.
- **Synthetic medium weight:** Hack ships only 400/700, so a `0.55px` hairline
  stroke is baked into each glyph tile to thicken regular text toward medium
  (`FONT_WEIGHT_BOOST_PX` in `TerminalCanvas.tsx`). Bump it for heavier.
- **Crispness:** glyph atlas rasterized at device resolution; `imageSmoothingEnabled
  = false` on the blit context; integer device-space cell pitch
  (`Math.round(cell*dpr)`) so text never lands on fractional pixels at any DPR.
- Atlas construction is gated on `document.fonts` readiness so metrics/glyphs are
  measured against Hack, not a fallback.
- Cursor color = `--accent-live` (neutral).

---

## 7. Layout & chrome (information architecture)

- **Terminal-first:** the file explorer is a **toggle, collapsed by default**
  (`DEFAULT_UI_STATE.fileExplorerCollapsed = true`), so the resting layout is
  **icon rail → sessions sidebar → big terminal**, not four competing columns.
- **Header / command bar:** a single centered command field. No project tabs, no
  filter icons, no shortcut-pill clutter, no right-side telemetry (it duplicated
  the sidebar + status bar). The field is borderless and uses `--surface-base`
  (the sidebar tone). A left-flank **breadcrumb** (`project · path`) fills the
  otherwise-dead space and hides below 1180px.
- **Project context is always visible:** sidebar header shows the project **name +
  path**; when none is set it shows a directive **"No project open / Open a
  project"** onboarding state (empty states guide, never dead-end).
- **No "All projects" pseudo-row.** The null filter reads as **"All sessions"**.
- **Status bar:** flat `--surface-base`, borderless chips, semantic status colors
  only.

---

## 8. Components of note

- **Folder picker** (`FolderPicker.tsx`): a themed in-app modal replacing the OS
  native GTK dialog. Breadcrumb + parent/home nav, type-to-filter, show-hidden
  toggle, fill-only rows. Reuses `fs_list_dir` / `fs_home_dir`. Used by both the
  project launcher and the Explorer "change root".
- **Rows everywhere are tiles** (§4) — projects, sessions, map nodes, explorer.
- **Onboarding / empty states** are directive buttons, not "nothing here" text.

---

## 9. Accessibility

- Landmarks: header `<header>`, sidebar `<aside aria-label>`, work surface
  `<main>`, rails `<nav>`.
- Interactive rows that are `<div>`s carry `role="button"`, `tabIndex={0}`,
  Enter/Space handlers, and `aria-current` for selection.
- Icon-only controls carry `aria-label` (not just `title`).
- Keyboard focus is a visible 2px ring on every interactive element (per §4).
- `prefers-reduced-motion` is honored globally.

---

## 10. Motion

- Tokens: `--motion-fast` (120ms) and `--motion-med` (180ms), both
  `cubic-bezier(0.22, 1, 0.36, 1)`.
- Transitions are limited to `background` / `opacity` / `transform` (GPU-friendly).
  Rows transition `background` only.
- `:active` uses a 1px `translateY` press, never layout properties.

---

## 11. Don'ts (learned the hard way)

- ❌ No raw-colour borders or ad-hoc outlines: borders use `--border-*` tokens and
  keyboard focus uses the one global ring.
- ❌ No colored "brand" accent fighting the terminal (no neon, no warm-on-cool).
- ❌ No raw `monospace` keyword or 600+ weights in non-terminal UI (CI-enforced).
- ❌ No letter-spacing on UI text.
- ❌ No native OS dialogs — use the themed in-app picker.
- ❌ Don't make the explorer a permanent third column.
- ❌ Don't duplicate telemetry across header + sidebar + status bar.
