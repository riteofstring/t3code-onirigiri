# Onirigiri for T3 Code: design constraints

`apps/spatial` runs T3's own router and app shell and replaces only the chat area with an Onirigiri
workspace of thread panes and the tool panes users add beside them. `packages/onirigiri-t3` holds the
T3-independent row reconciliation; its README states those rules. This page records constraints
that span files and are easy to break without noticing.

## Build

- `apps/spatial/vite.config.ts` inherits the web app's whole toolchain (React Compiler, Tailwind,
  defines, dev proxy) so T3 components compile exactly as upstream, and replaces only the router
  plugin with one pointed at the web app's routes, because the app runs T3's route tree.
- `scopeAncestorSelectors.ts` rewrites Tailwind ancestor variants (`group-has-*`,
  `group-focus-visible:*`, `has-*:**`), which compile to `X:is(A *)`. When `A` contains `:has()` or
  `:focus-visible`, Chromium cannot scope invalidation of the nested selector, so DOM changes or
  workspace focus restyle unrelated panes. `A X` has the same matches and specificity and is scoped
  to the subtrees of `A`. Only an `:is()` holding one complex selector that ends in `*` after a
  combinator, in the first compound of a selector, is rewritten: after a combinator, as in
  `.p > X:is(A *)`, `A` would land between the combinator and `X` and change the matches.

## Routes and covering

- The workspace stays mounted for every chat route. A draft, a thread its draft view still carries,
  and the pull-requests page cover it (`active` is false); the index shows the workspace, whose focus
  then sets the route, and T3's landing shows only when there are no threads.
- A promoted draft stays in T3's draft view until its turn has settled and the draft record is gone
  (`useCarriedThread`), so its first response streams without remounting the ChatView.
- The app route follows the focused pane once the camera has rested (`ROUTE_SETTLE_MS`), so T3's
  global surfaces act on that thread; a tool pane routes to its thread. Any input other than
  workspace navigation follows at once, because the palette or a click may act on the thread.
- Routes the workspace requested are remembered so they are not mistaken for navigation elsewhere.
  Any other route (sidebar, notification, new thread) focuses its pane and leaves overview, or waits
  until reconciliation adds the pane; `onBeforeNavigate` starts that camera move before the route
  loads. A route change made elsewhere, or covering the workspace, cancels a pending follow.
- A covered or unmounted workspace hands the sidebar highlight back to the route. Focus that moved
  while covered reaches the pane lifecycle when the workspace shows again.
- Covered workspaces start no background picture preparation or drawing: both lay out offscreen
  content, and a covered workspace has no measurable viewport.

## Panes

- Pane membership changes rebuild the engine layout around the focused pane; renames and an empty
  pane's choice update panes in place, and surface ids follow pane ids, so live views and pictures
  survive. Live sidebar data is compared by content (`liveKey`) because its inputs are rebuilt on
  unrelated renders. `isLocalEnvironmentDisabled` is read once: changing it restarts the desktop app.
- Focus lives in refs, not React state, so moving between panes does not re-render the workspace.
  Callbacks given to `renderPane` resolve pane ownership when they run, so live thread updates do not
  change pane renderers.
- Closing a tool pane goes through the tool pane controller: `onPaneClose` removes it and returns
  `false`, the rebuilt arrangement drops it, and focus returns to its thread.
- Automatic surface additions (`openProactive`) never move focus, so a pull request the user is
  reading keeps it.
- Each layout mode keeps its own saved layout and switching remounts the workspace. A stored mode wins
  over `?layout=`. Persisted state uses the `onirigiri-t3:*` local storage keys and the
  `onirigiri-t3-pane-pictures` database; renaming either drops users' saved state.

## Thread panes and focus

- Each thread pane owns a memory-history router so every route read inside its ChatView resolves to
  that thread; navigation away is handed to the app router. Retained panes suppress panel
  animations, since the app route following focus is not a navigation for them.
- Only the focused, interactive pane's ChatView is active, and switching activity does not re-render
  it. A pane that stops being active blurs its focused element, including a browser guest it owns,
  so keystrokes reach the active pane. Shared composer commands see the active pane's real handle or
  null, including after the composer is replaced.
- Background panes fetch their projection before creating their router shell, and only the focused
  pane mounts content during camera motion. A pane is prepared once its thread is synchronized, its
  ChatView and history report ready, and two frames have passed. After it has been presented, later
  readiness work postpones its next picture without covering the live editor again.

## Keyboard

- The engine keeps only navigation and rearrangement shortcuts; new panes use T3's chooser (Alt+N).
- Chords that must work inside text fields are marked `whileEditing`: Option+O (and Ctrl+Option+O)
  toggles overview from anywhere. Focus moves add Shift+Option+arrows because
  Option+arrows edit text in the composer and terminals; terminal tool panes still reserve plain
  Option+arrows for navigation, before the terminal consumes them.
- Escape in the composer blurs it so arrow navigation works again, unless its suggestion list is open.
- Engine desktop controls are portaled into the toolbar, so the toolbar listens with native listeners
  on their physical parent; hover, Escape and tabbing out then match the neighbouring T3 buttons.
