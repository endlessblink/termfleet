# Embedding a canvas editor on a pan/zoom surface — research queries

Context for anyone picking this up: TermFleet puts an Excalidraw board on the
operations map as a normal map node. The map pans and zooms its contents with a
single CSS `transform: translate(...) scale(...)` on a wrapper, so every node —
terminals included — is inside a scaled, translated ancestor.

Two failure modes come out of that, and only the first is obvious:

1. **Scale.** A drawing tool reads the pointer straight off the screen, so a
   CSS-scaled ancestor makes the pen miss the cursor. Solved here by laying the
   live board out at `size * mapZoom` and counter-scaling by `1 / mapZoom`, so
   one CSS pixel inside the editor equals one screen pixel at any map zoom, and
   handing the map's zoom to the editor's own zoom instead.
2. **Translation.** Excalidraw caches the container's screen offsets and only
   recomputes them when its own box _resizes_. Panning the map, dragging the
   card, collapsing a sidebar or moving the window all move the board without
   resizing it, so every click stays wrong by however far it moved. Solved here
   by calling `excalidrawAPI.refresh()` — on map viewport changes, on window
   resize, on pointer entry, and from a 200 ms watcher on the board's own
   `getBoundingClientRect()` position.

The position watcher is the part worth challenging: it is a poll, and a poll is
a smell. The queries below are aimed at replacing it with something event-driven
or at confirming that no such mechanism exists.

## Queries

1. How do I keep an embedded Excalidraw component's pointer coordinates correct
   when its container is moved (not resized) by an ancestor CSS transform — is
   there an event-driven alternative to polling `excalidrawAPI.refresh()`?

2. Is there a browser API that fires when an element's position on screen
   changes without a resize — IntersectionObserver tricks, `ResizeObserver` on a
   sentinel, or the proposed position-observer — and which of these work in
   WebKitGTK / WKWebView as used by Tauri?

3. What is the correct way to embed Excalidraw or tldraw inside an infinite
   canvas that already applies its own `transform: scale()` — counter-scale the
   container and drive the editor's internal zoom, or use the editor's own
   camera API for both?

4. tldraw SDK: does the editor recompute its screen bounds automatically when
   its container moves without resizing, and what is the equivalent of
   Excalidraw's `refresh()` — `editor.updateViewportScreenBounds()`?

5. Are there known problems with `getBoundingClientRect()`, `ResizeObserver`
   `contentRect`, and pointer event coordinates inside CSS-transformed
   containers specifically in WebKitGTK, compared with Chromium?

6. What patterns do Figma-style / infinite-canvas web apps use to host a nested
   interactive canvas widget (a whiteboard inside a node) so pointer hit testing
   stays correct across the outer canvas's pan and zoom?

7. Performance of running an Excalidraw instance per node on a canvas with many
   nodes: what is the recommended level-of-detail approach — unmount and show a
   raster snapshot below a zoom threshold, or keep the editor mounted in view
   mode?

8. Excalidraw programmatic scene authoring: what is the minimum valid element
   JSON for rectangles, arrows, and bound text, and is `mermaid-to-excalidraw`
   the supported path for generating diagrams from text?

## What to do with the answers

If any of 1, 2, or 4 turns up a real event for "this element moved", drop the
200 ms watcher and keep only that plus the existing viewport effect. The
regression tests in `tests/map-drawing-board.spec.ts` fail without a working
refresh path (verified by disabling it), so they will tell you immediately
whether a replacement actually holds.
