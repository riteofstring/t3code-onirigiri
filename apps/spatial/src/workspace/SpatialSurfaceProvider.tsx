import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { AppRouter } from "@t3tools/web/src/router";
import {
  setPageSurfaceNavigation,
  SurfaceNavigationContext,
} from "@t3tools/web/src/surfaceNavigation";
import { useSpatialSurfaceNavigation, type ToolPaneController } from "./SpatialSurfaceHost";
import { useToolPanes } from "./useToolPanes";

type WorkspaceNavigationTarget = {
  focusPane: (paneId: string) => void;
  isPaneClosing: (paneId: string) => boolean;
};

const SpatialControllerContext = createContext<{
  controller: ToolPaneController;
  bindWorkspace: (target: WorkspaceNavigationTarget | null) => void;
} | null>(null);

export function useSpatialController() {
  const value = useContext(SpatialControllerContext);
  if (!value) throw new Error("Spatial workspace requires its surface provider");
  return value;
}

export function SpatialSurfaceProvider({
  router,
  children,
}: {
  router: AppRouter;
  children: ReactNode;
}) {
  const controller = useToolPanes();
  const workspace = useRef<WorkspaceNavigationTarget | null>(null);
  const pendingFocus = useRef<{ paneId: string; ready: boolean } | null>(null);
  const bindWorkspace = useCallback((target: WorkspaceNavigationTarget | null) => {
    workspace.current = target;
    if (target && pendingFocus.current?.ready) {
      target.focusPane(pendingFocus.current.paneId);
      pendingFocus.current = null;
    }
  }, []);
  const { getPanes } = controller;
  const focusPane = useCallback(
    (paneId: string) => {
      const pane = getPanes().find((candidate) => candidate.paneId === paneId);
      if (!pane) return;
      const request = { paneId, ready: false };
      pendingFocus.current = request;
      void router
        .navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId: pane.environmentId, threadId: pane.threadId },
        })
        .then(() => {
          if (pendingFocus.current !== request) return;
          request.ready = true;
          if (!workspace.current) return;
          workspace.current.focusPane(paneId);
          pendingFocus.current = null;
        });
    },
    [getPanes, router],
  );
  const isPaneClosing = useCallback(
    (paneId: string) => workspace.current?.isPaneClosing(paneId) ?? false,
    [],
  );
  const navigation = useSpatialSurfaceNavigation(controller, "", focusPane, isPaneClosing);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- page-lifetime preview services read the workspace's navigation outside React
  useEffect(() => {
    setPageSurfaceNavigation(navigation);
    return () => setPageSurfaceNavigation(null);
  }, [navigation]);
  const value = useMemo(() => ({ controller, bindWorkspace }), [controller, bindWorkspace]);
  return (
    <SpatialControllerContext value={value}>
      <SurfaceNavigationContext value={navigation}>{children}</SurfaceNavigationContext>
    </SpatialControllerContext>
  );
}
