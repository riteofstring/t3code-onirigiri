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
- The focused pane mounts first once focus and visibility have been quiet briefly. No new mounts
  are admitted during camera motion, though a transition admitted just before may still commit: a
  saved picture or the thread card covers the destination and the view mounts after the final
  frame. Visible peers then mount one at a time, each after the previous one commits.
- Neighbours, the next one in the direction of travel first, and unviewed running threads use spare
  slots only while the page is idle and input has been quiet. Navigation cancels speculative work
  that has not started.
- Leaving overview releases excess views one commit at a time during idle input, instead of
  unmounting them all on the last frame.
- Panes without a picture share one extra mount slot to be pictured: untried panes first, visited
  ones before untouched ones, then the oldest attempt. A mount made only to picture a pane is
  admitted after ten seconds without input or camera motion, so preparing a new display's pictures
  happens while the user is away rather than between their moves; a view leaving the warm set before
  its first picture keeps its slot under the ordinary gates. A reservation interrupted by input,
  motion or covering keeps its place without counting as a failure; a real failure waits minutes
  before a retry; a deliberate revisit takes the pane over.
- Mount changes reach panes as transitions (`usePaneMounted`), so mounting a ChatView does not block
  input.
- The lifecycle and the snapshot queue track input separately: the queue only timestamps it, while
  the lifecycle also interrupts a picture reservation. The queue asks the lifecycle whether a pane is
  mounted only to be pictured, holds that drawing to the same ten quiet seconds, and drops it once
  the lifecycle has released the mount, even while React is still unmounting the view.

## Pictures

Unmounted thread panes show a picture of their last synchronized content, or a `ThreadCard` built from
the thread shell, which is never stale.

- A record is keyed by pane and geometry: stage size, device pixel ratio, pane geometry (column
  width, cell sizing, default row height) and the layout mode, `tiled` or `compact`. Pictures of
  several displays and modes coexist, so returning to a display selects its stored pictures instead
  of drawing every thread again. A picture already validated this session remains a cover during a
  same-mode resize until an exact-geometry replacement decodes. Tiled and compact covers never cross
  modes: compact layout, including full screen, draws every pane at the stage size while the layout
  keeps its column widths, so reusing it in a tiled pane would clip the chat. A live producer deletes
  every record of its pane. The store is IndexedDB version 2; opening it drops the version 1
  per-pane records.
- A record's revision holds the thread update and theme (palette, appearance and font settings),
  includes `chat-chrome-2`, and drawn pictures add `responsive-css-5`; bump them when chat chrome or
  the drawing changes so old pictures stop matching. Revision 5 invalidates pictures saved under the
  former raster-size cap even when their display geometry still matches. Geometry starts with
  `stage:` because older records measured the outer workspace, including its toolbar.
- Pictures come only from panes whose committed detail has caught up with the thread shell
  (`markPaneSynced`), never during a running turn, and only at the current device pixel ratio.
  Native capture (HTML-in-Canvas) goes first; a drawn fallback follows when no capture arrives within
  a grace period, and never replaces a capture of the same content.
- Local visual changes such as scrolling or typing bump a pane's visual revision, which discards
  in-flight captures and drawings but keeps the current cover and the persisted picture until
  replacement pixels are accepted. A picture validated this session stays the cover while its thread
  refreshes or its same-mode geometry changes, but does not count as fresh. Keep supplying that cover
  to the engine: withdrawing a replaceable picture releases its image and submitting it again repeats
  decoding and low-resolution preview preparation.
- Stored pictures usually load before the stage is measured and the thread shells arrive, so
  placeholders render again whenever a pane's first valid cover appears, and again on every geometry
  change to select that geometry's record. Shell refreshes keep the existing cover without
  re-rendering placeholders.
- `useSavedPanePictures` opts out of the React Compiler (`"use no memo"`): its callbacks publish
  geometry and cover changes through version counters in their dependency lists, which the compiler
  would drop.
- `ThreadPane` invalidates on content mutations and scroll or input events without forcing layout of
  hidden content. Attribute changes compare a batch's first old value with the final value, because
  React can briefly clear an input's name while changing its type. Composer focus classes are
  ignored because pictures omit draft selection, and releasing the router does not invalidate the
  saved pixels.
- Live producers (canvas, video, iframes, webviews, custom elements, shadow roots, browser slots)
  cannot be drawn. While present the pane renders live and its stored picture is deleted; after
  removal it keeps its live view until current static pixels exist.
- Pictures are drawn one at a time while idle, after 400 ms without input for a first picture, 3 s
  for a refresh behind an existing cover and 10 s for a pane mounted only to be pictured; a drawing
  of that kind interrupted midway yields to a waiting first picture. Failures back off up to five
  minutes. Camera motion and full-screen transitions count as input when they start and when they
  end, and nothing is drawn or prepared during a full-screen transition.
