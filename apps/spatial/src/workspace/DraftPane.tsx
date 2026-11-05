import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { useOnirigiriPaneInteractive } from "@riteofstring/onirigiri";
import { memo, use, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { ChatPaneControlsContext } from "@t3tools/web/src/components/chatPaneControls";
import { ChatViewActivityContext } from "@t3tools/web/src/components/chatViewActivity";
import { ComposerHandleContext } from "@t3tools/web/src/composerHandleContext";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { usePaneActivity } from "./paneActivity";
import { PaneLifecycleContext } from "./paneLifecycle";
import { SpatialWorkspaceActiveContext, usePaneComposerHandle } from "./ThreadPane";

function DraftRoute() {
  const target = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return target ? <ThreadRouteView target={target} /> : null;
}

const draftRootRoute = createRootRoute({ component: Outlet });
const draftRouteTree = draftRootRoute.addChildren([
  createRoute({ getParentRoute: () => draftRootRoute, path: "draft/$draftId", component: DraftRoute }),
]);

export const DraftPane = memo(function DraftPane({
  draftId,
  paneId,
  focused,
  maximized,
  onNavigateAway,
  onAddPane,
  onClosePane,
  onToggleMaximized,
}: {
  draftId: string;
  paneId: string;
  focused: boolean;
  maximized: boolean;
  onNavigateAway: (href: string) => void;
  onAddPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onToggleMaximized: (paneId: string) => void;
}) {
  const draftPath = `/draft/${encodeURIComponent(draftId)}`;
  const [router] = useState(() =>
    createRouter({
      routeTree: draftRouteTree,
      history: createMemoryHistory({ initialEntries: [draftPath] }),
    }),
  );
  useEffect(
    () =>
      router.history.subscribe(({ location }) => {
        if (location.pathname === draftPath) return;
        onNavigateAway(location.href);
        router.history.replace(draftPath);
      }),
    [draftPath, onNavigateAway, router],
  );
  const controls = useMemo(
    () => ({
      maximized,
      addPane: () => onAddPane(paneId),
      closePane: () => onClosePane(paneId),
      toggleMaximized: () => onToggleMaximized(paneId),
    }),
    [maximized, onAddPane, onClosePane, onToggleMaximized, paneId],
  );
  const lifecycle = use(PaneLifecycleContext);
  const cameraMoving = useSyncExternalStore(
    lifecycle?.subscribeMotion ?? (() => () => {}),
    lifecycle?.isCameraMoving ?? (() => false),
  );
  const interactive = useOnirigiriPaneInteractive();
  const liveVisible = use(SpatialWorkspaceActiveContext) && interactive;
  const active = focused && liveVisible && !cameraMoving;
  const contentRef = useRef<HTMLDivElement>(null);
  const activity = usePaneActivity(active, liveVisible, contentRef);
  const composerRef = usePaneComposerHandle(active);
  return (
    <ChatPaneControlsContext value={controls}>
      <ChatViewActivityContext value={activity}>
        <ComposerHandleContext value={composerRef}>
          <div
            ref={contentRef}
            className="spatial-draft-pane h-full w-full"
            data-spatial-draft={draftId}
          >
            <RouterProvider router={router} />
          </div>
        </ComposerHandleContext>
      </ChatViewActivityContext>
    </ChatPaneControlsContext>
  );
});
