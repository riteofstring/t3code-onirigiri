import { useEffect, useRef } from "react";
import type { OrchestrationV2ProjectedTurnItem } from "@t3tools/contracts";

/**
 * The latest settled item after which files on disk may have changed.
 * File tools are explicit; completed commands are included because a shell
 * command can mutate the workspace without reporting the paths it touched.
 */
export function latestWorkspaceMutationId(
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  checkpointCompletedAt: string | null,
): string | null {
  const item = items.findLast(
    ({ item }) =>
      (item.type === "command_execution" || item.type === "file_change") &&
      item.status !== "pending" &&
      item.status !== "running" &&
      item.status !== "waiting",
  )?.item;
  return item === undefined && checkpointCompletedAt === null
    ? null
    : JSON.stringify([item?.id ?? null, checkpointCompletedAt]);
}

function workspaceMutationRefreshToken(
  resourceKey: string,
  mutationId: string | null,
): string | null {
  return mutationId === null ? null : `${resourceKey}\u0000${mutationId}`;
}

export function useWorkspaceMutationRefresh(input: {
  readonly enabled?: boolean;
  readonly mutationId: string | null;
  readonly refresh: () => void;
  readonly resourceKey: string;
}): void {
  const { enabled = true, mutationId, refresh, resourceKey } = input;
  const handledTokenRef = useRef<string | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- refetches the resource once per new workspace mutation token
  useEffect(() => {
    if (!enabled) return;
    const token = workspaceMutationRefreshToken(resourceKey, mutationId);
    if (token === null || token === handledTokenRef.current) return;
    handledTokenRef.current = token;
    refresh();
  }, [enabled, mutationId, refresh, resourceKey]);
}
