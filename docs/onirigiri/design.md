# Onirigiri for T3 Code: design constraints

`apps/spatial` runs T3's own router and app shell and replaces only the chat area with an Onirigiri
workspace of thread panes and the tool panes users add beside them. The standalone sibling repository
`onirigiri-t3-adapter` owns `@riteofstring/onirigiri-t3` and its pure row reconciliation; its README
states those rules. The adapter keeps saved row order; `useWorkspacePanes` then orders rows by the
sidebar's project order, so the sidebar decides row order and the saved layout decides the panes
within each row. The spatial package compiles its unchanged TypeScript source exports directly into
the application bundle. T3 retains ownership of selectors, persistence, routes and pane lifecycle.
This page records constraints that span files and are easy to break without noticing.

## Build

- The engine and the adapter are vendored tarballs in `apps/spatial/vendor`, pinned by integrity in
  the lockfile: engine commit `11ef75c`, adapter commit
  `02f675942c6d8021451955d9f7cb3a56773ad734`. Their tests and Code Polishy checks belong in their
  own repositories; workspace integration tests remain here.
- The server package bundles `apps/spatial/dist` as its client, so the desktop app and `t3` serve
  the workspace. The desktop app turns on Chromium's `CanvasDrawElement` feature before startup,
  because pane pictures need it.
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

- The workspace stays mounted for every chat route. Only the pull-requests page, or having no
  threads, covers it and shows T3's own page instead. Drafts open as draft panes inside the
  workspace; a sent draft keeps its pane while its first turn streams and is released once hidden.
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
  ChatView and history report ready, and the browser has had an idle period. After it has been presented, later
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
  chrome after navigation. Focusing a guest dispatches a pointerdown and pointerup on its slot, the
  same focus-without-camera-movement path native pane content uses; the release keeps input trackers
  from waiting on a press that never ends.

## Pane lifecycle

`paneLifecycle.ts` decides which thread panes mount a live ChatView; mounting is the expensive step.

- The focused pane and every visible pane are retained; in full screen the four adjacent panes are
  retained too. Retention is capped at ten trees, but the retained set itself is never evicted, so
  a large visible set can exceed the cap. After a 500 ms quiet tail, the trees
  farthest from the focused pane are evicted first, and only when they have a current picture and
  no state that removal would lose.
- When the camera starts moving, every mounted chat is asked whether its picture can cover it.
  Chats with a picture and nothing to lose hand the keyboard to their pane and move as their
  picture, with their DOM kept but unrendered beneath it; the others stay live for the whole move.
  The focused chat always stays live, including a loaded chat that takes focus during the move, and
  its composer keeps the keyboard, so typing lands while the camera is still gliding. Covering it
  until the stop delayed the first key by about half a second and dropped keys pressed on the way.
  A chat that loses focus during the move is covered again if its picture can cover it, so a run
  of moves keeps one chat live, not every chat passed.
  A chat the user has scrolled, or whose composer has changed, since its picture was taken stays
  live through moves until a picture shows the change: its old picture would show the old position
  or draft for the length of the move. A scroll counts while a pointer pressed in that chat is still down, wherever it is released, or
  within a second of a wheel, touch or key event outside the composer, so a timeline following a
  running turn does not hold its chat live.
  Nothing is removed for a move, because rebuilding a chat on arrival costs most of a second and
  removing several froze the start of the move. Motion admits no new trees.
- At rest visible chats load one at a time: the focused chat first, then the nearest. Each mounts
  its composer, then its timeline two frames later, and the next chat starts once the one before
  it is interactive, or 2.5 s after that one started waiting if it never is. Other visible panes
  mount at once. Pictures are not taken while a chat is still to load. A chat that kept its DOM through
  the move needs no loading: the focused one never left the screen, and the other
  visible ones leave their pictures one every two frames, nearest first, because rendering them
  all in the stopping frame was one long stall.
- In overview no chat is admitted for arrival and thread data preparation stops. Chats without a
  current picture are still mounted one at a time, hidden behind their cards, only to take their
  picture: the chat focused most recently first, then those on screen, then nearest the pane
  overview was entered from. So a chat never
  opened gets a picture in overview instead of keeping its title card.
- When idle, one offscreen chat at a time is mounted only to take its picture: the chat focused
  most recently first, then the nearest and, at equal distance, a chat with no cover at all before
  one with a stale cover; it waits behind
  every arrival and gives up after 10 s, retrying after five minutes. At the retention cap the
  farthest tree with a current picture is evicted to make room, so one long rest reaches every
  chat that can be pictured. A chat whose picture is current is never mounted to take a picture.
  Once nothing is left to picture, the four nearest offscreen chats are loaded the same way, one
  per idle period, so walking to a neighbour finds it loaded. A chat loaded in the background mounts
  its composer in one idle period and its timeline in a later one: both in one step was a single
  task of several hundred milliseconds that a key pressed in the rest had to wait behind. At the cap one of those is loaded
  only in place of a tree farther away.
