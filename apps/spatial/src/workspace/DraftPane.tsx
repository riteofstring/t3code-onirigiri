import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";

import { ChatPaneControlsContext } from "@t3tools/web/src/components/chatPaneControls";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

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
  maximized,
  onNavigateAway,
  onAddPane,
  onClosePane,
  onToggleMaximized,
}: {
  draftId: string;
  paneId: string;
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
  return (
    <ChatPaneControlsContext value={controls}>
      <div className="spatial-draft-pane h-full w-full" data-spatial-draft={draftId}>
        <RouterProvider router={router} />
      </div>
    </ChatPaneControlsContext>
  );
});
