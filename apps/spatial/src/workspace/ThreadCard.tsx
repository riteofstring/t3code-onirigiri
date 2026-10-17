import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { useProject, useThreadShell } from "@t3tools/web/src/state/entities";

const RUN_STATUS_LABEL: Record<ThreadRuntimeSummary["status"], string> = {
  preparing: "Preparing",
  queued: "Queued",
  starting: "Starting",
  running: "Working",
  waiting: "Working",
  idle: "Waiting",
  completed: "Completed",
  interrupted: "Interrupted",
  failed: "Error",
  cancelled: "Cancelled",
  rolled_back: "Rolled back",
};

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
  const runStatus = thread.runtime?.status ?? thread.latestRun?.status;
  const statusLabel =
    thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval"
      ? "Pending approval"
      : thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input"
        ? "Awaiting input"
        : runStatus
          ? RUN_STATUS_LABEL[runStatus]
          : null;
  return (
    <div className="flex h-full w-full flex-col gap-3 bg-background p-6 text-foreground">
      <div className="text-xs text-muted-foreground">{project?.title ?? ""}</div>
      <div className="text-lg font-medium leading-snug">{thread.title}</div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {statusLabel ? <span>{statusLabel}</span> : null}
        {thread.branch ? <span>{thread.branch}</span> : null}
        <span>Updated {new Date(thread.updatedAt).toLocaleString()}</span>
      </div>
    </div>
  );
}
