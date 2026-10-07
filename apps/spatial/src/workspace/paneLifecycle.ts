import { createContext, startTransition, use, useEffect, useState } from "react";

/** Neighbours of the focused pane prepared ahead of use. */
const NEIGHBORS = 4;
/** Retained views; one temporary background capture may exceed this budget. */
const MAX_MOUNTED = 8;
/** Quiet time after focus or visibility changes before mounting follows them. */
const SETTLE_MS = 200;
/** Quiet time after a focus change before its neighbours are prepared. */
const NEIGHBOR_SETTLE_MS = 600;
/** Speculative mounts wait for this long without keyboard or pointer input. */
const INPUT_QUIET_MS = 400;
/** How long a pane mounted only to be pictured may take before it is let go. */
const PICTURE_TIMEOUT_MS = 10_000;
/** Background pictures wait this long after input, and this long after each other. */
const PICTURE_INPUT_QUIET_MS = 3000;
const PICTURE_GAP_MS = 4000;
/** A pane that could not be pictured, or whose picture went stale, is tried again after this. */
const PICTURE_RETRY_MS = 5 * 60_000;

export interface PanePosition {
  readonly paneId: string;
  readonly plane: number;
  readonly slot: number;
}

type Direction = "left" | "right" | "up" | "down";

/**
 * Decides which thread panes mount a live ChatView.
 *
 * Once focus and visibility have been quiet for a moment the focused pane
 * mounts at once, ahead of any other work; a camera sweep therefore mounts
 * only where it stops. The focused pane's neighbours, the next one in the
 * direction of travel first, and then visible panes without a picture are
 * prepared speculatively: one
 * at a time, each after the previous one has committed, only while the page is
 * idle and input has been quiet. When nothing else is wanted, panes without a
 * picture are mounted the same way, nearest first, until they are pictured.
 * Navigation cancels speculative work that has
 * not started yet.
 */
