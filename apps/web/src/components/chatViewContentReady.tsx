import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

import { useDelayedStatus } from "../hooks/useDelayedStatus";
import { ChatViewHostContext } from "./chatViewHost";
import type { ThreadSyncPhase } from "../threadSync";

const ChatViewContentReadyContext = createContext<{
  report: (ready: boolean) => void;
  suspend: () => () => void;
} | null>(null);

export function ChatViewContentReadyProvider({
  children,
  onReadyChange,
}: {
  children: ReactNode;
  onReadyChange: (ready: boolean) => void;
}) {
  const [contentReady, setContentReady] = useState(false);
  const [pending, setPending] = useState(0);
  const suspend = () => {
    setPending((count) => count + 1);
    return () => setPending((count) => count - 1);
  };
  const context = { report: setContentReady, suspend };
  const ready = contentReady && pending === 0;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports content readiness to the host that reveals this pane before paint
  useLayoutEffect(() => {
    onReadyChange(ready);
  }, [onReadyChange, ready]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- withdraws readiness from the host when this provider unmounts or the host changes
  useLayoutEffect(() => () => onReadyChange(false), [onReadyChange]);
  return <ChatViewContentReadyContext value={context}>{children}</ChatViewContentReadyContext>;
}

export function ChatViewPendingContent() {
  const suspend = useContext(ChatViewContentReadyContext)?.suspend;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- holds a pending-content entry in the provider's count while this placeholder is mounted
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports composer sync readiness to the content gate after the delayed status timer settles
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
  composerMounted = true,
) {
  const report = useContext(ChatViewContentReadyContext)?.report;
  const host = useContext(ChatViewHostContext);
  const [checkoutReadyFor, setCheckoutReadyFor] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ threadKey: string; ready: boolean } | null>(null);

  if (report && checkoutReady && checkoutReadyFor !== threadKey) {
    setCheckoutReadyFor(threadKey);
  }
  const onSyncReadyChange = (ready: boolean) => {
    setComposer((current) =>
      current?.threadKey === threadKey && current.ready === ready ? current : { threadKey, ready },
    );
  };
  const composerReady =
    (environmentUnavailable || checkoutReadyFor === threadKey || checkoutReady) &&
    (!composerMounted || (composer?.threadKey === threadKey && composer.ready));
  const ready = timelineReady && composerReady;
  const reportComposer = host?.onComposerReady;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports composer readiness to the embedding host, withdrawn on unmount
  useLayoutEffect(() => {
    reportComposer?.(composerReady);
    return () => reportComposer?.(false);
  }, [composerReady, reportComposer]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reports committed content readiness to the gating provider before paint
  useLayoutEffect(() => {
    report?.(ready);
  }, [report, ready]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- withdraws readiness from the gating provider on unmount
  useLayoutEffect(() => () => report?.(false), [report]);

  return report ? onSyncReadyChange : undefined;
}
