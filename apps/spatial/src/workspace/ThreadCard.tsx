import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useProject, useThreadShell } from "@t3tools/web/src/state/entities";

const TURN_STATE_LABEL: Record<string, string> = {
  running: "Working",
  completed: "Completed",
  interrupted: "Interrupted",
  error: "Error",
};

/**
 * Stands in for a thread pane whose view is not mounted and has no picture of
 * its current content. Everything it shows comes from the thread's shell, so
 * it is never stale.
 */
export function ThreadCard({
  environmentId,
  threadId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
}) {
  const thread = useThreadShell({ environmentId, threadId });
  const project = useProject(thread ? { environmentId, projectId: thread.projectId } : null);
  if (!thread) return null;
  const turnState = thread.latestTurn ? TURN_STATE_LABEL[thread.latestTurn.state] : null;
  return (
    <div className="flex h-full w-full flex-col gap-3 bg-background p-6 text-foreground">
      <div className="text-xs text-muted-foreground">{project?.title ?? ""}</div>
      <div className="text-lg font-medium leading-snug">{thread.title}</div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {turnState ? <span>{turnState}</span> : null}
        {thread.branch ? <span>{thread.branch}</span> : null}
        <span>Updated {new Date(thread.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