export function createPaneLifecycleStore(
  initialPanes: readonly PanePosition[],
  focusedPaneId: string | null,
) {
  let panes = new Map(initialPanes.map((pane) => [pane.paneId, pane]));
  let focused =
    focusedPaneId && panes.has(focusedPaneId) ? focusedPaneId : (initialPanes[0]?.paneId ?? null);
  let direction: Direction | null = null;
  const visible = new Set<string>();
  const mounted = new Set<string>(focused ? [focused] : []);
  const lastWanted = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  let queue: string[] = [];
  let wanted = new Set<string>();
  let waitingFor: string | null = null;
  let idleCallback: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let neighborTimer: ReturnType<typeof setTimeout> | null = null;
  let neighborsWanted = false;
  let lastInput = 0;
  let clock = 0;
  let hasPicture: (paneId: string) => boolean = () => false;
  // A pane mounted only so it can be pictured, and the panes already tried.
  let picturing: { paneId: string; since: number } | null = null;
  const pictureAttempted = new Map<string, number>();
  let pictureTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundPictures = false;
  let nextPictureAt = 0;

  const notify = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) listener();
  };

  const mount = (paneId: string) => {
    if (mounted.has(paneId)) return false;
    mounted.add(paneId);
    notify(paneId);
    return true;
  };

  const unmount = (paneId: string) => {
    if (mounted.delete(paneId)) notify(paneId);
  };

  // Keeps at most `limit` panes mounted, unmounting the least recently wanted
  // ones that are not in `keep`.
  const evictBeyond = (limit: number, keep: ReadonlySet<string>) => {
    const evictable = [...mounted]
      .filter((paneId) => !keep.has(paneId) && paneId !== picturing?.paneId)
      .toSorted((a, b) => (lastWanted.get(a) ?? 0) - (lastWanted.get(b) ?? 0));
    while (mounted.size > limit && evictable.length > 0) unmount(evictable.shift()!);
  };

  const cancelSpeculation = () => {
    queue = [];
    if (idleCallback !== null) cancelIdleCallback(idleCallback);
    if (quietTimer !== null) clearTimeout(quietTimer);
    if (pictureTimer !== null) clearTimeout(pictureTimer);
    idleCallback = null;
    quietTimer = null;
    pictureTimer = null;
  };

  // The nearest pane to focus that has no picture and was not tried yet.
  const nextToPicture = (): string | null => {
    if (!backgroundPictures) return null;
    const center = focused ? panes.get(focused) : undefined;
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const pane of panes.values()) {
      if (mounted.has(pane.paneId)) continue;
      const attempted = pictureAttempted.get(pane.paneId);
      if (attempted !== undefined && performance.now() - attempted < PICTURE_RETRY_MS) continue;
      if (hasPicture(pane.paneId)) continue;
      const distance = center
        ? Math.abs(pane.plane - center.plane) * 1000 + Math.abs(pane.slot - center.slot)
        : 0;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pane.paneId;
      }
    }
    return best;
  };

  // Lets go of the pane being pictured once it has a picture or took too long;
  // true while it is still being pictured.
  const picturingPending = () => {
    if (!picturing) return false;
    const { paneId, since } = picturing;
    const done =
      hasPicture(paneId) || !panes.has(paneId) || performance.now() - since > PICTURE_TIMEOUT_MS;
    if (!done) return true;
    if (!wanted.has(paneId) && paneId !== focused) unmount(paneId);
    picturing = null;
    evictBeyond(MAX_MOUNTED, wanted);
    nextPictureAt = performance.now() + PICTURE_GAP_MS;
    return false;
  };

  const schedule = () => {
    if (waitingFor !== null || idleCallback !== null || quietTimer !== null) return;
    if (pictureTimer !== null) return;
    if (queue.length === 0 && picturing === null && nextToPicture() === null) return;
    const sinceInput = performance.now() - lastInput;
    if (sinceInput < INPUT_QUIET_MS) {
      quietTimer = setTimeout(() => {
        quietTimer = null;
        schedule();
      }, INPUT_QUIET_MS - sinceInput);
      return;
    }
    idleCallback = requestIdleCallback(advance, { timeout: 1000 });
  };

  const advance = () => {
    idleCallback = null;
    if (performance.now() - lastInput < INPUT_QUIET_MS) {
      schedule();
      return;
    }
    while (queue.length > 0) {
      const paneId = queue.shift()!;
      if (!panes.has(paneId) || mounted.has(paneId)) continue;
      evictBeyond(MAX_MOUNTED - 1 + (picturing ? 1 : 0), wanted);
      mount(paneId);
      waitingFor = paneId;
      return;
    }
    // With nothing likely to be needed soon, panes without a picture are
    // mounted one at a time so they can be pictured, nearest first.
    const waitForPicture = (ms: number) => {
      pictureTimer = setTimeout(() => {
        pictureTimer = null;
        schedule();
      }, ms);
    };
    if (picturingPending()) {
      waitForPicture(1000);
      return;
    }
    const paneId = nextToPicture();
    if (paneId === null) return;
    const now = performance.now();
    const wait = Math.max(nextPictureAt - now, lastInput + PICTURE_INPUT_QUIET_MS - now);
    if (wait > 0) {
      waitForPicture(wait);
      return;
    }
    if (mounted.size >= MAX_MOUNTED + 1) return;
    pictureAttempted.set(paneId, performance.now());
    mount(paneId);
    picturing = { paneId, since: performance.now() };
    waitingFor = paneId;
  };

  const nearestInDirection = (center: PanePosition, dir: Direction): string | null => {
    const horizontal = dir === "left" || dir === "right";
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const pane of panes.values()) {
      const dPlane = pane.plane - center.plane;
      const dSlot = pane.slot - center.slot;
      if (horizontal && dPlane !== 0) continue;
      const along =
        dir === "left" ? -dSlot : dir === "right" ? dSlot : dir === "up" ? -dPlane : dPlane;
      if (along <= 0) continue;
      const distance = along * 1000 + (horizontal ? 0 : Math.abs(dSlot));
      if (distance < bestDistance) {
        bestDistance = distance;
        best = pane.paneId;
      }
    }
    return best;
  };

  // The panes adjacent to focus, the next one in the direction of travel first.
  const neighbors = (): string[] => {
    const center = focused ? panes.get(focused) : undefined;
    if (!center) return [];
    const order: Direction[] = ["right", "left", "down", "up"];
    if (direction) order.unshift(direction);
    const adjacent = order.map((dir) => nearestInDirection(center, dir));
    return [...new Set(adjacent.filter((paneId) => paneId !== null))].slice(0, NEIGHBORS);
  };

  const settle = () => {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = null;
    clock += 1;
    if (focused && panes.has(focused)) {
      lastWanted.set(focused, clock);
      mount(focused);
    }
    // Likely destinations come before panes that are merely on screen, and a
    // pane on screen that a picture already shows does not need its view.
    const onScreen = [...visible].filter((paneId) => !hasPicture(paneId));
    const nearby = neighborsWanted ? neighbors() : [];
    const speculative = [...new Set([...nearby, ...onScreen])].filter(
      (paneId) => paneId !== focused && panes.has(paneId),
    );
    wanted = new Set([...(focused ? [focused] : []), ...speculative].slice(0, MAX_MOUNTED));
    for (const paneId of wanted) lastWanted.set(paneId, clock);
    cancelSpeculation();
    queue = speculative.filter((paneId) => wanted.has(paneId) && !mounted.has(paneId));
    // Views stay warm until a mount needs their place.
    evictBeyond(MAX_MOUNTED + (picturing ? 1 : 0), wanted);
    schedule();
  };

  const requestSettle = () => {
    if (settleTimer !== null) return;
    settleTimer = setTimeout(settle, SETTLE_MS);
  };

  const restartNeighborWait = () => {
    neighborsWanted = false;
    if (neighborTimer !== null) clearTimeout(neighborTimer);
    neighborTimer = setTimeout(() => {
      neighborTimer = null;
      neighborsWanted = true;
      settle();
    }, NEIGHBOR_SETTLE_MS);
  };

  const noteInput = () => {
    lastInput = performance.now();
  };
  const inputEvents = ["keydown", "pointerdown", "wheel"] as const;
  for (const type of inputEvents) {
    window.addEventListener(type, noteInput, { capture: true, passive: true });
  }

  restartNeighborWait();

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
    setFocus: (paneId: string) => {
      const from = focused ? panes.get(focused) : undefined;
      const to = panes.get(paneId);
      if (!to || paneId === focused) return;
      if (from) {
        direction =
          to.plane === from.plane
            ? to.slot > from.slot
              ? "right"
              : "left"
            : to.plane > from.plane
              ? "down"
              : "up";
      }
      focused = paneId;
      cancelSpeculation();
      restartNeighborWait();
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      requestSettle();
    },
    /** Follows the workspace's panes as threads come and go. */
    setPanes: (nextPanes: readonly PanePosition[]) => {
      if (
        panes.size === nextPanes.length &&
        nextPanes.every((pane) => {
          const previous = panes.get(pane.paneId);
          return previous?.plane === pane.plane && previous.slot === pane.slot;
        })
      )
        return;
      panes = new Map(nextPanes.map((pane) => [pane.paneId, pane]));
      for (const paneId of mounted) if (!panes.has(paneId)) mounted.delete(paneId);
      for (const paneId of visible) if (!panes.has(paneId)) visible.delete(paneId);
      if (focused && !panes.has(focused)) focused = null;
      queue = queue.filter((paneId) => panes.has(paneId));
      wanted = new Set([...wanted].filter((paneId) => panes.has(paneId)));
      if (waitingFor !== null && !panes.has(waitingFor)) {
        waitingFor = null;
        schedule();
      }
      requestSettle();
    },
    /** Whether panes without a picture are mounted in the background to picture them. */
    setBackgroundPictures: (enabled: boolean) => {
      backgroundPictures = enabled;
      requestSettle();
    },
    /** Tells which panes a picture shows faithfully while they are not mounted. */
    setPictures: (pictured: (paneId: string) => boolean) => {
      hasPicture = pictured;
      requestSettle();
    },
    setVisible: (paneId: string, isVisible: boolean) => {
      if (visible.has(paneId) === isVisible) return;
      if (isVisible) visible.add(paneId);
      else visible.delete(paneId);
      requestSettle();
    },
    dispose: () => {
      cancelSpeculation();
      picturing = null;
      if (settleTimer !== null) clearTimeout(settleTimer);
      if (neighborTimer !== null) clearTimeout(neighborTimer);
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
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
