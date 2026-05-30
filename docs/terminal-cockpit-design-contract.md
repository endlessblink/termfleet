# Terminal Cockpit Design Contract

Status: frozen for TC-002 through TC-008.
Scope: terminal-workspace-tauri redesign phase.
Date: 2026-05-28.

This contract defines the visual and interaction rules for the Terminal Cockpit /
Operations Desk redesign. Future edits should make the product feel like one
integrated developer operations workbench: terminal-first, keyboard-first,
dense, calm, and visually unified.

## Product Direction

The app is an operations cockpit, not a canvas editor with terminals attached.
The terminal surface is the tactical workspace. The map, files, sessions, links,
and agents are supporting instruments that help the operator orient, switch,
inspect, and act quickly.

The visual tone is refined industrial utility: dark, precise, quiet, and
information-dense. Avoid decorative futurism, graph-paper dominance, floating
card stacks, visible scaffolding, breadcrumb chips, and text-heavy controls.

## App Anatomy

The frame has five visible regions. Every component must belong to one of them.

| Region | Purpose | Primary Content | Rules |
| --- | --- | --- | --- |
| Top command bar | Global command, context, and workspace health | Command/search field, project context, compact counts, command entry | One bar only. No secondary breadcrumb row. Search/command is the center of gravity. |
| Primary dock | Global navigation between work instruments | Sessions, files, map, links, agents, settings | Icon-first. Expanded state may show labels and rows. Collapsed state must stay useful through icons, tooltips, and active markers. |
| Tactical surface | Main terminal work area | Terminal panes, splits, focused pane chrome | Default surface. Occupies the dominant area. Terminal panes should feel embedded in the workbench, not floating on a canvas. |
| Strategic map / inspector | Optional overview and relationship layer | Canvas map, selected node details, file/session relationship view | Secondary to terminals. Grid texture must be quiet. Map controls stay compact and icon-first. |
| Status telemetry | Runtime and workspace state | PTY state, project root, sync/watch status, hot-reload/release mode | Thin bottom band. Diagnostic, not promotional. No large labels or duplicated counts. |

TC-002 must align these regions to one grid: top bar, dock, tactical surface,
optional map/inspector, and bottom telemetry. If a visible element cannot be
assigned to this anatomy, remove it or fold it into the nearest region.

## Component Hierarchy

Hierarchy from strongest to weakest:

1. Active terminal pane and command entry.
2. Primary dock active instrument.
3. Current workspace/session context.
4. Secondary panel rows and terminal metadata.
5. Telemetry, inactive counts, and passive hints.

Never let a canvas grid, decorative toolbar, mode breadcrumb, or repeated tab
strip outrank the active terminal. Text should describe operational state, not
explain the product.

## Token Map

Use one token system across shell, dock, terminal, map, inspector, and telemetry.
Existing tokens in `src/styles/theme.css` should be consolidated around these
roles before adding more component-local colors.

| Token Role | Use | Contract |
| --- | --- | --- |
| `surface.base` | App background and terminal surround | Deep neutral, not pure black. Used for the largest planes. |
| `surface.raised` | Dock, command bar, terminal chrome | One step above base. No unrelated panel tints. |
| `surface.sunken` | Terminal viewport and input wells | Darker than raised, visually stable for long sessions. |
| `surface.hover` | Row/button hover | Subtle contrast only; no glowing hover states. |
| `border.subtle` | Region dividers | Low contrast, single-pixel. Avoid double borders. |
| `border.focus` | Keyboard and active-pane focus | One consistent accent treatment. Focus must be visible without looking like an error. |
| `text.primary` | Current labels and terminal chrome | High contrast, restrained. |
| `text.secondary` | Metadata, counts, inactive labels | Muted but readable. |
| `accent.live` | Active session, cursor, running state | Warm operational accent. Use sparingly. |
| `accent.info` | Links, file relations, neutral command affordances | Secondary accent. Must not compete with active state. |
| `accent.success` | Healthy run/sync state | State only. |
| `accent.warning` | Busy, stale, or degraded state | State only. |
| `accent.danger` | Destructive/failed state | State only. |

No one-off accent families in individual components unless they are mapped back
to a token role. Do not introduce new gradients, decorative glows, glass panels,
or graph-paper-first backgrounds.

## Density And Layout Rules

- App chrome target height: top command bar 40-44px, bottom telemetry 22-26px.
- Collapsed dock target width: 44-52px. Expanded dock target width: 240-288px.
- Panel row target height: 24-30px depending on content density.
- Terminal pane chrome target height: 28-34px, with secondary actions hidden
  until hover, focus, context menu, or command palette.
- Primary work surface must keep at least 68 percent of desktop width for
  terminal work when the dock is expanded.
- Cards are allowed for repeated node-like entities only. Do not put cards
  inside cards. Page regions are bands or work surfaces, not floating cards.
- Use stable dimensions for docks, bars, terminal headers, icon buttons, and
  map controls so hover states cannot resize the layout.
- Typography must stay compact. Do not use hero-scale text inside workbench UI.
- Letter spacing is zero except short uppercase telemetry labels, where it may
  be subtle and consistent.

