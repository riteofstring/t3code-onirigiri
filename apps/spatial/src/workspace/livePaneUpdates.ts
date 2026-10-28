import { createContext, use, useCallback, useSyncExternalStore } from "react";

import type { PanePosition } from "./paneLifecycle";

export function createLivePaneUpdates(
  initial: readonly PanePosition[],
  initialFocus: string | null,
) {
  let panes = initial;
  let focused = initialFocus;
  let warm = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const refresh = () => {
    const center = panes.find((pane) => pane.paneId === focused) ?? panes[0];
    const next = new Set(
      panes
        .filter(
          (pane) =>
            center &&
            Math.abs(pane.plane - center.plane) <= 1 &&
            Math.abs(pane.slot - center.slot) <= 2,
        )
        .map((pane) => pane.paneId),
    );
    const previous = warm;
    warm = next;
    for (const [paneId, subscribers] of listeners) {
      if (previous.has(paneId) !== next.has(paneId)) {
        for (const notify of subscribers) notify();
      }
    }
  };
  refresh();
  return {
    isWarm: (paneId: string) => warm.has(paneId),
    setFocus(paneId: string | null) {
      if (focused === paneId) return;
      focused = paneId;
      refresh();
    },
    setPanes(next: readonly PanePosition[]) {
      panes = next;
      refresh();
    },
    subscribe(paneId: string, notify: () => void) {
      let subscribers = listeners.get(paneId);
      if (!subscribers) listeners.set(paneId, (subscribers = new Set()));
      subscribers.add(notify);
      return () => {
        subscribers.delete(notify);
        if (subscribers.size === 0) listeners.delete(paneId);
      };
    },
  };
}

export const LivePaneUpdatesContext = createContext<ReturnType<
  typeof createLivePaneUpdates
> | null>(null);

export function useLivePaneWarm(paneId: string, visible: boolean, focused: boolean) {
  const updates = use(LivePaneUpdatesContext);
  return useSyncExternalStore(
    useCallback((notify) => updates?.subscribe(paneId, notify) ?? (() => {}), [paneId, updates]),
    () => visible || focused || (updates?.isWarm(paneId) ?? true),
    () => true,
  );
}
