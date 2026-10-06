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
  Activity,
  memo,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
import { useThreadShell } from "@t3tools/web/src/state/entities";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { usePaneBudget } from "./liveBudget";

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

/**
 * Whether the pane's ChatView can be parked: hidden with its state kept while a
 * picture of its current content stands in for it. Each thread change is a new
 * content revision, so only a picture taken after it can park the pane, and a
 * parked pane is revealed again to have its picture retaken. Content is
 * reported not ready for two frames after a reveal so that picture is only
 * taken once the revealed view has settled.
 */
function usePaneParking(paneId: string, thread: ThreadPaneThread) {
  const budget = usePaneBudget(paneId);
  const contentRevision = useThreadShell(thread)?.updatedAt ?? null;
  const [ready, setReady] = useState(true);
  const [baseline, setBaseline] = useState<{ content: string | null; picture: number } | null>(
    null,
  );
  const fresh =
    baseline !== null &&
    baseline.content === contentRevision &&
    budget.pictureRevision !== null &&
    budget.pictureRevision > baseline.picture;
  const parked = !budget.inBudget && fresh;
  const wasParkedRef = useRef(parked);
  const markBaseline = useEffectEvent((content: string | null) =>
    setBaseline({ content, picture: budget.pictureRevision ?? -1 }),
  );

  useOnirigiriPaneContentReady(budget.mounted && ready, contentRevision);

  // A layout effect records the baseline in the commit that publishes the
  // revision, before Onirigiri can take a picture of it.
  useLayoutEffect(() => {
    const revealing = wasParkedRef.current && !parked;
    wasParkedRef.current = parked;
    if (parked || !budget.mounted) return;
    if (!revealing) {
      markBaseline(contentRevision);
      return;
    }
    setReady(false);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        setReady(true);
        markBaseline(contentRevision);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
      setReady(true);
    };
  }, [parked, contentRevision, budget.mounted]);

  return { mounted: budget.mounted, parked };
}

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
  paneId,
  focused,
  onNavigateAway,
}: {
  thread: ThreadPaneThread;
  paneId: string;
  focused: boolean;
  onNavigateAway: (href: string) => void;
}) {
  const interactive = useOnirigiriPaneInteractive();
  const active = focused && interactive;
  const threadPath = `/${thread.environmentId}/${thread.threadId}`;
  const [router] = useState(() => createPaneRouter(threadPath));
  const [activity] = useState(() => createPaneActivity(active));
  const { mounted, parked } = usePaneParking(paneId, thread);

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
          <Activity mode={parked ? "hidden" : "visible"}>
            {mounted ? <PaneRouter router={router} /> : null}
          </Activity>
        </div>
      </ComposerHandleContext>
    </ChatViewActivityContext>
  );
});
