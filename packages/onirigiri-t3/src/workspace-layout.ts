export interface ThreadPane {
  readonly kind: "thread";
  readonly threadId: string;
}

export type WorkspacePane = ThreadPane;

export interface ProjectRow {
  readonly projectId: string;
  readonly panes: readonly WorkspacePane[];
}

export interface WorkspaceLayout {
  readonly rows: readonly ProjectRow[];
}

export interface LiveProject {
  readonly id: string;
}

export interface LiveThread {
  readonly id: string;
  readonly projectId: string;
  readonly archived: boolean;
}

export interface LiveWorkspace {
  readonly projects: readonly LiveProject[];
  readonly threads: readonly LiveThread[];
}
