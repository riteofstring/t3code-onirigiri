import { createContext, startTransition, use, useEffect, useState } from "react";

/** Panes kept mounted around focus besides the visible ones. */
const RING = 4;
/** Most thread views mounted at once; the least recently wanted unmount first. */
const MAX_MOUNTED = 8;
/** Quiet time after focus or visibility changes before mounting follows them. */
const SETTLE_MS = 200;

/**
 * Decides which thread panes mount a live ChatView: the focused pane, the
 * visible panes and the nearest ones around focus. Everything else is
 * unmounted and shown by its picture or card.
 *
 * The focused pane mounts at once. Other changes wait until focus and
 * visibility have been quiet for a moment, so a camera sweep across many panes
 * does not mount each one it passes, and then mount one at a time, each after
 * the previous one has committed and the page is idle.
 */
export function createPaneLifecycleStore(order: readonly string[], focusedPaneId: string | null) {
  let paneOrder = order;
  let focused = focusedPaneId ?? order[0] ?? null;
  const visible = new Set<string>();
  const mounted = new Set<string>(focused ? [focused] : []);
  const lastWanted = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  let queue: string[] = [];
  let waitingFor: string | null = null;
  let idleCallback: number | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let clock = 0;

  const notify = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) listener();
  };

  const mount = (paneId: string) => {
    if (mounted.has(paneId)) return false;
    mounted.add(paneId);
    notify(paneId);
    return true;
  };

  const schedule = () => {
    if (waitingFor !== null || idleCallback !== null || queue.length === 0) return;
    idleCallback = requestIdleCallback(advance, { timeout: 1000 });
  };

  const advance = () => {
    idleCallback = null;
    while (queue.length > 0) {
      const paneId = queue.shift()!;
      if (mount(paneId)) {
        waitingFor = paneId;
        return;
      }
    }
  };

  const settle = () => {
    settleTimer = null;
    clock += 1;
    const wanted = [
      ...new Set([
        ...(focused ? [focused] : []),
        ...paneOrder.filter((paneId) => visible.has(paneId)),
        ...paneOrder.slice(0, RING + 1),
      ]),
    ].slice(0, MAX_MOUNTED);
    for (const paneId of wanted) lastWanted.set(paneId, clock);
    queue = wanted.filter((paneId) => !mounted.has(paneId));
    const evictable = [...mounted]
      .filter((paneId) => !wanted.includes(paneId))
      .toSorted((a, b) => (lastWanted.get(a) ?? 0) - (lastWanted.get(b) ?? 0));
    while (mounted.size + queue.length > MAX_MOUNTED && evictable.length > 0) {
      const paneId = evictable.shift()!;
      mounted.delete(paneId);
      notify(paneId);
    }
    schedule();
  };

  const requestSettle = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(settle, SETTLE_MS);
  };

  return {
    isMounted: (paneId: string) => mounted.has(paneId),
    subscribe: (paneId: string, listener: () => void) => {
      let paneListeners = listeners.get(paneId);
      if (!paneListeners) listeners.set(paneId, (paneListeners = new Set()));
      paneListeners.add(listener);
      return () => {
        paneListeners.delete(listener);
      };
    },
    /** Reports that a pane committed its mounted state. */
    committed: (paneId: string, isMounted: boolean) => {
      if (waitingFor !== paneId || isMounted !== mounted.has(paneId)) return;
      waitingFor = null;
      schedule();
    },
    setFocus: (nextOrder: readonly string[], nextFocusedPaneId: string | null) => {
      paneOrder = nextOrder;
      focused = nextFocusedPaneId ?? focused;
      if (focused) {
        lastWanted.set(focused, ++clock);
        mount(focused);
      }
      requestSettle();
    },
    setVisible: (paneId: string, isVisible: boolean) => {
      if (visible.has(paneId) === isVisible) return;
      if (isVisible) visible.add(paneId);
      else visible.delete(paneId);
      requestSettle();
    },
  };
}

export type PaneLifecycleStore = ReturnType<typeof createPaneLifecycleStore>;

export const PaneLifecycleContext = createContext<PaneLifecycleStore | null>(null);

/**
 * Whether the pane's thread view is mounted. Changes reach the pane as a
 * transition, so mounting or unmounting a ChatView does not block input.
 */
export function usePaneMounted(paneId: string, visible: boolean): boolean {
  const store = use(PaneLifecycleContext);
  const [mounted, setMounted] = useState(() => store?.isMounted(paneId) ?? true);
  useEffect(() => {
    if (!store) return;
    const sync = () => startTransition(() => setMounted(store.isMounted(paneId)));
    sync();
    return store.subscribe(paneId, sync);
  }, [store, paneId]);
  useEffect(() => {
    store?.setVisible(paneId, visible);
  }, [store, paneId, visible]);
  useEffect(() => {
    store?.committed(paneId, mounted);
  }, [store, paneId, mounted]);
  return mounted;
}
