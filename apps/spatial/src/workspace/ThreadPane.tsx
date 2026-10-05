import { useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
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
import { memo, useEffect, useRef, useState } from "react";

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
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

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

function createPaneRouter(threadPath: string) {
  return createRouter({
    routeTree: paneRouteTree,
    history: createMemoryHistory({ initialEntries: [threadPath] }),
  });
}

/**
 * One thread rendered by its own live ChatView. The pane owns a memory-history
 * router so every route read inside ChatView resolves to this thread; any
 * navigation away from it is handed to the app router instead. Only the
 * focused pane's ChatView is active while its content accepts input; switching
 * activity does not re-render it.
 */
export const ThreadPane = memo(function ThreadPane({
  thread,
  focused,
  onNavigateAway,
}: {
  thread: ThreadPaneThread;
  focused: boolean;
  onNavigateAway: (href: string) => void;
}) {
  const interactive = useOnirigiriPaneInteractive();
  const active = focused && interactive;
  const threadPath = `/${thread.environmentId}/${thread.threadId}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [activity] = useState(() => createPaneActivity(active));

  // The app shares one composer handle (the command palette provides it).
  // Each pane's ChatView gets its own, and the shared one follows focus.
  const appComposerRef = useComposerHandleContext();
  const paneComposerRef = useRef<ChatComposerHandle | null>(null);

  useEffect(() => {
    activity.set(active);
    if (active && appComposerRef) appComposerRef.current = paneComposerRef.current;
  }, [active, activity, appComposerRef]);

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
          className="spatial-thread-pane h-full w-full"
          data-spatial-thread={thread.threadId}
          data-spatial-active={String(active)}
        >
          <PaneRouter router={router} />
        </div>
      </ComposerHandleContext>
    </ChatViewActivityContext>
  );
});
