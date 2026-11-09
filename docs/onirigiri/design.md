# Onirigiri for T3 Code: design constraints

`apps/spatial` runs T3's own router and app shell and replaces only the chat area with an Onirigiri
workspace of thread panes and the tool panes users add beside them. The standalone sibling repository
`onirigiri-t3-adapter` owns `@riteofstring/onirigiri-t3` and its pure row reconciliation; its README
states those rules. The spatial package links its unchanged TypeScript source exports directly into
the application bundle. T3 retains ownership of selectors, persistence, routes and pane lifecycle.
This page records constraints that span files and are easy to break without noticing.

## Build

- The sibling adapter is validated at commit `a529cce47d07ebfa1c1c82e0aecb133539c9db9e`.
  Its `link:` dependency reads that checkout directly; keep it on the recorded revision when
  reproducing this build. T3 worktrees that adopt the link share the same sibling checkout.
  Adapter tests and Code Polishy checks belong there; workspace integration tests remain here.
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

- Full screen panes omit the workspace maximum height while applied fullscreen is active. The saved
  cap and control limits remain unchanged; the cap returns at the exit transition's geometry swap.
  Single-pane maximize is separate and respects the height cap when fullscreen is off. The engine
  resolves the same limit for chat, draft and tool-pane maximize entry points.
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

- Loaded trees remain mounted across focus and visibility changes. The prior 32-tree retention cap
  bounds the ordinary mounted set; eviction is least recently visible or focused, protects the whole
  visible set and dirty panes without a current picture, and runs only after the 500 ms quiet tail.
  This count bounds retained trees, not measured per-tree heap usage. The retained-peer rig measures
  heap growth and store-driven work before this experiment can be treated as a memory guarantee.
- Motion admits no new trees and releases none. Retained destinations reveal their existing DOM at
  rest. Cold destinations still pay stock ChatView admission cost and remain subject to the same
  acceptance limits.
- Spare slots fill nearest-first, one mount per browser idle opportunity after quiet. A prepared
  picture does not exclude its unloaded tree from this fill. Preparation waits for the admitted
  content and its picture before filling another slot; input cancels pending speculative work.
- Offscreen retained content uses the engine's hidden runtime and content visibility containment
  to exclude layout and paint. Its React subscriptions remain attached; hiding does not suspend
  store updates. Current pictures cover motion; a dirty pane without current pixels remains live.

## Pictures

Unmounted thread panes show a picture of their last synchronized content, or a `ThreadCard` built from
the thread shell, which is never stale.

- Static threads with a usable picture keep that image during navigation and overview, including
  when their live view is still mounted. Revealing retained chat DOM during camera movement forces
  costly style and layout work; the live view returns at rest or during resizing. Threads awaiting
  their first picture, running turns, live producers and tool panes keep their live presentation.
  The cover uses the same geometry validation and layout-mode separation as an unmounted pane.
- A chat leaves its DOM during motion unless removal would lose state that lives only in that DOM:
  opened sections, edits outside the composer, or arrival typing not yet delivered. Composer text,
  attachments and pending answers live in the composer draft store, so composer edits and clicks do
  not keep a chat live.
- Overview never presents or admits chat DOM. A chat without a usable picture shows a title card
  (project icon, project and thread title) with no spinner or status. Leaving overview restores
  focus and visibility admission together, so the destination composer still loads first.
- A record is keyed by pane and applied geometry: stage size, device pixel ratio, column and cell
  sizing, workspace defaults, the selected type defaults and per-pane defaults, plus `tiled` or
  `compact` layout. Read sizing from the engine scene when its layout notification arrives:
  serialized layouts omit workspace defaults, so they cannot distinguish capped pictures from
  fullscreen pictures after a sizing change. Fullscreen omits the applied height cap; editing its
  saved preference does not invalidate fullscreen pixels until the cap applies again on exit.
  Viewport width and height changes invalidate compact pictures as well as tiled ones. Pictures
  of different valid geometries coexist; returning to one can reuse its pixels. A picture from a
  different geometry is unavailable until replacement pixels are captured. Tiled and compact
  covers never cross modes: full screen uses viewport geometry while the saved layout keeps its
  column widths, so reusing a compact picture in a tiled pane would clip the chat. A live producer deletes
  every record of its pane. The store is IndexedDB version 2; opening it drops the version 1
  per-pane records.
- A record's revision holds the thread update and theme (palette, appearance and font settings),
  includes `chat-chrome-2`, and drawn pictures add `responsive-css-5`; bump them when chat chrome or
  the drawing changes so old pictures stop matching. Revision 5 invalidates pictures saved under the
  former raster-size cap even when their display geometry still matches. Geometry starts with
  `stage:` because older records measured the outer workspace, including its toolbar.
- Pictures come only from panes whose committed detail has caught up with the thread shell
  (`markPaneSynced`), never during a running turn, and only at the current device pixel ratio.
  The app owns picture acquisition; it does not also seed or capture through the engine.
- Local visual changes such as scrolling or typing bump a pane's visual revision, which discards
  in-flight captures and drawings but keeps the current cover and the persisted picture until
  replacement pixels are accepted. A picture validated this session stays the cover while its thread
  refreshes at the same geometry, but does not count as fresh. Keep supplying that cover
  to the placeholder: withdrawing a replaceable picture releases its image and submitting it again
  repeats decoding.
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
  for a refresh behind an existing cover and 3 s for a pane mounted only to be pictured; a drawing
  of that kind interrupted midway yields to a waiting first picture. Failures back off up to five
  minutes. Camera motion and full-screen transitions count as input when they start and when they
  end, and nothing is drawn or prepared during a full-screen transition.
- Browser drawing rasterizes the cloned pane on the main thread at the device pixel ratio. Its
  synchronous raster flush can exceed an idle budget and cannot be interrupted once started. The
  gates limit when new work starts and pause subsequent passive work after observed pressure; they
  cannot guarantee a stall-free capture. Keep timing the full preparation and export on hardware.
  Lowering picture density would blur the cover on the display it was drawn for.
- Picture URLs are decoded during idle time. Each selected cover retains its decoder so a ready URL
  keeps its loaded image resource when the live view temporarily replaces its image element.
  Removing the cover releases both the URL and decoder; decoded pixels remain browser-managed.
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
- Over a bottom bar, the open Onirigiri control drops its border and takes the bar's
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
- The spatial app has no box, text, or icon drop shadows, including shared chat controls,
  notifications, menus, and tooltips, in either theme or presentation mode. Keyboard focus uses
  outlines. The rule lives in the spatial stylesheet; other T3 clients retain their own styling.
