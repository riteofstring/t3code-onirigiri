import {
  OnirigiriWorkspace,
  type OnirigiriPaneDefinition,
  type OnirigiriPaneRenderState,
  type OnirigiriWorkspaceHandle,
  type WorkspaceFocusedPaneFrame,
  type WorkspacePane,
} from "@riteofstring/onirigiri";
import "@riteofstring/onirigiri/styles.css";
import { reconcileWorkspaceLayout } from "@riteofstring/onirigiri-t3";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "@t3tools/web/src/state/entities";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { PaneLifecycleContext, createPaneLifecycleStore } from "./paneLifecycle";
import { DiffPane, TerminalPane } from "./SidePanes";
import { ThreadCard } from "./ThreadCard";
import { ThreadPane } from "./ThreadPane";

interface ThreadPaneData {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function threadPaneId(environmentId: string, threadId: string) {
  return `thread:${environmentId}:${threadId}`;
}

type WorkspaceLayoutMode = "rows" | "strip";

function readWorkspaceOptions() {
  const search = new URLSearchParams(window.location.search);
  return {
    layout: (search.get("layout") === "strip" ? "strip" : "rows") as WorkspaceLayoutMode,
    sidesThreadId: search.get("sides"),
  };
}

/** Quiet time after a focus change before the app route follows it. */
const ROUTE_SETTLE_MS = 150;

// Rows: one plane per project. Strip: every thread on one plane, in the same
// project order.
function useThreadPanes(
  sidesThreadId: string | null,
  layoutMode: WorkspaceLayoutMode,
): readonly OnirigiriPaneDefinition[] | null {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const projects = useProjects();
  const threads = useThreadShells();

  return useMemo(() => {
    if (!bootstrapped) return null;
    const projectById = new Map(
      projects.map((project) => [scopedKey(project.environmentId, project.id), project]),
    );
    const threadById = new Map(
      threads.map((thread) => [scopedKey(thread.environmentId, thread.id), thread]),
    );
    const recentThreads = threads.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const layout = reconcileWorkspaceLayout(
      { rows: [] },
      {
        projects: [
          ...new Set([
            ...recentThreads.map((thread) => scopedKey(thread.environmentId, thread.projectId)),
            ...projectById.keys(),
          ]),
        ]
          .filter((id) => projectById.has(id))
          .map((id) => ({ id })),
        threads: recentThreads.map((thread) => ({
          id: scopedKey(thread.environmentId, thread.id),
          projectId: scopedKey(thread.environmentId, thread.projectId),
          archived: thread.archivedAt !== null,
        })),
      },
    );
    const rows = layout.rows
      .filter((row) => row.panes.length > 0)
      .map((row) =>
        row.panes.flatMap((pane) => {
          const thread = threadById.get(pane.threadId);
          if (!thread) return [];
          const data = { environmentId: thread.environmentId, threadId: thread.id };
          const threadPane = {
            paneId: threadPaneId(thread.environmentId, thread.id),
            surfaceKind: "thread",
            title: thread.title,
            subtitle: projectById.get(row.projectId)?.title ?? "",
            data,
          };
          return thread.id === sidesThreadId
            ? [threadPane, ...sidePaneDefinitions(threadPane.paneId, data)]
            : [threadPane];
        }),
      );
    const planes = layoutMode === "strip" ? [rows.flat()] : rows;
    const panes = planes.flatMap((plane, planeIndex) =>
      plane.map((pane, slotIndex) => ({ ...pane, planeIndex, slotIndex })),
    );
    return panes.length > 0 ? panes : null;
  }, [bootstrapped, projects, threads, sidesThreadId, layoutMode]);
}

function sidePaneDefinitions(threadPaneId: string, thread: ThreadPaneData) {
  return [
    ...["spatial-a", "spatial-b"].map((terminalId) => ({
      paneId: `${threadPaneId}:terminal:${terminalId}`,
      surfaceKind: "terminal",
      title: `Terminal ${terminalId}`,
      subtitle: "",
      data: { ...thread, terminalId },
    })),
    {
      paneId: `${threadPaneId}:diff`,
      surfaceKind: "diff",
      title: "Diff",
      subtitle: "",
      data: thread,
    },
  ];
}

// Thread panes nearest the focused one first.
function threadPanesByDistance(
  panes: readonly OnirigiriPaneDefinition[],
  focusedPaneId: string | null,
): readonly string[] {
  const threads = panes.filter((pane) => pane.surfaceKind === "thread");
  const focused = threads.find((pane) => pane.paneId === focusedPaneId) ?? threads[0];
  if (!focused) return [];
  const distance = (pane: OnirigiriPaneDefinition) => [
    Math.abs((pane.planeIndex ?? 0) - (focused.planeIndex ?? 0)) +
      Math.abs((pane.slotIndex ?? 0) - (focused.slotIndex ?? 0)),
    Math.abs((pane.planeIndex ?? 0) - (focused.planeIndex ?? 0)),
  ];
  return threads
    .map((pane) => ({ paneId: pane.paneId, key: distance(pane) }))
    .toSorted((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]!)
    .map((pane) => pane.paneId);
}

function scopedKey(environmentId: string, id: string) {
  return `${environmentId}:${id}`;
}

export function SpatialWorkspace({ target }: { target: ThreadRouteTarget | null }) {
  const router = useRouter();
  const [options] = useState(readWorkspaceOptions);
  const threadPanes = useThreadPanes(options.sidesThreadId, options.layout);
  const [initialPanes, setInitialPanes] = useState(threadPanes);
  if (initialPanes === null && threadPanes !== null) setInitialPanes(threadPanes);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  // Focus is kept out of React state so moving between panes does not
  // re-render the workspace.
  const focusedPaneIdRef = useRef<string | null>(null);

  const paneData = useMemo(() => {
    const byPaneId = new Map<string, ThreadPaneData>();
    for (const pane of initialPanes ?? []) {
      if (pane.surfaceKind === "thread") byPaneId.set(pane.paneId, pane.data as ThreadPaneData);
    }
    return byPaneId;
  }, [initialPanes]);

  const routePaneId =
    target?.kind === "server"
      ? threadPaneId(target.threadRef.environmentId, target.threadRef.threadId)
      : null;

  const [lifecycle, setLifecycle] = useState<ReturnType<typeof createPaneLifecycleStore> | null>(
    null,
  );
  if (lifecycle === null && initialPanes !== null) {
    setLifecycle(
      createPaneLifecycleStore(threadPanesByDistance(initialPanes, routePaneId), routePaneId),
    );
  }

  // The app route follows the focused thread once the camera rests, so T3's
  // global surfaces act on it. Routes this workspace requested are remembered
  // so they are not mistaken for a navigation elsewhere in the app, which
  // instead moves focus to its pane.
  const requestedRoutesRef = useRef(new Set<string>());
  const routeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routePaneIdRef = useRef(routePaneId);
  useEffect(() => {
    routePaneIdRef.current = routePaneId;
  }, [routePaneId]);
  useEffect(
    () => () => {
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
    },
    [],
  );

  const onFocusedPaneFrame = useCallback(
    (frame: WorkspaceFocusedPaneFrame | null) => {
      if (!frame || frame.paneId === focusedPaneIdRef.current) return;
      const data = paneData.get(frame.paneId);
      if (!data) return;
      const paneId = frame.paneId;
      focusedPaneIdRef.current = paneId;
      lifecycle?.setFocus(threadPanesByDistance(initialPanes ?? [], paneId), paneId);
      if (routeTimerRef.current !== null) clearTimeout(routeTimerRef.current);
      routeTimerRef.current = setTimeout(() => {
        routeTimerRef.current = null;
        if (paneId === routePaneIdRef.current || focusedPaneIdRef.current !== paneId) return;
        requestedRoutesRef.current.add(paneId);
        void router.navigate({ to: "/$environmentId/$threadId", params: data });
      }, ROUTE_SETTLE_MS);
    },
    [initialPanes, lifecycle, paneData, router],
  );

  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    if (paneData.has(paneId) && focusedPaneIdRef.current !== paneId) {
      workspaceRef.current?.focusPane(paneId);
    }
  });

  useEffect(() => {
    if (routePaneId) focusRoutePane(routePaneId);
  }, [routePaneId]);

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
            gridAxes={options.layout === "strip" ? "horizontal" : "spatial"}
            initialPanes={initialPanes}
            liveContent
            onFocusedPaneFrame={onFocusedPaneFrame}
            renderPane={renderPane}
            renderPanePlaceholder={renderPanePlaceholder}
            shortcutScope="application"
            workspaceId="onirigiri-t3"
          />
        </PaneLifecycleContext>
      ) : null}
    </div>
  );
}