- The six nearest offscreen chats that are not mounted keep their thread data loaded, with
  nothing of theirs mounted, so the first visit to a neighbour does not wait for its data. One
  more is added per idle period that has time to spare. That runs only where background pictures
  run and after the arrival's timelines are revealed, so not while the camera moves, a pointer is
  held, or in overview or full screen, where the set already loaded is kept. The set follows the
  focus.
- Offscreen retained content uses the engine's hidden runtime and content visibility containment
  to exclude layout and paint. Its React subscriptions remain attached; hiding does not suspend
  store updates. This is why the mounted set is capped: every mounted chat re-renders on shell
  updates.

## Pictures

Unmounted thread panes show a picture of their last synchronized content, or a `ThreadCard` built from
the thread shell, which is never stale.

- During motion a chat with a usable picture shows that picture, even when slightly out of date,
  including a chat with a running turn or a pending request. A chat with no picture at its current
  geometry stays live until one is taken. At rest every visible chat is live again. Tool panes are
  live unless the other-panes setting (below) selects pictures.
- A chat moves as its picture, and can be evicted at rest, unless it holds state that lives only in its DOM:
  sections opened in the timeline, edits outside the composer, or arrival typing not yet delivered. Composer text,
  attachments and pending answers live in the composer draft store, so composer edits, clicks and
  keys do not keep a chat from being evicted; a composer change does keep it live through moves
  until its picture shows the change (above). A chat with a live producer also moves as its stored picture,
  even though that picture cannot show the producer.
  Once a chat holds state of its own, it keeps its DOM until it unmounts, so it also stays
  exempt from eviction; reload or close it to release the hold.
- Overview never presents chat DOM. A chat without a usable picture shows a title card
  (project icon, project and thread title) with no spinner or status. The card's icon and title
  sit at the same height in every variant, with status and spinner hung below them, so a card that
  changes variant as overview opens does not jump. Leaving overview restores
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
  column widths, so reusing a compact picture in a tiled pane would clip the chat. A live producer keeps
  its pane's records and blocks fresh captures; an existing record can still cover motion. The store is IndexedDB version 2; opening it drops the version 1
  per-pane records.
- A record's revision holds the thread update and theme (palette, appearance and font settings),
  includes `chat-chrome-2`, and every picture adds `native-worker-9`; bump them when chat chrome or
  the capture changes so old pictures stop matching. Geometry starts with
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
  cannot be drawn. While one is present the pane is never captured and its picture never counts as
  fresh, so at rest the pane stays live; during motion its existing picture still covers it. After
  removal it keeps its live view until current static pixels exist.
- Pictures are taken, saved and faded in one at a time while idle, and only after the workspace has
  been at rest for 2 s: no key, wheel, pointer or text input and no camera motion. Missing
  pictures go first, then refreshes behind an existing cover, then panes mounted only to be pictured,
  which yield to any other due request; within each group the chat focused most recently goes
  first. Failures back off from 3 s, doubling up to five minutes.
  Any input, Option+arrow navigation keys included, and the end of a move restart the 2 s rest.
  Nothing is taken while the camera moves or during a full-screen transition, and a capture in
  progress is abandoned when either starts. A chat mounted only for its picture and not yet loaded
  is unmounted on input. A picture that arrives while the camera moves shows without a fade.
- A pane is only pictured while it is off screen or covered. Capturing on-screen chats was tried
  and produced one-frame blank panes, so a chat you are looking at gets its picture after it
  scrolls away, or in overview, where a card covers every chat: there the chats still mounted are
  pictured in place, so the chat you came from has its picture within a few seconds. Leaving
  overview abandons a capture in progress.
- An off-screen chat keeps its contents unrendered until the engine moves them into its recording
  canvas, and they return to their place unrendered in the step that ends the recording. Showing
  them first and hiding them afterwards restyled the whole chat four times per picture, about
  40% of all style work in the rest after a move.
- Picture URLs are decoded during idle time. Each selected cover retains its decoder so a ready URL
  keeps its loaded image resource when the live view temporarily replaces its image element.
  Removing the cover releases both the URL and decoder; decoded pixels remain browser-managed.
  `SavedPanePicture` keeps the current cover until a replacement decodes, including same-mode geometry
  changes, since warmed pixels may have been discarded, and shows the thread card until its first
  picture decodes rather than an empty frame. Only the selected cover per pane retains a warmed URL.
- The other-panes setting chooses pictures or live for non-chat panes during motion and resizing. It defaults to
  live, is set with `?otherPanes=pictures` or `?otherPanes=live`, and is remembered under
  `onirigiri.otherPanes`.
- Saved pictures are capped at 200 records and 128 MiB; the least recently saved go first. Background
  preparation counts only current-geometry records against its budget, so pictures of older displays
  cannot prevent the current display from acquiring pictures.

### Capture

`panePictureSnapshot.ts` hands the live pane element to the engine's `captureOnirigiriPanePicture`,
which records it, returns the content to its slot as soon as it is recorded, and rasterizes and
encodes in a worker. Nothing is cloned and draft text is kept.

- Panes with a live producer are never captured.
- The pane's live-content host carries `data-spatial-snapshot` only while it is being recorded.
- The capture is abandoned if the pane disconnects, its revision changes or the signal aborts.

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
