import { useState } from "react";

import { useComposerDraftStore } from "@t3tools/web/src/composerDraftStore";
import { isLatestRunSettled } from "@t3tools/web/src/session-logic";
import { useThreadShell } from "@t3tools/web/src/state/entities";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { threadPaneId } from "./useWorkspacePanes";

/**
 * The thread a draft shown here was promoted to, while T3's draft view still
 * carries it. That view keeps its ChatView through the promotion, so the first
 * response streams without a remount. Once the turn has settled and the draft
 * record is gone, or the route moves on, the workspace takes the thread over.
 */
export function useCarriedThread(target: ThreadRouteTarget | null): string | null {
  const draftId = target?.kind === "draft" ? target.draftId : null;
  const threadRef = target?.kind === "server" ? target.threadRef : null;
  const promotedFrom = useComposerDraftStore((store) =>
    threadRef ? store.getDraftIdByRef(threadRef) : null,
  );
  const shell = useThreadShell(threadRef);
  const settled = shell ? isLatestRunSettled(shell.latestRun, shell.runtime) : false;
  const [lastDraftId, setLastDraftId] = useState<string | null>(null);
  if (draftId !== null && draftId !== lastDraftId) setLastDraftId(draftId);
  const [carried, setCarried] = useState<string | null>(null);
  const threadKey = threadRef ? threadPaneId(threadRef.environmentId, threadRef.threadId) : null;
  let next = carried;
  if (threadKey === null) next = null;
  else if (carried !== threadKey) {
    next = promotedFrom !== null && promotedFrom === lastDraftId ? threadKey : null;
  } else if (settled && promotedFrom === null) next = null;
  if (next !== carried) setCarried(next);
  // Only the route that follows the draft can carry it.
  if (threadKey !== null && next === null && lastDraftId !== null) setLastDraftId(null);
  return next;
}
