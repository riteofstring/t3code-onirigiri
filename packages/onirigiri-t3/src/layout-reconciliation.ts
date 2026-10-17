import type {
  LiveWorkspace,
  ProjectRow,
  WorkspaceLayout,
  WorkspacePane,
} from "./workspace-layout.js";

export function reconcileWorkspaceLayout(
  saved: WorkspaceLayout,
  live: LiveWorkspace,
): WorkspaceLayout {
  const savedPanes = savedPanesByLiveProject(saved, live);
  const threadIds = activeThreadIdsByProject(live);
  return {
    rows: [...savedPanes].map(([projectId, panes]) =>
      reconcileRow(projectId, panes, threadIds.get(projectId) ?? []),
    ),
  };
}

function savedPanesByLiveProject(
  saved: WorkspaceLayout,
  live: LiveWorkspace,
): Map<string, readonly WorkspacePane[]> {
  const liveProjectIds = new Set(live.projects.map((project) => project.id));
  const panesByProject = new Map<string, readonly WorkspacePane[]>();
  for (const row of saved.rows) {
    if (liveProjectIds.has(row.projectId) && !panesByProject.has(row.projectId)) {
      panesByProject.set(row.projectId, row.panes);
    }
  }
  for (const project of live.projects) {
    if (!panesByProject.has(project.id)) {
      panesByProject.set(project.id, []);
    }
  }
  return panesByProject;
}

function activeThreadIdsByProject(live: LiveWorkspace): Map<string, string[]> {
  const threadIds = new Map<string, string[]>();
  for (const thread of live.threads) {
    if (thread.archived) {
      continue;
    }
    const projectThreadIds = threadIds.get(thread.projectId) ?? [];
    projectThreadIds.push(thread.id);
    threadIds.set(thread.projectId, projectThreadIds);
  }
  return threadIds;
}

function reconcileRow(
  projectId: string,
  savedPanes: readonly WorkspacePane[],
  liveThreadIds: readonly string[],
): ProjectRow {
  const remaining = new Set(liveThreadIds);
  const kept: WorkspacePane[] = [];
  for (const pane of savedPanes) {
    if (remaining.delete(pane.threadId)) {
      kept.push(pane);
    }
  }
  const added = [...remaining].map((threadId) => ({ threadId }));
  return { projectId, panes: [...added, ...kept] };
}
