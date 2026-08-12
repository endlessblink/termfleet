---
target: src/components/WorkbenchSidebar.tsx
mode: Operate
scores: [object Object]
total: 24
issues: Repeated session identity,Ambiguous panel-color rails,Permanent metadata overload,Equal-weight mode strip,Color-dependent selection
strengths: Project grouping,Operational state language,Calm dark surfaces
personas: Alex power user,Jordan first timer,Sam accessibility
detector: [object Object]
timestamp: 2026-08-11T09-11-04Z
slug: src-components-workbenchsidebar-tsx
---
# Sidebar and map navigation critique

## Assessment A — design review

### Target and mode

The target is the Map/sidebar session list shown in the attached screenshot. The intended mode is Operate: quickly identify the right live session, understand its state, and move into it.

### Overall impression

The surface communicates a capable terminal cockpit, but the list currently behaves like a stack of miniature colored cards. Repeated `termfleet` titles, three lines of metadata, variable row heights, and red/blue rails make the sidebar feel busy and slightly urgent before the user knows why.

### Heuristic scores

| Heuristic | Score | Evidence |
| --- | ---: | --- |
| Visibility of system status | 3/4 | Running/idle labels, dots, counts, and current activity are visible, but the accent rail has no unambiguous meaning. |
| Match with the real world | 3/4 | Projects, terminals, agents, and activity map to the product; provider/path abbreviations are insider language. |
| User control and freedom | 3/4 | Rows are selectable and the selected row exposes a close action; most row actions are implicit. |
| Consistency and standards | 2/4 | The row pattern repeats, but status colors, panel colors, selected fills, and different row heights compete. |
| Error prevention | 2/4 | Red can be read as failure even when it is only a panel color; repeated identities increase mis-selection risk. |
| Recognition over recall | 2/4 | The user must read the activity, provider, and truncated path to distinguish otherwise identical sessions. |
| Flexibility and efficiency | 3/4 | Dense grouping helps power users, but no obvious search/filter or compact targeting aid is visible. |
| Aesthetic and minimalist design | 2/4 | The dark palette is coherent, but card-like rails and repeated metadata create visual noise. |
| Error recovery | 2/4 | Verification/checking copy is visible, but the row does not expose what recovery action is available. |
| Help and documentation | 2/4 | Counts and labels are present, but Map, Tidy, provider abbreviations, and color meaning are unexplained. |

**Total: 24/40 — usable, with significant scanability and semantics improvements needed.**

### Cognitive load

- Single focus: **FAIL** — identity, health, provider, path, and current work all compete in every row.
- Chunking: **PASS** — project headings create useful groups.
- Grouping: **PASS** — the project sections are easy to locate.
- Visual hierarchy: **FAIL** — rails and dots attract attention before the task title.
- One thing at a time: **FAIL** — the list asks the user to solve identity and status at once.
- Minimal choices: **PASS** — row actions are limited, though the top mode strip is broad.
- Working memory: **FAIL** — five nearly identical `termfleet` labels force comparison by memory.
- Progressive disclosure: **FAIL** — path and provider details are always present instead of being secondary.

The resulting load is high for a navigation list: the user can operate it, but must visually parse too much before clicking.

### Strengths to preserve

1. Project grouping and aggregate counts give the list a useful operational shape.
2. The product-specific language—terminal, agent, running, idle, and current activity—makes the cockpit feel purposeful.
3. The dark surface steps and rounded geometry are calm enough to support long sessions.

### Priority issues and directions

#### P1 — Session identity collapses into repeated labels

Every visible row starts with `termfleet`, so the most prominent text is the least useful discriminator.

Direction: make the first line the durable work concept or current agent mission; keep the project/workspace as the secondary label. Example rhythm: `Verifying rendered panes` on line one, `termfleet · GPT` on line two, and one compact state line beneath only when needed. Preserve the full path in a tooltip or details view.

#### P1 — Color rails are semantically ambiguous and visually loud

Blue and red rails read like health or error indicators even when they represent transferable panel color. The selected fill then adds a second competing emphasis.

Direction: reserve red/green/amber for system status; represent panel identity with a muted 2px tint or a barely-there surface wash. Let selection use one neutral raised fill and a single consistent focus treatment. Never make a panel color look like an alert.

#### P1 — Rows contain too much permanent metadata

Status, provider, path, and activity are all visible in a small width, producing truncation and a three-line card rhythm.

Direction: enforce a stable two-line row: line one = unique work title; line two = status plus one useful qualifier. Move provider, repository path, and diagnostics to hover, keyboard focus, or the detail header. Keep row heights uniform so the eye can scan vertically.

#### P2 — The mode strip gives too many equal-weight destinations

Map, Board, Note, Terminal, File, and Tidy appear as one command row. That makes the primary map context less clear.

Direction: make Map the active view heading, keep Terminal as the primary action, and put Board/Note/File/Tidy behind a grouped “More” or command menu. The screenshot should tell a new user where they are before they decode the controls.

#### P2 — Selection and accessibility depend too heavily on color

Tiny dots and rails carry state, while the selected row is only slightly different from neighboring rows.

Direction: pair each state with text and an icon shape; add a strong non-color selected/focus treatment that still fits the no-outline visual language. Ensure keyboard focus is visible and the close action has a clear accessible name.

#### P2 — Operational copy mixes state with activity

`Idle` beside `Checking terminal` or `Tracing the map terminal connection flow` makes it unclear whether the session is waiting, working, or reporting a task.

Direction: use one canonical state vocabulary—`Running`, `Waiting for input`, `Verifying`, `Failed`—and put the current activity after it as a subordinate phrase. Use consistent capitalization and avoid showing both a broad state and a near-duplicate activity label.

### Persona red flags

- **Alex, power user:** repeated names slow targeting; a visible search, filter, or keyboard jump would reduce scan time.
- **Jordan, first-time user:** `GPT`, `devops/ter...`, and `Tidy` are not self-explanatory; color meaning is absent.
- **Sam, accessibility-focused user:** tiny status dots and color rails are weak non-color signals, and a visible focus state is not apparent in the screenshot.

### Provocative questions

- Why is the first line the workspace name instead of the work the user came here to watch?
- Is a colored rail a panel identity, a health signal, or a selection state? If it means more than one, what can be removed?
- What must be visible before clicking, and what should be revealed only on hover or focus?
- Could this be a task queue with one strong title and one state line instead of a stack of miniature terminal cards?

## Assessment B — detector and evidence

The attached screenshot was reviewed as the primary visual evidence. Live browser inspection was unavailable in this session, so spacing and behavior claims are limited to the rendered screenshot and incumbent design context.

The design detector found one warning in the target source: a layout-property transition (`padding-right`) at line 826. This is not the main visual problem in the screenshot, but it should be changed to a transform/opacity-based interaction or removed if the transition is not essential, because width/padding animation can cause jank.

No critique ignore file was present.

## Recommended implementation order

1. Rewrite the row information hierarchy and make each session title unique.
2. Reduce panel-color treatment to a subdued identity tint; reserve saturated colors for status.
3. Collapse rows to a consistent two-line rhythm and move path/provider details behind disclosure.
4. Clarify Map as the current view and group secondary commands.
5. Add non-color state/focus signals, then verify at narrow and zoomed layouts.
