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

import { DiffPane, TerminalPane } from "./SidePanes";
import { ThreadPane } from "./ThreadPane";

interface ThreadPaneData {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function threadPaneId(environmentId: string, threadId: string) {
  return `thread:${environmentId}:${threadId}`;
}

function readSpikeOptions() {
  const search = new URLSearchParams(window.location.search);
  return {
    liveContent: !search.has("frozen"),
    maxRows: Number(search.get("rows") ?? 3),
    maxThreadsPerRow: Number(search.get("perRow") ?? 4),
    sidesThreadId: search.get("sides"),
  };
}

function useThreadPanes(
  sidesThreadId: string | null,
  maxRows: number,
  maxThreadsPerRow: number,
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
    const panes = layout.rows
      .filter((row) => row.panes.length > 0)
      .slice(0, maxRows)
      .flatMap((row, planeIndex) =>
        row.panes
          .slice(0, maxThreadsPerRow)
          .flatMap((pane) => {
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
          })
          .map((pane, slotIndex) => ({ ...pane, planeIndex, slotIndex })),
      );
    return panes.length > 0 ? panes : null;
  }, [bootstrapped, projects, threads, sidesThreadId, maxRows, maxThreadsPerRow]);
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

function scopedKey(environmentId: string, id: string) {
  return `${environmentId}:${id}`;
}

export function SpatialWorkspace({ target }: { target: ThreadRouteTarget | null }) {
  const router = useRouter();
  const [options] = useState(readSpikeOptions);
  const threadPanes = useThreadPanes(
    options.sidesThreadId,
    options.maxRows,
    options.maxThreadsPerRow,
  );
  const [initialPanes, setInitialPanes] = useState(threadPanes);
  if (initialPanes === null && threadPanes !== null) setInitialPanes(threadPanes);
  const workspaceRef = useRef<OnirigiriWorkspaceHandle>(null);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(null);

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

  // The app route follows the focused thread so T3's global surfaces act on it.
  // Routes this workspace requested are remembered so they are not mistaken for
  // a navigation elsewhere in the app, which instead moves focus to its pane.
  const requestedRoutesRef = useRef(new Set<string>());
  useEffect(() => {
    const data = focusedPaneId ? paneData.get(focusedPaneId) : undefined;
    if (!focusedPaneId || !data || focusedPaneId === routePaneId) return;
    const frame = requestAnimationFrame(() => {
      requestedRoutesRef.current.add(focusedPaneId);
      void router.navigate({ to: "/$environmentId/$threadId", params: data });
    });
    return () => cancelAnimationFrame(frame);
  }, [focusedPaneId, paneData, routePaneId, router]);

  const focusRoutePane = useEffectEvent((paneId: string) => {
    if (requestedRoutesRef.current.delete(paneId)) return;
    if (paneData.has(paneId) && focusedPaneId !== paneId) workspaceRef.current?.focusPane(paneId);
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

  const trackFocusedPane = useCallback((frame: WorkspaceFocusedPaneFrame | null) => {
    if (frame) setFocusedPaneId(frame.paneId);
  }, []);

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
          active={state.focused && state.interactive}
          onNavigateAway={navigateAway}
        />
      );
    },
    [navigateAway],
  );

  return (
    <div className="spatial-workspace h-dvh w-full">
      {initialPanes ? (
        <OnirigiriWorkspace
          ref={workspaceRef}
          ariaLabel="Onirigiri for T3 Code"
          initialPanes={initialPanes}
          liveContent={options.liveContent}
          onFocusedPaneFrame={trackFocusedPane}
          renderPane={renderPane}
          shortcutScope="application"
          workspaceId="onirigiri-t3-spike"
        />
      ) : null}
    </div>
  );
}
