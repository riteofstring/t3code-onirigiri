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
import { memo, startTransition, use, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  ChatViewActivityContext,
  type ChatViewActivity,
} from "@t3tools/web/src/components/chatViewActivity";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import {
  ComposerHandleContext,
  useComposerHandleContext,
} from "@t3tools/web/src/composerHandleContext";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { useThreadDetail, useThreadShell, useThreadStatus } from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { PaneLifecycleContext, usePaneMounted } from "./paneLifecycle";
import { canCapturePanes } from "./panePictureSnapshot";
import { PaneSnapshotContext, markPaneSynced, usePanePictureTheme } from "./useSavedPanePictures";

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
}: {
  router: ReturnType<typeof createPaneRouter>;
}) {
  return <RouterProvider router={router} />;
});

/**
 * Background panes fetch detail before creating their router shell. Route content
 * mounts synchronously through the router store; readiness follows synchronization
 * and two layout frames. The thread's update and theme form the content revision.
 */
function usePaneContent(
  paneId: string,
  thread: ThreadPaneThread,
  visible: boolean,
  focused: boolean,
): { mounted: boolean; preparing: boolean; picturable: string | null } {
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

  useLayoutEffect(() => {
    markPaneSynced(
      paneId,
      renderContent && synced && settled && detailUpdatedAt !== null
        ? { updatedAt: detailUpdatedAt, theme: pictureTheme }
        : null,
    );
    return () => markPaneSynced(paneId, null);
  }, [detailUpdatedAt, paneId, pictureTheme, renderContent, settled, synced]);

  useOnirigiriPaneContentReady(renderContent && synced && settled, revision);

  useEffect(() => {
    if (!renderContent || !synced) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setSettled(false);
    };
  }, [renderContent, synced]);

  return {
    mounted: renderContent,
    preparing: renderContent && !settled,
    picturable:
      renderContent &&
      settled &&
      synced &&
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
  const active = focused && interactive;
  const threadPath = `/${thread.environmentId}/${thread.threadId}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [activity] = useState(() => createPaneActivity(active));
  const { mounted, preparing, picturable } = usePaneContent(paneId, thread, visible, focused);

  // The app shares one composer handle (the command palette provides it).
  // Each pane's ChatView gets its own, and the shared one follows focus.
  const appComposerRef = useComposerHandleContext();
  const paneComposerRef = useRef<ChatComposerHandle | null>(null);

  // A pane that stops being active gives up keyboard focus, so typing and
  // workspace navigation reach the active pane rather than this one.
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    activity.set(active);
    // The app's handle forwards every call to this pane's current handle,
    // which the composer replaces as its state changes.
    if (active && appComposerRef) appComposerRef.current = forwardComposerHandle(paneComposerRef);
    const focused = document.activeElement;
    if (!active && focused instanceof HTMLElement && contentRef.current?.contains(focused)) {
      focused.blur();
    }
  }, [active, activity, appComposerRef]);

  // A settled, synchronized view is pictured for when it is not mounted, and
  // again when it stops being active, in case it was scrolled meanwhile.
  // Native capture gets the first opportunity; the drawing remains a fallback
  // when a browser exposes the API but cannot capture this content.
  const requestSnapshot = use(PaneSnapshotContext);
  const wasActive = useRef(false);
  const refreshPending = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) refreshPending.current = true;
    wasActive.current = active;
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
          {mounted ? <PaneRouter router={router} /> : null}
        </div>
      </ComposerHandleContext>
    </ChatViewActivityContext>
  );
});

function forwardComposerHandle(target: {
  readonly current: ChatComposerHandle | null;
}): ChatComposerHandle {
  return new Proxy({} as ChatComposerHandle, {
    get: (_, key) => {
      const handle = target.current as Record<PropertyKey, unknown> | null;
      const value = handle?.[key];
      return typeof value === "function" ? value.bind(handle) : value;
    },
  });
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