## Icon And Text Rules

| Surface | Default | Text Allowed When | Must Avoid |
| --- | --- | --- | --- |
| Global dock | Icon-only with tooltip and accessible label | Dock is expanded, row has enough width, or label is needed for scan speed | Text-heavy nav buttons, duplicated mode tabs |
| Top command bar | Command text field plus compact icon buttons | Project/session context is operationally useful | Breadcrumb chips, explanatory feature text |
| Panel tabs | Icons or segmented icon controls | Expanded panel needs a short section label | Long tab strips, repeated labels already shown in rows |
| Mode switches | Icon-first segmented control | Current mode label can appear once in context | Large Map/Terminal/Links buttons competing with command bar |
| Terminal pane chrome | Title plus icon actions | Title identifies the pane; action text only in menus | Always-visible Split/Rename/Close text buttons |
| Map controls | Icon toolbar | Tooltip/menu labels | Floating text buttons on the canvas |
| Status telemetry | Compact text and state icons | Values must be readable for diagnosis | Marketing-style badges or repeated counts |

Use a real icon library before hand-drawn glyphs once implementation reaches
component work. Every icon-only control needs `aria-label` and a tooltip or
native title.

## Interaction Rules

- Keyboard-first command navigation is the primary path for non-spatial actions.
- The command entry must eventually cover: open session, switch panel, new
  terminal, split pane, focus pane, rename, close, show map, search files, and
  workspace reset.
- Hover may reveal secondary controls, but keyboard users must reach the same
  actions through focus, menus, or command palette entries.
- Active, inactive, busy, warning, and failed terminal states must be visible in
  pane chrome and telemetry without adding permanent text noise.
- Collapsing a dock or panel must not lose the active selection, filters, or
  scroll position.
- The map and terminal selection states must stay synchronized once TC-005 starts.

## Reference Baseline

Baseline artifacts live under `docs/visual-baselines/`:

| File | Purpose |
| --- | --- |
| `current-split-desktop.png` | Current app in split/terminal mode before TC-002 shell edits. |
| `current-map-desktop.png` | Current app in canvas/map mode before TC-005 map edits. |
| `reference-cockpit.png` | Target reference workbench screenshot used for proportion and hierarchy comparison. |
| `comparison-notes.md` | Written notes comparing the current app, the reference, and this contract. |
| `tc-005-strategic-map.png` | Strategic map pass with linked terminal session cards. |
| `tc-006-command-menu.png` | Command-first workspace action menu pass. |

If the reference screenshot cannot be committed, `comparison-notes.md` must
describe where it came from and list the observable reference traits: dock
proportion, command bar hierarchy, central work surface dominance, panel density,
and status treatment.

## Visual Acceptance Checklist

Run this checklist before marking TC-002 through TC-008 done.

1. Anatomy: exactly one top command bar, one primary dock system, one tactical
   surface, optional map/inspector, and one bottom telemetry band are visible.
2. Hierarchy: the active terminal pane and command entry are the strongest
   signals on the screen.
3. Proportion: the central work area dominates; supporting panels feel attached
   to the same workbench, not pasted beside it.
4. Tokens: shell, dock, terminal, map, and telemetry use the same surface,
   border, focus, text, and state token roles.
5. Icon/text balance: global nav, panel tabs, mode switches, pane chrome, and
   map controls follow the icon/text rules above.
6. Density: row heights, bar heights, icon button sizes, and typography match
   the compact operations-desk density targets.
7. Terminal primacy: the app reads as a terminal cockpit on first glance, even
   when map features are available.
8. Map restraint: the canvas grid is quiet and strategic, never the dominant
   visual personality of the app.
9. Keyboard path: each visible command has a keyboard or command-entry path, or
   the next task records the missing path.
10. No seams: there are no duplicated rails, orphaned breadcrumbs, ad hoc pills,
    mismatched panel surfaces, or text buttons that belong in menus/tooltips.
11. Screenshots: desktop screenshots are captured after the change and compared
    to the baseline and reference.
12. Verification: build/test commands and screenshot paths are recorded in the
    completed task notes.

## Screenshot Review Procedure

For every TC task after TC-001:

1. Start the app with the current review command from TC-007 notes, or with
   `npm run dev` for browser-only layout review when Tauri APIs are not needed.
2. Capture desktop screenshots at 1440x900 or the nearest available desktop
   viewport for the changed surfaces.
3. Compare against `current-split-desktop.png`, `current-map-desktop.png`, and
   `reference-cockpit.png`.
4. Record visible wins, visible regressions, and remaining debt in that task's
   completion note.
5. Move any remaining visual debt into the next TC task instead of patching it
   ad hoc.

## Non-Negotiables

- Do not add another rail, breadcrumb row, or mode bar unless it replaces an
  existing one.
- Do not make the graph-paper canvas the first visual read.
- Do not use text buttons for routine pane actions that belong behind icons,
  menus, shortcuts, or command entries.
- Do not introduce a new color/accent/spacing language for one component.
- Do not mark visual work done without screenshot evidence and direct comparison
  against this contract.
