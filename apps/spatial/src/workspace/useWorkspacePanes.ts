import type { OnirigiriPaneDefinition } from "@riteofstring/onirigiri";
import { useAtomValue } from "@effect/atom-react";
import {
  reconcileWorkspaceLayout,
  type LiveWorkspace,
  type WorkspaceLayout,
} from "@riteofstring/onirigiri-t3";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { DraftId } from "@t3tools/web/src/composerDraftStore";
import { useMemo, useState } from "react";

import { sortLogicalProjectsForSidebar } from "@t3tools/web/src/components/Sidebar.logic";
import { useClientSettings } from "@t3tools/web/src/hooks/useSettings";
import { environmentCatalog } from "@t3tools/web/src/connection/catalog";
import { isHostedStaticApp } from "@t3tools/web/src/hostedPairing";
import { isLocalEnvironmentDisabled } from "@t3tools/web/src/localEnvironment";
import {
  getProjectOrderKey,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
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

export interface WorkspaceDraft {
  readonly draftId: DraftId;
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
  readonly threadId: ThreadId;
}

export type WorkspaceLayoutMode = "rows" | "strip";

export function draftPaneId(draft: { environmentId: string; threadId: string }) {
  return threadPaneId(draft.environmentId, draft.threadId);
}

export function threadPaneId(environmentId: string, threadId: string) {
  return `thread:${environmentId}:${threadId}`;
}

function scopedKey(environmentId: string, id: string) {
  return `${environmentId}:${id}`;
}

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

export function useWorkspacePanes(
  layoutMode: WorkspaceLayoutMode,
  toolPanes: readonly ToolPane[],
  dismissedPaneIds: ReadonlySet<string>,
  drafts: readonly WorkspaceDraft[] = [],
): readonly OnirigiriPaneDefinition[] | null {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const catalogReady = useAtomValue(environmentCatalog.catalogValueAtom).isReady;
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const [localEnvironmentDisabled] = useState(isLocalEnvironmentDisabled);
  const catalogRegistered =
    catalogReady &&
    (isHostedStaticApp() || localEnvironmentDisabled || primaryEnvironmentId !== null);
  const threads = useThreadShells();
  const projects = useProjects();
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
    const titleByProject = new Map(
      projects.map((project) => [scopedKey(project.environmentId, project.id), project.title]),
    );
    const toolPanesByThread = new Map<string, ToolPane[]>();
    for (const tool of toolPanes) {
      const key = scopedKey(tool.environmentId, tool.threadId);
      toolPanesByThread.set(key, [...(toolPanesByThread.get(key) ?? []), tool]);
    }
    const draftPanes = new Map<string, OnirigiriPaneDefinition[]>();
    const draftPaneIds = new Set(drafts.map((draft) => draftPaneId(draft)));
    for (const draft of drafts) {
      const projectKey =
        groups.find((group) =>
          group.memberProjectRefs.some(
            (ref) => ref.environmentId === draft.environmentId && ref.projectId === draft.projectId,
          ),
        )?.projectKey ?? `draft-project:${draft.environmentId}:${draft.projectId}`;
      const paneId = draftPaneId(draft);
      draftPanes.set(projectKey, [
        ...(draftPanes.get(projectKey) ?? []),
        {
          paneId,
          surfaceId: `surface:${paneId}`,
          surfaceKind: "draft",
          title: "New thread",
          subtitle: titleByGroup.get(projectKey) ?? "",
          data: draft,
        },
      ]);
    }
    const rowProjects = new Set(layout.rows.map((row) => row.projectId));
    const rows = [
      ...layout.rows,
      ...[...draftPanes.keys()]
        .filter((projectId) => !rowProjects.has(projectId))
        .map((projectId) => ({ projectId, panes: [] })),
    ]
      .map((row) => [
        ...(draftPanes.get(row.projectId) ?? []),
        ...row.panes.flatMap((pane) => {
          const thread = threadByKey.get(pane.threadId);
          if (!thread) return [];
          const data: ThreadPaneData = { environmentId: thread.environmentId, threadId: thread.id };
          const paneId = threadPaneId(thread.environmentId, thread.id);
          if (draftPaneIds.has(paneId)) return [];
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
            ...added.map((tool) =>
              toolPaneDefinition(
                tool,
                tool.kind !== "empty"
                  ? thread.title
                  : (titleByProject.get(
                      scopedKey(tool.environmentId, tool.projectId ?? thread.projectId),
                    ) ??
                      titleByGroup.get(row.projectId) ??
                      ""),
              ),
            ),
          ];
        }),
      ])
      .filter((row) => row.length > 0);
    const planes = layoutMode === "strip" ? [rows.flat()] : rows;
    const panes = planes.flatMap((plane, planeIndex) =>
      plane.map((pane, slotIndex) => ({ ...pane, planeIndex, slotIndex })),
    );
    return panes;
  }, [
    arrangement.layout,
    dismissedPaneIds,
    drafts,
    groups,
    layoutMode,
    projects,
    threads,
    toolPanes,
  ]);
}

const TOOL_TITLES: Record<ToolPane["kind"], string> = {
  diff: "Diff",
  empty: "New pane",
  terminal: "Terminal",
  surface: "Pane",
};

function toolPaneDefinition(tool: ToolPane, subtitle: string) {
  return {
    paneId: tool.paneId,
    surfaceId: `surface:${tool.paneId}:${tool.kind}`,
    surfaceKind: tool.kind,
    title:
      tool.kind === "surface" && tool.surface
        ? toolSurfaceTitle(tool.surface)
        : TOOL_TITLES[tool.kind],
    subtitle,
    data: tool,
  };
}

function toolSurfaceTitle(surface: NonNullable<ToolPane["surface"]>): string {
  switch (surface.kind) {
    case "preview":
      return "Browser";
    case "terminal":
      return "Terminal";
    case "diff":
      return "Diff";
    case "files":
      return "Files";
    case "file":
      return surface.relativePath.split("/").at(-1) ?? surface.relativePath;
    case "pull-request":
      return `Pull request #${surface.number}`;
    case "pull-requests":
      return "Linked pull requests";
    case "lineage":
      return "Lineage";
    case "side-chat":
      return "Side chat";
    case "device":
      return surface.title ?? surface.target?.name ?? "Device";
  }
}
