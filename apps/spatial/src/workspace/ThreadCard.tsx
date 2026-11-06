import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";

import { ProjectFavicon } from "@t3tools/web/src/components/ProjectFavicon";
import { Spinner } from "@t3tools/web/src/components/ui/spinner";
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

export function PaneLoading() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-muted-foreground">
      <Spinner size="lg" />
    </div>
  );
}

export function ThreadCard({
  environmentId,
  threadId,
  loading = false,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  loading?: boolean;
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
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-background p-8 text-center text-foreground">
      {project ? (
        <ProjectFavicon project={project} className="size-12! [&_svg]:size-full!" />
      ) : null}
      <div className="flex max-w-sm flex-col items-center gap-1.5">
        {project ? <div className="text-xs text-muted-foreground">{project.title}</div> : null}
        <div className="line-clamp-3 text-lg font-medium leading-snug text-balance">
          {thread.title}
        </div>
      </div>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {statusLabel ? <span>{statusLabel}</span> : null}
        {thread.branch ? <span>{thread.branch}</span> : null}
        <span>Updated {new Date(thread.updatedAt).toLocaleString()}</span>
      </div>
      {loading ? <Spinner size="lg" className="text-muted-foreground" /> : null}
    </div>
  );
}
