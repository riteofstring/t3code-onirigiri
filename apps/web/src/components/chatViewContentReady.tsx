import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import type { ThreadSyncPhase } from "../threadSync";

const ChatViewContentReadyContext = createContext<{
  report: (ready: boolean) => void;
  suspend: () => () => void;
} | null>(null);

/** A host keeps its cover until layout, synchronization and suspended content settle. */
export function ChatViewContentReadyProvider({
  children,
  onReadyChange,
}: {
  children: ReactNode;
  onReadyChange: (ready: boolean) => void;
}) {
  const [contentReady, setContentReady] = useState(false);
  const [pending, setPending] = useState(0);
  const suspend = useCallback(() => {
    setPending((count) => count + 1);
    return () => setPending((count) => count - 1);
  }, []);
  const context = useMemo(() => ({ report: setContentReady, suspend }), [suspend]);
  const ready = contentReady && pending === 0;
  useLayoutEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);
  useLayoutEffect(() => () => onReadyChange(false), [onReadyChange]);
  return <ChatViewContentReadyContext value={context}>{children}</ChatViewContentReadyContext>;
}

/** A committed Suspense fallback keeps hosted content from being pictured as complete. */
export function ChatViewPendingContent() {
  const suspend = useContext(ChatViewContentReadyContext)?.suspend;
  useLayoutEffect(() => suspend?.(), [suspend]);
  return null;
}

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
  timelineReady: boolean,
  environmentUnavailable = false,
) {
  const report = useContext(ChatViewContentReadyContext)?.report;
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
    timelineReady &&
    (environmentUnavailable || checkoutReadyFor === threadKey || checkoutReady) &&
    composer?.threadKey === threadKey &&
    composer.ready;

  useLayoutEffect(() => {
    report?.(ready);
  }, [report, ready]);
  useLayoutEffect(() => () => report?.(false), [report]);

  return report ? onSyncReadyChange : undefined;
}
