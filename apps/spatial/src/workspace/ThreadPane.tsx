import { useOnirigiriPaneContentReady, useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useParams,
} from "@tanstack/react-router";
import {
  createContext,
  memo,
  startTransition,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  ChatViewActivityContext,
  type ChatViewActivity,
} from "@t3tools/web/src/components/chatViewActivity";
import { ChatViewContentReadyProvider } from "@t3tools/web/src/components/chatViewContentReady";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import {
  ComposerHandleContext,
  type ComposerHandleRef,
  useComposerHandleContext,
} from "@t3tools/web/src/composerHandleContext";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { useThreadDetail, useThreadShell, useThreadStatus } from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";
import {
  PanelAnimationSuppressionProvider,
  usePanelNavigationSuppression,
} from "@t3tools/web/src/panelAnimations";

import { PaneLifecycleContext, usePaneMounted } from "./paneLifecycle";
import { canCapturePanes } from "./panePictureSnapshot";
import { PaneSnapshotContext, markPaneSynced, usePanePictureTheme } from "./useSavedPanePictures";

export const SpatialWorkspaceActiveContext = createContext(true);

export interface ThreadPaneThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function PaneThreadRoute() {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return target ? <ThreadRouteView target={target} /> : null;
}

const paneRootRoute = createRootRoute({ component: Outlet });
const paneRouteTree = paneRootRoute.addChildren([
  createRoute({
    getParentRoute: () => paneRootRoute,
    path: "$environmentId/$threadId",
    component: PaneThreadRoute,
  }),
]);

function createPaneActivity(initial: boolean) {
  let active = initial;
  const listeners = new Set<() => void>();
  const activity: ChatViewActivity & { set: (next: boolean) => void } = {
    autofocusComposer: false,
    isActive: () => active,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set: (next) => {
      if (next === active) return;
      active = next;
      for (const listener of listeners) listener();
    },
  };
  return activity;
}

const PaneRouter = memo(function PaneRouter({
  router,
  threadPath,
}: {
  router: ReturnType<typeof createPaneRouter>;
  threadPath: string;
}) {
  // The app route follows workspace focus; this retained thread has not navigated.
  const suppressed = usePanelNavigationSuppression(threadPath);
  return (
    <PanelAnimationSuppressionProvider value={suppressed}>
      <RouterProvider router={router} />
    </PanelAnimationSuppressionProvider>
  );
});

/**
 * Background panes fetch detail before creating their router shell. Route content
 * mounts synchronously through the router store; readiness follows synchronization
 * and the composer's initial presentation, then two layout frames. The thread's
 * update and theme form the content revision.
 */
function usePaneContent(
  paneId: string,
  thread: ThreadPaneThread,
  visible: boolean,
  focused: boolean,
): {
  mounted: boolean;
  preparing: boolean;
  picturable: string | null;
  onContentReadyChange: (ready: boolean) => void;
} {
  const lifecycle = use(PaneLifecycleContext);
  const mounted = usePaneMounted(paneId, visible);
  const shell = useThreadShell(thread);
  const detail = useThreadDetail(mounted ? thread : null);
  const updatedAt = shell?.updatedAt ?? null;
  const detailUpdatedAt = detail?.updatedAt ?? null;
  const status = useThreadStatus(mounted ? thread : null);
  const [contentMounted, setContentMounted] = useState(false);
  const contentAvailable = focused || detail !== null || status === "deleted";
  const renderContent = mounted && contentMounted;
  useEffect(() => {
    if (!mounted) setContentMounted(false);
    else if (contentAvailable && !contentMounted) {
      const show = () => startTransition(() => setContentMounted(true));
      if (focused) show();
      else {
        const idle = requestIdleCallback(show, { timeout: 1000 });
        return () => cancelIdleCallback(idle);
      }
    }
  }, [contentAvailable, contentMounted, focused, mounted]);
  useEffect(() => {
    lifecycle?.committed(paneId, renderContent);
  }, [lifecycle, paneId, renderContent]);
  const synced = status === "live" || status === "deleted";
  const pictureTheme = usePanePictureTheme();
  const running = shell?.latestTurn?.state === "running";
  const nextContentRevision = `${updatedAt}|${detailUpdatedAt}`;
  const [contentRevision, setContentRevision] = useState(nextContentRevision);
  if (!running && contentRevision !== nextContentRevision) setContentRevision(nextContentRevision);
  const revision = `${contentRevision}|${pictureTheme}`;
  const [settled, setSettled] = useState(false);
  const [viewReady, setViewReady] = useState(false);
  const contentReady = status === "deleted" || viewReady;
  const prepared = renderContent && synced && contentReady && settled;
  const [presented, setPresented] = useState(false);
  if (presented && !renderContent) setPresented(false);
  else if (!presented && prepared) setPresented(true);

  useLayoutEffect(() => {
    markPaneSynced(
      paneId,
      prepared && detailUpdatedAt !== null
        ? { updatedAt: detailUpdatedAt, theme: pictureTheme }
        : null,
    );
    return () => markPaneSynced(paneId, null);
  }, [detailUpdatedAt, paneId, pictureTheme, prepared]);

  // Later async work can delay a new picture without covering a live editor.
  useOnirigiriPaneContentReady(renderContent && presented, `${revision}|${presented && !prepared}`);

  useEffect(() => {
    if (!renderContent || !synced || !contentReady) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setSettled(false);
    };
  }, [contentReady, renderContent, synced]);

  return {
    mounted: renderContent,
    preparing: renderContent && !prepared,
    onContentReadyChange: setViewReady,
    picturable:
      prepared &&
      !running &&
      detailUpdatedAt !== null &&
      updatedAt !== null &&
      detailUpdatedAt >= updatedAt
        ? revision
        : null,
  };
}

