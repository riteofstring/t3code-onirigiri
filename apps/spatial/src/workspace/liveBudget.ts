import type { OnirigiriCaptureStatus } from "@riteofstring/onirigiri";
import { createContext, startTransition, use, useEffect, useState } from "react";

export interface PaneBudgetState {
  /** Whether the pane's ChatView is mounted. */
  readonly mounted: boolean;
  /** Whether the pane is among the panes kept live. */
  readonly inBudget: boolean;
  /** Revision of the pane's latest accepted picture. */
  readonly pictureRevision: number | null;
}

const UNMOUNTED: PaneBudgetState = { mounted: false, inBudget: false, pictureRevision: null };
const INITIAL_MOUNTS = 12;

/**
 * Per-pane budget state, read by each pane on its own so capture progress does
 * not re-render the workspace.
 *
 * Mounting or revealing a ChatView is a large render, and many at once chain
 * enough synchronous store updates to exceed React's nested update limit. The
 * focused pane and its nearest neighbours mount at once; every other pane
 * mounts or rejoins the budget one at a time, nearest first, each after the
 * previous one has committed and the page is idle.
 */
export function createLiveBudgetStore(
  order: readonly string[],
  budget: number,
  focusedPaneId: string | null,
) {
  const states = new Map<string, PaneBudgetState>();
  const listeners = new Map<string, Set<() => void>>();
  let live: ReadonlySet<string> = new Set();
  let queue: string[] = [];
  let waitingFor: string | null = null;
  let idleCallback: number | null = null;

  const get = (paneId: string) => states.get(paneId) ?? UNMOUNTED;

  const update = (paneId: string, patch: Partial<PaneBudgetState>) => {
    const previous = get(paneId);
    const next = { ...previous, ...patch };
    if (
      next.mounted === previous.mounted &&
      next.inBudget === previous.inBudget &&
      next.pictureRevision === previous.pictureRevision
    ) {
      return false;
    }
    states.set(paneId, next);
    for (const listener of listeners.get(paneId) ?? []) listener();
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
      if (update(paneId, { mounted: true, inBudget: live.has(paneId) })) {
        waitingFor = paneId;
        return;
      }
    }
  };

  const setBudget = (
    nextOrder: readonly string[],
    nextBudget: number,
    nextFocusedPaneId: string | null,
  ) => {
    live = new Set(nextOrder.slice(0, nextBudget));
    queue = [];
    for (const paneId of nextOrder) {
      const state = get(paneId);
      if (!live.has(paneId)) {
        update(paneId, { inBudget: false });
        if (!state.mounted) queue.push(paneId);
      } else if (paneId === nextFocusedPaneId) {
        update(paneId, { mounted: true, inBudget: true });
      } else if (!state.mounted || !state.inBudget) {
        queue.push(paneId);
      }
    }
    schedule();
  };

  for (const paneId of order.slice(0, Math.min(budget, INITIAL_MOUNTS))) {
    states.set(paneId, { ...UNMOUNTED, mounted: true, inBudget: true });
  }
  setBudget(order, budget, focusedPaneId);

  return {
    get,
    subscribe: (paneId: string, listener: () => void) => {
      let paneListeners = listeners.get(paneId);
      if (!paneListeners) listeners.set(paneId, (paneListeners = new Set()));
      paneListeners.add(listener);
      return () => {
        paneListeners.delete(listener);
      };
    },
    /** Reports that a pane committed a budget state. */
    committed: (paneId: string, state: PaneBudgetState) => {
      if (waitingFor !== paneId || state !== get(paneId)) return;
      waitingFor = null;
      schedule();
    },
    setBudget,
    setCaptureStatus: (status: OnirigiriCaptureStatus) => {
      for (const picture of status.pictures) {
        update(picture.paneId, { pictureRevision: picture.revision });
      }
    },
  };
}

export type LiveBudgetStore = ReturnType<typeof createLiveBudgetStore>;

export const LiveBudgetContext = createContext<LiveBudgetStore | null>(null);

const ALWAYS_LIVE: PaneBudgetState = { mounted: true, inBudget: true, pictureRevision: null };

/**
 * Budget changes reach a pane as a transition, so mounting, parking or
 * revealing its ChatView renders without blocking input.
 */
export function usePaneBudget(paneId: string): PaneBudgetState {
  const store = use(LiveBudgetContext);
  const [state, setState] = useState(() => store?.get(paneId) ?? ALWAYS_LIVE);
  useEffect(() => {
    if (!store) return;
    const sync = () => startTransition(() => setState(store.get(paneId)));
    sync();
    return store.subscribe(paneId, sync);
  }, [store, paneId]);
  useEffect(() => {
    store?.committed(paneId, state);
  }, [store, paneId, state]);
  return state;
}
