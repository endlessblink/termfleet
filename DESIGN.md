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
**recede**. The aesthetic is **calm, Warp-inspired**: dark, spacious, neutral,
and built from **fills, not outlines**.

Three rules drive every decision:

1. **Depth comes from background steps, never borders.** Borders are
   near-invisible hairlines used only as faint separators. There are **no
   outlines on interactive elements** — not on rows, buttons, inputs, or focus.
2. **State is communicated by fill intensity + text contrast**, never an edge.
   Selected = a lighter fill + brighter text. Non-selected = transparent + muted
   text. Hover = a subtle fill in between. (This is how Warp does it.)
3. **The accent is neutral.** No neon, no colored brand accent competing with the
   terminal. A single near-white accent token carries "live/active"; semantic
   colors (success/warn/danger/info) are reserved for status only.

History worth knowing: we tried neon lime (too loud / AI-slop tell), then warm
amber (clashed with the cool-gray surfaces), then cyan (still "not it"). The
resolution was **neutral near-white + remove the warm/cool clash entirely**, plus
killing every outline. See §4.

---

## 2. Color & surface tokens

Source: `src/styles/theme.css` → "Terminal Cockpit contract tokens".

### Surface ladder (depth via steps)
| Token | Value | Use |
|---|---|---|
| `--surface-floor` | `#15181a` | App background, top command-bar strip (darkest) |
| `--surface-base` | `#1b1f22` | Rails, sidebars, the command-bar field (recede) |
| `--surface-raised` | `#20252a` | Menus, popovers, icon tiles, count pills |
| `--surface-sunken` | `#181b1d` | Inset wells |
| `--surface-wash` | `#20252a` | Subtle gradient partner |
| `--surface-hover` | `#2a3036` | Row/control hover fill |
| `--surface-selected` | `#313841` | **Selected row fill** (no border) |

### Borders (hairlines only — never an outline)
| Token | Value | Use |
|---|---|---|
| `--border-subtle` | `rgba(255,255,255,0.05)` | Faint structural separators (panel edges) |
| `--border-strong` | `rgba(255,255,255,0.10)` | Slightly stronger separators |
| `--border-focus` | `rgba(255,255,255,0.16)` | Subtle ring on **text inputs only** |

### Text
| Token | Value | Use |
|---|---|---|
| `--text-primary` | `#e6e9ec` | Primary / selected text |
| `--text-secondary` | `#9aa3ab` | Muted / non-selected text, metadata |

### Accent
| Token | Value | Use |
|---|---|---|
| `--accent-live` | `#c4ccd2` | Neutral near-white "active/live" accent, terminal cursor. **Retint this one token to color the whole UI.** |
| `--accent-info` | `#7dbac3` | Semantic (status only) |
| `--accent-success` | `#7fc681` | Semantic — pty running |
| `--accent-warning` | `#d4a44f` | Semantic — starting/stale |
| `--accent-danger` | `#ef6f72` | Semantic — failed/destructive |

> The accent is deliberately neutral. To introduce a colored accent later, change
> only `--accent-live` — fills/text do not depend on a colored accent for legibility.

### Shadows (neutral, not accent-tinted)
- `--shadow-command`, `--shadow-menu`, `--shadow-active-pane` use black + faint
  white, never colored. `--shadow-selected-row` is **`none`** (selection is a
  fill, not an edge).

---

## 3. Radius, spacing, sizing

| Token | Value |
|---|---|
| `--radius-xs` | `6px` (chips, small controls) |
| `--radius-sm` | `9px` (rows, buttons, inputs) |
| `--radius-md` | `12px` (panels, terminal frame) |
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

| State | Background | Text | Border / outline |
|---|---|---|---|
| Rest (non-selected) | `transparent` | `--text-secondary` (muted) | **none** |
| Hover | `--surface-hover` | `--text-primary` | **none** |
| Selected / active | `--surface-selected` | `--text-primary` | **none** |

- Rows set `border: none !important` and `box-shadow: none !important` — there is
  no edge in any state.
- Selection is unmistakable from **fill + brighter text** alone.
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
