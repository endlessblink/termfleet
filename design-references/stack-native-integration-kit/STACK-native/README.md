# STACK native avatar integration kit

Standalone hand-authored SVG assets and renderer for the selected original STACK direction. No user repository was modified. This kit still needs visual review in the real TermControl app and live-browser animation QA before it is called production-ready.

## First files to integrate

- `stack-avatars.js`: browser global and CommonJS renderer
- `stack-avatars.mjs`: ESM wrapper
- `stack-avatars.css`: themes, all five states, reduced motion and status animation
- `stack-avatars.d.ts`: TypeScript contract
- `index.html`: offline visual and DOM-update harness; no server required
- `svg/`: 240 self-contained canonical SVG exports, covering 12 members x 5 states x 2 themes x 2 sizes

The renderer uses native SVG paths only. There are no images, external fonts, network requests, gradients, filters or autotraced nodes. The static files contain resolved presentation attributes; the live renderer requires its CSS.

## Minimal integration

```js
import StackAvatars from './stack-avatars.mjs';
import './stack-avatars.css';

const svg = StackAvatars.create({
  id: agent.id,                     // immutable agent identity
  member: 'builder',                // immutable character choice
  state: 'working',
  projectColor: StackAvatars.projectColorForId(project.id),
  size: 48,
  label: agent.displayName,
  theme: 'inherit'
});
container.append(svg);

// Use the same SVG instance. Never rebuild it for a status tick.
StackAvatars.update(svg, {state: 'producing'});
StackAvatars.update(svg, {state: 'needs-you'});
```

In React or another framework, hold this SVG in a ref; create it when the stable agent identity/member changes, then call `update` for state/size/color changes. Key list rows by agent ID, never status or list position. Do not use a fresh `innerHTML`/`dangerouslySetInnerHTML` value on each update. Reordering an existing row should move its SVG, not recreate it.

## API

`create(options) -> SVGSVGElement`

`update(svg, patch) -> same SVGSVGElement`

`toString(options) -> escaped SVG markup` for SSR/static composition; load CSS alongside it. `update` intentionally accepts only instances returned by `create`.

Options: `id` string up to 128 characters; `member` one of the IDs below; `state`; `projectColor` hex color or null; `size` finite 12–256; `label` plain string up to 200 characters; `compact` true/false/`auto`; `decorative` boolean; `theme` `light`/`dark`/`inherit`. Omit unused options rather than passing undefined. Invalid input throws before changing the DOM. `id` and `member` cannot change through `update`; create a new avatar for a genuinely different identity.

`projectColorForId(projectId)` maps a stable project ID deterministically to the five exported `palette` hues. It does not use the member, state or array index. A null `projectColor` clears the local override and inherits `--stack-project-color` or `--project-color` from the project container. The reserved terracotta `#d97757` is rejected as a project color.

Members: builder, editor, designer, planner, researcher, communicator, writer, operator, coordinator, maker, strategist, explorer.

## State contract

- `producing`: output is currently arriving; three output bars
- `working`: the session is busy without current output; open orbit
- `needs-you`: user input or approval blocks progress; terracotta attention mark
- `idle`: live and available, with no current activity; resting dash
- `exited`: the session ended; muted character and exit cross

Map these from authoritative existing app state/events. A recent-output timer belongs in the app's event reducer, not in the avatar. Do not convert every running session to producing, or an empty stream to exited. Failure details still belong in adjacent app text/tooltips.

State updates change data attributes and accessible text without replacing anatomy/status elements. Repeated identical updates cause zero DOM writes. Animation phase is deterministic from agent identity. Producing and Working animate only the status mark; Needs you, Idle and Exited do not loop. OS `prefers-reduced-motion: reduce` always disables animation. Set an ancestor `data-stack-motion="off"` to disable it manually.

## Sizes and themes

Default 48px full-body artwork suits the roomier fleet; 52px is supported. At 36px and below, `compact:'auto'` uses an optically enlarged upper-body crop so face/shoulder identity survives. This is intentional and differs from the full-body view. `compact:false` forces full body; `compact:true` forces the upper-body view.

The tiny face is not the sole state indicator: each state has a different frozen badge. Keep adjacent status text in the app. Theme can be explicit on the SVG, inherited from `[data-theme="dark"]` or `.dark`, or controlled with CSS tokens. Light mode has deeper warm-stone fills and graphite edges to prevent cream disappearing against white.

## Verification and remaining gate

Native anatomy and all five canonical states were rendered and visually inspected at 32px and 48px on light/dark surfaces. All 240 SVG exports parse. The API/security suite passed 216 checks in an XML-backed simulated DOM, including atomic invalid updates, injection payloads, stable element identity and repeated-update no-ops. This does not prove browser animation timing.

Chromium could not launch in the cloud sandbox because socket creation was blocked. Live browser animation, computed-style behavior, framework integration, in-app status mapping and device accessibility are the local implementation's remaining QA gates. Run those in the authorized app environment. No repository, app, production state or deployment was changed by this kit.
