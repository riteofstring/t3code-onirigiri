import { createContext, useCallback, useContext, useLayoutEffect, useState } from "react";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import type { ThreadSyncPhase } from "../threadSync";

/** A host can keep its visual cover until the checkout strip and sync indicator settle. */
export const ChatViewContentReadyContext = createContext<((ready: boolean) => void) | null>(null);

export function useComposerSyncPhase(
  threadKey: string,
  phase: ThreadSyncPhase | null,
  onReady?: ((ready: boolean) => void) | undefined,
) {
  const shown = useDelayedStatus(threadKey, phase);
  const ready = phase === null && shown === null;
  useLayoutEffect(() => {
    onReady?.(ready);
  }, [onReady, ready]);
  return shown;
}

export function useChatViewContentReady(
  threadKey: string,
  checkoutReady: boolean,
  environmentUnavailable = false,
) {
  const report = useContext(ChatViewContentReadyContext);
  const [checkoutReadyFor, setCheckoutReadyFor] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ threadKey: string; ready: boolean } | null>(null);

  // Later checkout changes remain ordinary live updates, not new initialization.
  if (report && checkoutReady && checkoutReadyFor !== threadKey) {
    setCheckoutReadyFor(threadKey);
  }
  const onSyncReadyChange = useCallback(
    (ready: boolean) => {
      setComposer((current) =>
        current?.threadKey === threadKey && current.ready === ready
          ? current
          : { threadKey, ready },
      );
    },
    [threadKey],
  );
  const ready =
    (environmentUnavailable || checkoutReadyFor === threadKey || checkoutReady) &&
    composer?.threadKey === threadKey &&
    composer.ready;

  useLayoutEffect(() => {
    report?.(ready);
  }, [report, ready]);
  useLayoutEffect(() => () => report?.(false), [report]);

  return report ? onSyncReadyChange : undefined;
}