- Drawing rasterizes the cloned pane on the main thread at the device pixel ratio, about in
  proportion to its pixels (a stage-sized 2x picture takes about 670 ms). The idle gates above keep
  that cost out of input and motion; a smaller picture would read blurred on the display it was
  drawn for.
- Picture URLs are decoded during idle time to warm the browser's discardable image cache.
  `SavedPanePicture` keeps the current cover until a replacement decodes, including same-mode geometry
  changes, since warmed pixels may have been discarded, and shows the thread card until its first
  picture decodes rather than an empty frame. Only the selected cover per pane retains a warmed URL.
- Saved pictures are capped at 200 records and 128 MiB; the least recently saved go first. Background
  preparation counts only current-geometry records against its budget, so pictures of older displays
  cannot prevent the current display from acquiring pictures.

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

## T3 web seams

The fork adds a few seams to `apps/web` so a host can show several threads at once while the stock
app keeps one routed thread.

- `chatSurface.ts` lets a host replace how the chat route presents threads; without a provider the
  route renders one `ThreadRouteView`, as upstream does.
- `chatViewActivity.ts`: a passive ChatView still renders and updates, but ignores window-level
  shortcuts, typing, paste and focus requests, never takes focus and does not mark its thread
  visited. Activity is read through a stable object, not a context value, so switching it does not
  re-render the ChatView. `autofocusComposer` is off when arrow keys navigate between views; typing
  still reaches the composer through type-to-focus.
- `workspaceFocusedThreadStore.ts` lets the sidebar highlight the focused thread at once while the
  route follows only after navigation pauses; null leaves the highlight to the route.
- Terminals whose id carries the `terminalOwnership.ts` prefix belong to a host pane; the thread's
  terminal drawer leaves them alone, so one session is never shown by two viewports.
- `chatViewContentReady.tsx` keeps a host's cover until layout, synchronization and suspended
  content settle; a committed Suspense fallback is never pictured as complete, and later checkout
  changes stay ordinary live updates.
- Pane contents may be uniformly scaled while their CSS uses layout pixels, so composer and list
  geometry read layout sizes (`layoutGeometry.ts`).
- Browser surface projection reads lifecycle metadata only and must not force layout. A preview
  address can be submitted before the host commits its first guest, so navigation shares the
  guest's creation lease and saved defaults apply first.
- Pierre keeps its old render range after hidden code is replaced by a placeholder, so
  `useFileViewport` re-renders a virtualized file whenever it intersects its editor viewport again.

## Styling

- Live DOM panes request compositor layers only while moving or in overview, without changing the
  library's default text rendering.
- While recording, the timeline keeps its custom scrollbar gutters so its virtual rows do not reflow.
- Overview titlebars overlay the thread's own header, so presentation changes do not resize content.
- The engine toolbar (z-index 35) stays below the floating controls (40) so the Onirigiri control
  remains visible inside the bar. With a fine pointer the bottom bar matches the sidebar footer's
  40 px; touch keeps 52 px.
- Over a bottom bar, the open Onirigiri control drops its border and shadow and takes the bar's
  color: the card on the desktop navigation bar, the workspace grey on the compact bar. Its buttons
  then read as part of the bar, while it still covers the bar controls it slides over when the
  advanced settings are open or the screen is narrow. Its transparent 1 px border stays unpainted,
  so the bar's top line shows where a 40 px bar and the control share an edge.
- The full-screen toggle never animates live content. Animating pane width and height made every
  warm chat lay out on each frame, which stalled frames for 300 to 500 ms on a 2560 px stage.
  `useFullScreenTransition` fades the whole engine workspace out, swaps the layout while it is
  invisible with the navigation camera snapped instead of gliding, then fades it back in. A copy of
  the focus border bridges the two states: entering full screen it grows from the focused pane past
  the workspace edges and fades; leaving, it fades in at the edges and shrinks onto the focused pane
  while the workspace fades in. The copy is eight pieces (four corners that only move and four
  edges that also stretch along their length), so its line width never scales and every piece
  animates on the compositor through the main-thread layout of the swap. The engine's own cursor
  stays hidden until the copy lands. Panes that end off screen keep their content skipped until the
  transition ends. Narrow stages are compact either way and reduced motion skips the sequence, so
  both switch at once. Browser guests cannot fade, so they hide for the whole sequence.
- A sidebar drag writes an inline width to the sidebar gap only while it runs. The spatial app holds
  the gap at the committed `--sidebar-width` instead, so the workspace resizes once on release rather
  than on every frame; the sidebar container still follows the pointer and overlays the workspace.
- Pane shadows pair a tight darker layer with a wide faint one, so the pane edge stays distinct
  from its shadow. Each pane is its own compositor layer, and Chrome blends that layer's shadow
  onto the dark workspace grey without dithering, so the faint layer can step one color level at a
  time. Noise above or below the pane layer cannot help: it lands after the steps are fixed, and
  noise inside every pane layer (a filtered SVG `border-image`) made motion visibly slower on a 4K
  display, so the shadows are not dithered. Overview keeps the engine's edge-only pane shadow.
