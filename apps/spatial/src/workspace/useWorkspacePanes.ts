import type { OnirigiriPaneDefinition } from "@riteofstring/onirigiri";
import { useAtomValue } from "@effect/atom-react";
import {
  reconcileWorkspaceLayout,
  type LiveWorkspace,
  type WorkspaceLayout,
} from "@riteofstring/onirigiri-t3";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useMemo, useState } from "react";

import { sortLogicalProjectsForSidebar } from "@t3tools/web/src/components/Sidebar.logic";
import { useClientSettings } from "@t3tools/web/src/hooks/useSettings";
import { environmentCatalog } from "@t3tools/web/src/connection/catalog";
import { isHostedStaticApp } from "@t3tools/web/src/hostedPairing";
import { getProjectOrderKey, selectProjectGroupingSettings } from "@t3tools/web/src/logicalProject";
import { orderItemsByPreferredIds } from "@t3tools/web/src/components/Sidebar.logic";
import { buildSidebarProjectSnapshots } from "@t3tools/web/src/sidebarProjectGrouping";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "@t3tools/web/src/state/entities";
import { usePrimaryEnvironmentId } from "@t3tools/web/src/state/environments";
import { legacyProjectCwdPreferenceKey, useUiStateStore } from "@t3tools/web/src/uiStateStore";

import type { ToolPane } from "./useToolPanes";

export interface ThreadPaneData {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

export type WorkspaceLayoutMode = "rows" | "strip";

export function threadPaneId(environmentId: string, threadId: string) {
  return `thread:${environmentId}:${threadId}`;
}

function scopedKey(environmentId: string, id: string) {
  return `${environmentId}:${id}`;
}

/** The sidebar's project groups, in the order the sidebar shows them. */
function useSidebarProjectGroups() {
  const projects = useProjects();
  const threads = useThreadShells();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const sortOrder = useClientSettings((settings) => settings.sidebarProjectSortOrder);
  const groupingSettings = useClientSettings(selectProjectGroupingSettings);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return useMemo(() => {
    const ordered =
      sortOrder === "manual"
        ? orderItemsByPreferredIds({
            items: projects,
            preferredIds: projectOrder,
            getId: getProjectOrderKey,
            getPreferenceIds: (project) => [
              getProjectOrderKey(project),
              legacyProjectCwdPreferenceKey(project.workspaceRoot),
            ],
          })
        : projects;
    const groups = buildSidebarProjectSnapshots({
      projects: ordered,
      settings: groupingSettings,
      primaryEnvironmentId,
      resolveEnvironmentLabel: () => null,
    });
    return sortLogicalProjectsForSidebar(groups, threads, sortOrder);
  }, [groupingSettings, primaryEnvironmentId, projectOrder, projects, sortOrder, threads]);
}

/**
 * The workspace's thread panes. Rows follow the sidebar's project groups;
 * the strip puts every thread on one plane in the same order. Each thread
 * update reconciles the previous arrangement, so panes keep their places,
 * threads new since then lead their project's row and archived ones leave.
 * Surface ids follow pane ids, so rebuilding the arrangement keeps the
 * pictures panes already have.
 */
export function useWorkspacePanes(
  layoutMode: WorkspaceLayoutMode,
  toolPanes: readonly ToolPane[],
  dismissedPaneIds: ReadonlySet<string>,
): readonly OnirigiriPaneDefinition[] | null {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const catalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const catalogRegistered = catalogReady && (isHostedStaticApp() || primaryEnvironmentId !== null);
  const threads = useThreadShells();
  const groups = useSidebarProjectGroups();

  const live = useMemo((): LiveWorkspace | null => {
    if (!bootstrapped || !catalogRegistered) return null;
    const groupByProject = new Map(
      groups.flatMap((group) =>
        group.memberProjectRefs.map(
          (ref) => [scopedKey(ref.environmentId, ref.projectId), group.projectKey] as const,
        ),
      ),
    );
    return {
      projects: groups.map((group) => ({ id: group.projectKey })),
      threads: threads
        .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .flatMap((thread) => {
          const projectId = groupByProject.get(scopedKey(thread.environmentId, thread.projectId));
          return projectId
            ? [
                {
                  id: scopedKey(thread.environmentId, thread.id),
                  projectId,
                  archived: thread.archivedAt !== null,
                },
              ]
            : [];
        }),
    };
  }, [bootstrapped, catalogRegistered, groups, threads]);

  // Compared by content: the sidebar inputs are rebuilt on unrelated renders.
  const liveKey = useMemo(() => (live ? JSON.stringify(live) : null), [live]);
  const [arrangement, setArrangement] = useState<{
    liveKey: string | null;
    layout: WorkspaceLayout | null;
  }>({ liveKey: null, layout: null });
  if (arrangement.liveKey !== liveKey) {
    setArrangement({
      liveKey,
      layout: live ? reconcileWorkspaceLayout(arrangement.layout ?? { rows: [] }, live) : null,
    });
  }

  return useMemo(() => {
    if (!arrangement.layout) return null;
    // Rows keep their panes' places but follow the sidebar's project order.
    const groupOrder = new Map(groups.map((group, index) => [group.projectKey, index]));
    const layout = {
      rows: arrangement.layout.rows.toSorted(
        (a, b) =>
          (groupOrder.get(a.projectId) ?? Infinity) - (groupOrder.get(b.projectId) ?? Infinity),
      ),
    };
    const threadByKey = new Map(
      threads.map((thread) => [scopedKey(thread.environmentId, thread.id), thread]),
    );
    const titleByGroup = new Map(groups.map((group) => [group.projectKey, group.displayName]));
    const toolPanesByThread = new Map<string, ToolPane[]>();
    for (const tool of toolPanes) {
      const key = scopedKey(tool.environmentId, tool.threadId);
      toolPanesByThread.set(key, [...(toolPanesByThread.get(key) ?? []), tool]);
    }
    const rows = layout.rows
      .filter((row) => row.panes.length > 0)
      .map((row) =>
        row.panes.flatMap((pane) => {
          const thread = threadByKey.get(pane.threadId);
          if (!thread) return [];
          const data: ThreadPaneData = { environmentId: thread.environmentId, threadId: thread.id };
          const paneId = threadPaneId(thread.environmentId, thread.id);
          const threadPane = {
            paneId,
            surfaceId: `surface:${paneId}`,
            surfaceKind: "thread",
            title: thread.title,
            subtitle: titleByGroup.get(row.projectId) ?? "",
            data,
          };
          const added = toolPanesByThread.get(pane.threadId) ?? [];
          return [
            ...(dismissedPaneIds.has(paneId) ? [] : [threadPane]),
            ...added.map((tool) => toolPaneDefinition(tool, thread.title)),
          ];
        }),
      )
      .filter((row) => row.length > 0);
    const planes = layoutMode === "strip" ? [rows.flat()] : rows;
    const panes = planes.flatMap((plane, planeIndex) =>
      plane.map((pane, slotIndex) => ({ ...pane, planeIndex, slotIndex })),
    );
    return panes;
  }, [arrangement.layout, dismissedPaneIds, groups, layoutMode, threads, toolPanes]);
}

const TOOL_TITLES: Record<ToolPane["kind"], string> = {
  diff: "Diff",
  empty: "New pane",
  terminal: "Terminal",
};

function toolPaneDefinition(tool: ToolPane, threadTitle: string) {
  return {
    paneId: tool.paneId,
    surfaceId: `surface:${tool.paneId}:${tool.kind}`,
    surfaceKind: tool.kind,
    title: TOOL_TITLES[tool.kind],
    subtitle: threadTitle,
    data: tool,
  };
}
