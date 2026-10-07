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
import { memo, use, useEffect, useLayoutEffect, useRef, useState } from "react";

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
import { useTheme } from "@t3tools/web/src/hooks/useTheme";
import { useThreadShell, useThreadStatus } from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { usePaneMounted } from "./paneLifecycle";
import { canCapturePanes } from "./panePictureSnapshot";
import { PaneSnapshotContext, markPaneSynced } from "./useSavedPanePictures";

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
 * Mounts the pane's ChatView while the workspace keeps it live, and reports its
 * content ready two frames after synchronization, once the view has laid out. The
 * thread's last update and the app's theme form the content revision.
 */
function usePaneContent(
  paneId: string,
  thread: ThreadPaneThread,
  visible: boolean,
): { mounted: boolean; picturable: string | null } {
  const mounted = usePaneMounted(paneId, visible);
  const updatedAt = useThreadShell(thread)?.updatedAt ?? null;
  const status = useThreadStatus(thread);
  const synced = status === "live" || status === "deleted";
  const { theme, resolvedTheme } = useTheme();
  const revision = `${updatedAt}|${theme}|${resolvedTheme}`;
  useEffect(() => {
    markPaneSynced(paneId, mounted && synced);
    return () => markPaneSynced(paneId, false);
  }, [mounted, paneId, synced]);
  const [settled, setSettled] = useState(false);

  useOnirigiriPaneContentReady(mounted && synced && settled, revision);

  useEffect(() => {
    if (!mounted || !synced) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSettled(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setSettled(false);
    };
  }, [mounted, synced]);

  return { mounted, picturable: mounted && settled && synced ? revision : null };
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
  const { mounted, picturable } = usePaneContent(paneId, thread, visible);

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

  // Onirigiri skips laying out content off screen. A view mounted there, to
  // be prepared or pictured, is laid out anyway so it renders and measures as
  // it will when shown.
  useLayoutEffect(() => {
    if (!mounted || visible) return;
    const host = contentRef.current?.closest<HTMLElement>(".onirigiri-pane__live-content");
    if (!host) return;
    host.style.contentVisibility = "visible";
    return () => {
      host.style.contentVisibility = "";
    };
  }, [mounted, visible]);

  // A settled, synchronized view is pictured for when it is not mounted, and
  // again when it stops being active, in case it was scrolled meanwhile.
  // Native capture gets the first opportunity; the drawing remains a fallback
  // when a browser exposes the API but cannot capture this content.
  const requestSnapshot = use(PaneSnapshotContext);
  useEffect(() => {
    if (picturable !== null && contentRef.current) {
      requestSnapshot?.(paneId, contentRef.current, canCapturePanes());
    }
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Leaving the active state pictures the view again.
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