- Browser guests forward shortcut keys only while the workspace is active, their pane is the focused
  one and no modal is open. The pane element takes focus first, because the engine moves focused-pane
  chrome after navigation. Focusing a guest dispatches a pointerdown on its slot, the same
  focus-without-camera-movement path native pane content uses.

## Pane lifecycle

`paneLifecycle.ts` decides which thread panes mount a live ChatView; mounting is the expensive step.

- About eight views stay warm. Visible views are never evicted, and views the user has seen stay
  mounted while their turn runs or while they host a live producer.
- The focused pane mounts first once focus and visibility have been quiet briefly. A saved picture
  covers camera motion and the view mounts after the final frame; a destination without one mounts
  during motion. Visible peers then mount one at a time, each after the previous one commits.
- Neighbours, the next one in the direction of travel first, and unviewed running threads use spare
  slots only while the page is idle and input has been quiet. Navigation cancels speculative work
  that has not started.
- Leaving overview releases excess views one commit at a time during idle input, instead of
  unmounting them all on the last frame.
- Panes without a picture share one extra mount slot to be pictured: untried panes first, visited
  ones before untouched ones, then the oldest attempt. A reservation interrupted by input, motion or
  covering keeps its place without counting as a failure; a real failure waits minutes before a
  retry; a deliberate revisit takes the pane over.
- Mount changes reach panes as transitions (`usePaneMounted`), so mounting a ChatView does not block
  input.
- The lifecycle and the snapshot queue track input separately: the queue only timestamps it, while
  the lifecycle also interrupts a picture reservation.

## Pictures

Unmounted thread panes show a picture of their last synchronized content, or a `ThreadCard` built from
the thread shell, which is never stale.

- A picture matches only the same thread update, theme (palette, appearance and font settings),
  stage size, device pixel ratio and pane geometry (column width, cell sizing, default row height).
  The revision includes `chat-chrome-2`, and drawn pictures add `responsive-css-4`; bump them when chat
  chrome or the drawing changes so old pictures stop matching. Geometry starts with `stage:` because
  older records measured the outer workspace, including its toolbar.
- Pictures come only from panes whose committed detail has caught up with the thread shell
  (`markPaneSynced`), never during a running turn, and only at the current device pixel ratio.
  Native capture (HTML-in-Canvas) goes first; a drawn fallback follows when no capture arrives within
  a grace period, and never replaces a capture of the same content.
- Local visual changes such as scrolling or typing bump a pane's visual revision, which discards
  in-flight captures and drawings but keeps the current cover and the persisted picture until
  replacement pixels are accepted. A picture validated this session stays the cover while its thread
  refreshes.
- `ThreadPane` invalidates on content mutations and scroll or input events without forcing layout of
  hidden content. Attribute changes compare a batch's first old value with the final value, because
  React can briefly clear an input's name while changing its type. Composer focus classes are
  ignored because pictures omit draft selection, and releasing the router does not invalidate the
  saved pixels.
- Live producers (canvas, video, iframes, webviews, custom elements, shadow roots, browser slots)
  cannot be drawn. While present the pane renders live and its stored picture is deleted; after
  removal it keeps its live view until current static pixels exist.
- Pictures are drawn one at a time while idle, after 400 ms without input for a first picture and
  3 s for a refresh behind an existing cover; failures back off up to five minutes.
- Picture URLs are decoded during idle time to warm the browser's discardable image cache.
  `SavedPanePicture` keeps the current cover until a replacement decodes, since warmed pixels may
  have been discarded.
- Saved pictures are capped at 200 records and 128 MiB; the least recently saved go first.

### Drawn fallback

`panePictureSnapshot.ts` clones a pane into an SVG `foreignObject` with the page's styles and theme
variables. Only same-document styles and system fonts reach the image, which is what T3 uses.

- It waits two frames so hidden content and its resize observers settle, and lifts
  `content-visibility` only for the pane being drawn.
- Media rules are resolved against the live window, not the smaller SVG viewport.
- Unsent drafts are blanked out.
- Rem units resolve against the SVG root, so the root copies the document's font size.
- SVG text can round mixed-font line boxes differently from live text. A sample is drawn with
  `auto` and `geometricPrecision` text rendering, and the latter is applied only when it alone
  reproduces the native height and width.
- Image load and error handlers are both removed after either fires, because either can retain the
  encoded SVG.
- The desktop app rasterizes through `desktopBridge.rasterizePanePicture`; a failure falls back to
  decoding in the page.

## Styling

- Live DOM panes request compositor layers only while moving or in overview, without changing the
  library's default text rendering.
- While recording, the timeline keeps its custom scrollbar gutters so its virtual rows do not reflow.
- Overview titlebars overlay the thread's own header, so presentation changes do not resize content.
- The engine toolbar (z-index 35) stays below the floating controls (40) so the Onirigiri control
  remains visible inside the bar. With a fine pointer the bottom bar matches the sidebar footer's
  40 px; touch keeps 52 px.
- The full-screen toggle sets `data-spatial-full-screen-transition` for 320 ms, which outlasts the
  220 ms pane transition it enables.
