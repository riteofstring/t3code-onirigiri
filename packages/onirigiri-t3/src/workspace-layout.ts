export interface WorkspacePane {
  readonly threadId: string;
}

export interface ProjectRow {
  readonly projectId: string;
  readonly panes: readonly WorkspacePane[];
}

export interface WorkspaceLayout {
  readonly rows: readonly ProjectRow[];
}

export interface LiveThread {
  readonly id: string;
  readonly projectId: string;
  readonly archived: boolean;
}

export interface LiveWorkspace {
  readonly projects: readonly { readonly id: string }[];
  readonly threads: readonly LiveThread[];
}