function createPaneRouter(threadPath: string) {
  return createRouter({
    routeTree: paneRouteTree,
    history: createMemoryHistory({ initialEntries: [threadPath] }),
  });
}

/**
 * One thread rendered by its own live ChatView while the workspace keeps it
 * mounted. The pane owns a memory-history
 * router so every route read inside ChatView resolves to this thread; any
 * navigation away from it is handed to the app router instead. Only the
 * focused pane's ChatView is active while its content accepts input; switching
 * activity does not re-render it.
 */
export const ThreadPane = memo(function ThreadPane({
  thread,
  paneId,
  focused,
  visible,
  onNavigateAway,
}: {
  thread: ThreadPaneThread;
  paneId: string;
  focused: boolean;
  visible: boolean;
  onNavigateAway: (href: string) => void;
}) {
  const interactive = useOnirigiriPaneInteractive();
  const workspaceActive = use(SpatialWorkspaceActiveContext);
  const active = workspaceActive && focused && interactive;
  const threadPath = `/${thread.environmentId}/${thread.threadId}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [activity] = useState(() => createPaneActivity(active));
  const { mounted, preparing, picturable, onContentReadyChange } = usePaneContent(
    paneId,
    thread,
    visible,
    focused,
  );

  const paneComposerRef = usePaneComposerHandle(active);

  // A pane that stops being active gives up keyboard focus, so typing and
  // workspace navigation reach the active pane rather than this one.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activity.set(active);
    const focused = document.activeElement;
    if (!active && focused instanceof HTMLElement && contentRef.current?.contains(focused)) {
      focused.blur();
    }
  }, [active, activity]);

  // Reuse pictures across focus changes. Observe actual content changes and
  // input that can change scroll position without forcing hidden content layout.
  // Native capture gets the first opportunity; drawing remains its fallback.
  const requestSnapshot = use(PaneSnapshotContext);
  const refreshPending = useRef(false);
  const snapshotPrepared = useRef(false);
  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    if (!mounted) {
      snapshotPrepared.current = false;
      refreshPending.current = false;
      return;
    }
    if (!snapshotPrepared.current && picturable === null) return;
    snapshotPrepared.current = true;
    const invalidate = () => {
      refreshPending.current = true;
      if (active || picturable === null || !requestSnapshot) return;
      requestSnapshot(paneId, element, { preferNative: canCapturePanes(), refresh: true });
      refreshPending.current = false;
    };
    const contentChanged = (records: MutationRecord[]) => {
      const attributes = new Map<Element, Set<string>>();
      return records.some((record) => {
        const { target, type, attributeName, oldValue } = record;
        if (type !== "attributes" || !(target instanceof Element) || attributeName === null)
          return true;
        if (
          target === element &&
          (attributeName === "data-spatial-active" || attributeName === "data-spatial-preparing")
        )
          return false;
        let seen = attributes.get(target);
        if (!seen) attributes.set(target, (seen = new Set()));
        if (seen.has(attributeName)) return false;
        seen.add(attributeName);
        // React can temporarily clear an input's name while updating its type.
        // Compare the batch's initial value with its final value.
        const currentValue = target.getAttribute(attributeName);
        if (attributeName === "class" && target.matches('[data-testid="composer-editor"]')) {
          // Focus changes selection inside draft content, which pictures omit.
          const pictureClasses = (value: string | null) =>
            (value ?? "")
              .split(/\s+/)
              .filter((name) => name !== "ProseMirror-focused")
              .join(" ")
              .trim();
          return pictureClasses(oldValue) !== pictureClasses(currentValue);
        }
        return oldValue !== currentValue;
      });
    };
    const observer = new MutationObserver((records) => {
      if (contentChanged(records)) invalidate();
    });
    observer.observe(element, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const onKeyDown = (event: KeyboardEvent) => {
      const modifierOnly = ["Alt", "Control", "Meta", "Shift"].includes(event.key);
      const navigating =
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key.startsWith("Arrow") || event.code === "KeyO");
      if (!modifierOnly && !navigating) invalidate();
    };
    const events = ["wheel", "pointerdown", "input", "drop", "load"] as const;
    element.addEventListener("keydown", onKeyDown, true);
    for (const event of events)
      element.addEventListener(event, invalidate, { capture: true, passive: true });
    return () => {
      if (contentChanged(observer.takeRecords())) refreshPending.current = true;
      observer.disconnect();
      element.removeEventListener("keydown", onKeyDown, true);
      for (const event of events) element.removeEventListener(event, invalidate, true);
    };
  }, [active, mounted, paneId, picturable, requestSnapshot]);
  useEffect(() => {
    if (picturable !== null && contentRef.current && requestSnapshot) {
      requestSnapshot(paneId, contentRef.current, {
        preferNative: canCapturePanes(),
        refresh: refreshPending.current,
      });
      refreshPending.current = false;
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Visibility retries a previously unmeasurable pane.
  }, [active, paneId, picturable, requestSnapshot, visible]);

  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (location.pathname === threadPath) return;
        onNavigateAway(location.href);
        router.history.replace(threadPath);
      }),
    [onNavigateAway, router, threadPath],
  );

  return (
    <ChatViewActivityContext value={activity}>
      <ComposerHandleContext value={paneComposerRef}>
        <div
          ref={contentRef}
          onKeyDownCapture={leaveComposerOnEscape}
          className="spatial-thread-pane h-full w-full"
          data-spatial-thread={thread.threadId}
          data-spatial-active={String(active)}
          data-spatial-preparing={preparing ? "" : undefined}
        >
          <ChatViewContentReadyProvider onReadyChange={onContentReadyChange}>
            {mounted ? <PaneRouter router={router} threadPath={threadPath} /> : null}
          </ChatViewContentReadyProvider>
        </div>
      </ComposerHandleContext>
    </ChatViewActivityContext>
  );
});

// Shared commands see the real handle or null, including composer replacements.
function usePaneComposerHandle(active: boolean): ComposerHandleRef {
  const appComposerRef = useComposerHandleContext();
  const [pane] = useState(() => {
    let handle: ChatComposerHandle | null = null;
    let connected: ComposerHandleRef | null = null;
    return {
      ref: {
        get current() {
          return handle;
        },
        set current(next: ChatComposerHandle | null) {
          if (connected && connected.current === handle) connected.current = next;
          handle = next;
        },
      },
      connect(app: ComposerHandleRef) {
        connected = app;
        app.current = handle;
        return () => {
          if (connected && connected.current === handle) connected.current = null;
          connected = null;
        };
      },
    };
  });
  useLayoutEffect(() => {
    if (active && appComposerRef) return pane.connect(appComposerRef);
  }, [active, appComposerRef, pane]);
  return pane.ref;
}

// Escape in the composer leaves it, so the workspace's arrow-key navigation
// works again, unless its suggestion list is open for Escape to close.
function leaveComposerOnEscape(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const editor = target.closest<HTMLElement>('[data-testid="composer-editor"]');
  if (!editor || editor.hasAttribute("aria-controls")) return;
  event.preventDefault();
  editor.blur();
}
