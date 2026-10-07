import {
  OnirigiriWorkspace,
  createWorkspaceScene,
  defaultOnirigiriShortcuts,
  type OnirigiriShortcutBindings,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { PaneLifecycleContext, createPaneLifecycleStore, type PanePosition } from "./paneLifecycle";
import { DiffPane, TerminalPane } from "./SidePanes";
import { ThreadCard } from "./ThreadCard";
import { ThreadPane } from "./ThreadPane";
import {
  threadPaneId,
  useWorkspacePanes,
  type ThreadPaneData,
  type WorkspaceLayoutMode,
} from "./useWorkspacePanes";

const WORKSPACE_ID = "onirigiri-t3";

// A thread's composer usually holds focus, so moving between panes and
// overview also answer to Control+Alt chords, which never edit text.
function whileEditing(key: string) {
  return { altKey: true, ctrlKey: true, key, metaKey: false, shiftKey: false, whileEditing: true };
}
const SHORTCUTS: OnirigiriShortcutBindings = {
  focusDown: [...defaultOnirigiriShortcuts.focusDown, whileEditing("ArrowDown")],
  focusLeft: [...defaultOnirigiriShortcuts.focusLeft, whileEditing("ArrowLeft")],
  focusRight: [...defaultOnirigiriShortcuts.focusRight, whileEditing("ArrowRight")],
  focusUp: [...defaultOnirigiriShortcuts.focusUp, whileEditing("ArrowUp")],
  toggleOverview: [...defaultOnirigiriShortcuts.toggleOverview, whileEditing("o")],
};
/** Quiet time after a focus change before the app route follows it. */
const ROUTE_SETTLE_MS = 150;

function readWorkspaceOptions() {
  const search = new URLSearchParams(window.location.search);
  return {
    layout: (search.get("layout") === "strip" ? "strip" : "rows") as WorkspaceLayoutMode,
    sidesThreadId: search.get("sides"),
  };
}

function threadPanePositions(panes: readonly OnirigiriPaneDefinition[]): PanePosition[] {
  return panes
    .filter((pane) => pane.surfaceKind === "thread")
    .map((pane) => ({
      paneId: pane.paneId,
      plane: pane.planeIndex ?? 0,
      slot: pane.slotIndex ?? 0,
    }));
}

function paneMembership(panes: readonly OnirigiriPaneDefinition[]) {
  return panes.map((pane) => `${pane.paneId}@${pane.planeIndex}:${pane.slotIndex}`).join("|");
}

export function SpatialWorkspace({
  target,
  active,
}: {
  target: ThreadRouteTarget | null;
  /** False while a draft or another route covers the workspace. */
  active: boolean;
}) {
  const router = useRouter();
  const [{ layout: layoutMode, sidesThreadId }] = useState(readWorkspaceOptions);
  const panes = useWorkspacePanes(layoutMode, sidesThreadId);
  const [initialPanes, setInitialPanes] = useState(panes);
  if (initialPanes === null && panes !== null) setInitialPanes(panes);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  // Focus is kept out of React state so moving between panes does not
  // re-render the workspace.
  const focusedPaneIdRef = useRef<string | null>(null);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of panes ?? []) {
      if (pane.surfaceKind === "thread") byPaneId.set(pane.paneId, pane.data as ThreadPaneData);
    }
    return byPaneId;
  }, [panes]);
  const panesRef = useRef(panes);
  const activeRef = useRef(active);

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : null;

  const [lifecycle, setLifecycle] = useState<ReturnType<typeof createPaneLifecycleStore> | null>(
    null,
  );
  if (lifecycle === null && initialPanes !== null) {
    setLifecycle(createPaneLifecycleStore(threadPanePositions(initialPanes), routePaneId));
  }

  // Threads appearing, leaving or moving rebuild the arrangement around the
  // focused pane; renames only retitle their panes.
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!panes || !workspace) return;
    const previous = panesRef.current;
    panesRef.current = panes;
    if (!previous || previous === panes) return;
    if (paneMembership(panes) !== paneMembership(previous)) {
      const { scene } = createWorkspaceScene({
        gridAxes: layoutMode === "strip" ? "horizontal" : "spatial",
        id: WORKSPACE_ID,
        panes,
      });
      const focused =
        panes.find((pane) => pane.paneId === focusedPaneIdRef.current) ??
        panes.find((pane) => pane.surfaceKind === "thread");
      workspace.restoreLayout(
        serializeWorkspaceLayout(scene, {
          column: focused?.slotIndex ?? 0,
          row: focused?.planeIndex ?? 0,
          split: 0,
        }),
      );
      return;
    }
    const previousTitles = new Map(previous.map((pane) => [pane.paneId, pane.title]));
    for (const pane of panes) {
      if (pane.title && previousTitles.get(pane.paneId) !== pane.title) {
        workspace.renamePane(pane.paneId, pane.title);
      }
    }
  }, [layoutMode, panes]);

  useEffect(() => () => lifecycle?.dispose(), [lifecycle]);
  useEffect(() => {
    if (panes && lifecycle) {
      lifecycle.setPanes(threadPanePositions(panes));
    }
  }, [lifecycle, panes]);

  // The app route follows the focused thread once the camera rests, so T3's
  // global surfaces act on it. Routes this workspace requested are remembered
  // so they are not mistaken for a navigation elsewhere in the app, which
  // instead moves focus to its pane.
  const requestedRoutesRef = useRef(new Set<string>());
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routePaneIdRef = useRef(routePaneId);
  // A route change made elsewhere, or covering the workspace, supersedes a
  // pending follow of the camera.
  useEffect(() => {
    routePaneIdRef.current = routePaneId;
    activeRef.current = active;
    if (routeTimerRef.current !== null) {
      clearTimeout(routeTimerRef.current);
      routeTimerRef.current = null;
    }
  }, [routePaneId, active]);
  useEffect(
    () => () => {
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
    },
    [],
  );

  const onFocusedPaneFrame = useCallback(
    (frame: WorkspaceFocusedPaneFrame | null) => {
      if (!frame || frame.paneId === focusedPaneIdRef.current || !activeRef.current) return;
      const data = paneData.get(frame.paneId);
      if (!data) return;
      const paneId = frame.paneId;
      focusedPaneIdRef.current = paneId;
      lifecycle?.setFocus(paneId);
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
      routeTimerRef.current = setTimeout(() => {
        routeTimerRef.current = null;
        if (paneId === routePaneIdRef.current || focusedPaneIdRef.current !== paneId) return;
        requestedRoutesRef.current.add(paneId);
        void router.navigate({ to: "/$environmentId/$threadId", params: data });
      }, ROUTE_SETTLE_MS);
    },
    [lifecycle, paneData, router],
  );

  // A route the workspace did not request (the sidebar, a notification, a new
  // thread) moves focus to its pane, leaving overview. A thread whose pane is
  // not in the workspace yet is focused once reconciliation adds it.
  const pendingRoutePaneRef = useRef<string | null>(null);
  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    if (!paneData.has(paneId)) {
      pendingRoutePaneRef.current = paneId;
      return;
    }
    pendingRoutePaneRef.current = null;
    if (focusedPaneIdRef.current !== paneId) {
      workspaceRef.current?.focusPane(paneId, { exitOverview: true });
    }
  });

  useEffect(() => {
    if (routePaneId) focusRoutePane(routePaneId);
  }, [routePaneId]);

  useEffect(() => {
    const pending = pendingRoutePaneRef.current;
    if (pending && paneData.has(pending)) focusRoutePane(pending);
  }, [paneData]);

  const navigateAway = useCallback(
    (href: string) => {
      void router.navigate({ href });
    },
    [router],
  );

  const renderPane = useCallback(
    (pane: WorkspacePane, state: OnirigiriPaneRenderState) => {
      if (pane.surfaceKind === "terminal") {
        const data = pane.data as ThreadPaneData & { terminalId: string };
        return (
          <TerminalPane
            thread={data}
            terminalId={data.terminalId}
            focused={state.focused}
            live={state.runtimeState === "live"}
          />
        );
      }
      if (pane.surfaceKind === "diff") return <DiffPane thread={pane.data as ThreadPaneData} />;
      return (
        <ThreadPane
          thread={pane.data as ThreadPaneData}
          focused={state.focused}
          visible={state.visible}
          paneId={pane.paneId}
          onNavigateAway={navigateAway}
        />
      );
    },
    [navigateAway],
  );

  const renderPanePlaceholder = useCallback((pane: WorkspacePane) => {
    if (pane.surfaceKind !== "thread") return null;
    const data = pane.data as ThreadPaneData;
    return <ThreadCard environmentId={data.environmentId} threadId={data.threadId} />;
  }, []);

  return (
    <div className="spatial-workspace h-full w-full">
      {initialPanes && lifecycle ? (
        <PaneLifecycleContext value={lifecycle}>
          <OnirigiriWorkspace
            ref={workspaceRef}
            ariaLabel="Onirigiri for T3 Code"
            cursorRunway={0}
            cursorTargets="panes"
            gridAxes={layoutMode === "strip" ? "horizontal" : "spatial"}
            initialPanes={initialPanes}
            liveContent
            onFocusedPaneFrame={onFocusedPaneFrame}
            renderPane={renderPane}
            renderPanePlaceholder={renderPanePlaceholder}
            shortcutScope={active ? "application" : "workspace"}
            shortcuts={SHORTCUTS}
            workspaceId={WORKSPACE_ID}
          />
        </PaneLifecycleContext>
      ) : null}
    </div>
  );
}
