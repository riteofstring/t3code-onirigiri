import { createContext, startTransition, use, useEffect, useState } from "react";

/** Neighbours of the focused pane prepared ahead of use. */
const NEIGHBORS = 4;
/** Warm retention target; visible views and one background capture may exceed it. */
const MAX_MOUNTED = 8;
/** Quiet time after focus or visibility changes before mounting follows them. */
const SETTLE_MS = 200;
/** Quiet time after a focus change before its neighbours are prepared. */
const NEIGHBOR_SETTLE_MS = 600;
/** Speculative mounts wait for this long without keyboard or pointer input. */
const INPUT_QUIET_MS = 400;
const COMMIT_TIMEOUT_MS = 2000;
const STORED_PICTURES_WAIT_MS = 2000;
/** How long a pane mounted only to be pictured may take before it is let go. */
const PICTURE_TIMEOUT_MS = 10_000;
/** Background pictures wait this long after input. */
const PICTURE_INPUT_QUIET_MS = 3000;
/** A pane that could not be pictured is tried again after this. */
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
 * mounts ahead of any other work. A saved picture bridges camera motion before
 * mounting; a destination without one still prepares early. The focused pane's
 * visible peers mount next, one at a time after each commit, regardless of
 * saved pictures. Visible views are never evicted to meet the retention target.
 * Neighbours, the next one in the direction of travel first, are prepared in
 * spare slots only while the page is idle and input has been quiet.
 * When nothing else is wanted, untried panes mount nearest first; interrupted
 * reservations take turns afterward until they are pictured.
 * Navigation cancels speculative work that has
 * not started yet.
 * Running conversations use spare retained slots after likely destinations;
 * a workspace with more running views than those slots cannot keep them all live.
 */
export function createPaneLifecycleStore(
  initialPanes: readonly PanePosition[],
  focusedPaneId: string | null,
) {
  let panes = new Map(initialPanes.map((pane) => [pane.paneId, pane]));
  let focused =
    focusedPaneId && panes.has(focusedPaneId) ? focusedPaneId : (initialPanes[0]?.paneId ?? null);
  let direction: Direction | null = null;
  let running: ReadonlySet<string> = new Set();
  let retained: ReadonlySet<string> = new Set();
  const visible = new Set<string>();
  const mounted = new Set<string>(focused ? [focused] : []);
  // Only an owner presented to the user needs lifetime retention.
  const viewed = new Set(mounted);
  const lastWanted = new Map<string, number>();
  const listeners = new Map<string, Set<() => void>>();
  const motionListeners = new Set<() => void>();
  let queue: string[] = [];
  let wanted = new Set<string>();
  let waitingFor: string | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let idleCallback: number | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let settleDue = false;
  let moving = false;
  let neighborTimer: ReturnType<typeof setTimeout> | null = null;
  let neighborsWanted = false;
  let lastInput = 0;
  let clock = 0;
  let hasPicture: (paneId: string) => boolean = () => false;
  let freshPictures = new Set<string>();
  let pictureExcluded = new Set<string>();
  let picturesReady = true;
  let storedPicturesTimer: ReturnType<typeof setTimeout> | null = null;
  let storedPicturesWaited = false;
  // A pane mounted only so it can be pictured, and the panes already tried.
  let picturing: { paneId: string; since: number; interrupted: boolean; failed: boolean } | null =
    null;
  const pictureAttempted = new Map<string, { since: number; retryAt: number }>();
  let pictureTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundPictures = false;

  const notify = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) listener();
  };

  const mount = (paneId: string) => {
    if (mounted.has(paneId)) return false;
    mounted.add(paneId);
    if (paneId === focused || visible.has(paneId)) viewed.add(paneId);
    notify(paneId);
    return true;
  };

  const clearCommitWait = () => {
    waitingFor = null;
    if (commitTimer !== null) clearTimeout(commitTimer);
    commitTimer = null;
  };

  const waitForCommit = (paneId: string) => {
    clearCommitWait();
    waitingFor = paneId;
    commitTimer = setTimeout(() => {
      clearCommitWait();
      schedule();
    }, COMMIT_TIMEOUT_MS);
  };

  const mountPrepared = (paneId: string) => {
    waitForCommit(paneId);
    mount(paneId);
  };

  const mustRetain = (paneId: string) => retained.has(paneId) && viewed.has(paneId);

  const unmount = (paneId: string) => {
    if (panes.has(paneId) && mustRetain(paneId)) return;
    if (waitingFor === paneId) clearCommitWait();
    if (mounted.delete(paneId)) {
      viewed.delete(paneId);
      notify(paneId);
    }
  };

  const distance = (paneId: string) => {
    const center = focused ? panes.get(focused) : undefined;
    const pane = panes.get(paneId);
    return pane
      ? Math.abs(pane.plane - (center?.plane ?? 0)) * 1000 +
          Math.abs(pane.slot - (center?.slot ?? 0))
      : Infinity;
  };

  const evictionCandidate = (limit: number, keep: ReadonlySet<string>) => {
    if (mounted.size <= limit) return null;
    return (
      [...mounted]
        .filter(
          (paneId) =>
            !mustRetain(paneId) &&
            !keep.has(paneId) &&
            !visible.has(paneId) &&
            paneId !== picturing?.paneId,
        )
        .toSorted(
          (a, b) =>
            Number(hasPicture(b)) - Number(hasPicture(a)) ||
            (lastWanted.get(a) ?? 0) - (lastWanted.get(b) ?? 0) ||
            distance(b) - distance(a),
        )[0] ?? null
    );
  };

  const reservePicture = (paneId: string, interrupted: boolean) => {
    const since = performance.now();
    picturing = { paneId, since, interrupted, failed: false };
    pictureAttempted.set(paneId, { since, retryAt: since + PICTURE_RETRY_MS });
  };

  const retainForPicture = (paneId: string) => {
    if (
      picturing === null &&
      backgroundPictures &&
      picturesReady &&
      viewed.has(paneId) &&
      !hasPicture(paneId) &&
      !pictureExcluded.has(paneId) &&
      !running.has(paneId) &&
      performance.now() >= (pictureAttempted.get(paneId)?.retryAt ?? -Infinity)
    ) {
      reservePicture(paneId, moving || performance.now() - lastInput < INPUT_QUIET_MS);
      return true;
    }
    return false;
  };

  const interruptPicture = () => {
    if (picturing && performance.now() - picturing.since < PICTURE_TIMEOUT_MS) {
      picturing.interrupted = true;
    }
  };

  const evictBeyond = (limit: number, keep: ReadonlySet<string>) => {
    picturingPending();
    const paneId = evictionCandidate(limit + (picturing ? 1 : 0), keep);
    if (paneId !== null && !retainForPicture(paneId)) unmount(paneId);
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

  // Untried panes go first, then the oldest attempt; distance breaks ties.
  const nextToPicture = (): string | null => {
    if (!backgroundPictures || !picturesReady) return null;
    const center = focused ? panes.get(focused) : undefined;
    let best: string | null = null;
    let bestAttempt = Infinity;
    let bestDistance = Infinity;
    for (const pane of panes.values()) {
      if (mounted.has(pane.paneId)) continue;
      if (pictureExcluded.has(pane.paneId)) continue;
      const attempted = pictureAttempted.get(pane.paneId);
      if (attempted !== undefined && performance.now() < attempted.retryAt) continue;
      if (hasPicture(pane.paneId)) continue;
      const since = attempted?.since ?? -Infinity;
      const distance = center
        ? Math.abs(pane.plane - center.plane) * 1000 + Math.abs(pane.slot - center.slot)
        : 0;
      if (since < bestAttempt || (since === bestAttempt && distance < bestDistance)) {
        bestAttempt = since;
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
      retained.has(paneId) ||
      hasPicture(paneId) ||
      !panes.has(paneId) ||
      performance.now() - since >= PICTURE_TIMEOUT_MS;
    if (!done) return true;
    if (hasPicture(paneId)) pictureAttempted.delete(paneId);
    else if (picturing.interrupted && !picturing.failed) {
      // Keep its place behind other missing panes without charging a missed capture as failure.
      const attempted = pictureAttempted.get(paneId);
      if (attempted) attempted.retryAt = performance.now();
    }
    if (!wanted.has(paneId) && !visible.has(paneId) && paneId !== focused) unmount(paneId);
    picturing = null;
    return false;
  };

  const visibleQueued = () => queue.some((paneId) => visible.has(paneId) && !mounted.has(paneId));

  const schedule = () => {
    if (moving) return;
    if (waitingFor !== null || idleCallback !== null || quietTimer !== null) return;
    if (pictureTimer !== null) return;
    if (
      queue.length === 0 &&
      picturing === null &&
      nextToPicture() === null &&
      evictionCandidate(MAX_MOUNTED + (picturing ? 1 : 0), wanted) === null
    ) {
      const retryAt =
        backgroundPictures && picturesReady
          ? Math.min(
              ...[...pictureAttempted].flatMap(([paneId, attempted]) =>
                panes.has(paneId) &&
                !mounted.has(paneId) &&
                !pictureExcluded.has(paneId) &&
                !hasPicture(paneId)
                  ? [attempted.retryAt]
                  : [],
              ),
            )
          : Infinity;
      if (retryAt > performance.now() && Number.isFinite(retryAt)) {
        pictureTimer = setTimeout(() => {
          pictureTimer = null;
          schedule();
        }, retryAt - performance.now());
      }
      return;
    }
    if (visibleQueued()) {
      quietTimer = setTimeout(() => {
        quietTimer = null;
        advance();
      }, 0);
      return;
    }
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
    if (moving) return;
    picturingPending();
    queue = queue.filter((paneId) => panes.has(paneId) && !mounted.has(paneId));
    if (!visibleQueued() && performance.now() - lastInput < INPUT_QUIET_MS) {
      schedule();
      return;
    }
    if (queue.length > 0) {
      const visibleIndex = queue.findIndex((paneId) => visible.has(paneId));
      const paneId = queue.splice(Math.max(0, visibleIndex), 1)[0]!;
      evictBeyond(MAX_MOUNTED - 1, wanted);
      mountPrepared(paneId);
      return;
    }
    // Leaving overview releases excess offscreen views one commit at a time,
    // only during idle input, instead of unmounting them all on the last frame.
    const retiring = evictionCandidate(MAX_MOUNTED + (picturing ? 1 : 0), wanted);
    if (retiring !== null) {
      if (retainForPicture(retiring)) schedule();
      else {
        waitForCommit(retiring);
        mounted.delete(retiring);
        viewed.delete(retiring);
        notify(retiring);
      }
      return;
    }
    // With nothing likely to be needed soon, missing pictures share one mount slot.
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
    if (paneId === null) {
      schedule();
      return;
    }
    const now = performance.now();
    const wait = lastInput + PICTURE_INPUT_QUIET_MS - now;
    if (wait > 0) {
      waitForPicture(wait);
      return;
    }
    const retainedCount = [...retained].filter(
      (paneId) => panes.has(paneId) && mustRetain(paneId) && paneId !== focused,
    ).length;
    if (mounted.size >= Math.max(MAX_MOUNTED, retainedCount + (focused ? 1 : 0)) + 1) return;
    reservePicture(paneId, false);
    mountPrepared(paneId);
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
    if (moving) {
      settleDue = true;
      if (focused && panes.has(focused) && !hasPicture(focused) && !mounted.has(focused)) {
        clock += 1;
        lastWanted.set(focused, clock);
        mountPrepared(focused);
        evictBeyond(MAX_MOUNTED, new Set([focused, ...wanted].slice(0, MAX_MOUNTED)));
      }
      return;
    }
    settleDue = false;
    clock += 1;
    if (focused && panes.has(focused)) {
      lastWanted.set(focused, clock);
      if (!mounted.has(focused)) mountPrepared(focused);
    }
    const required = new Set([
      ...(focused ? [focused] : []),
      ...[...visible]
        .filter((paneId) => panes.has(paneId))
        .toSorted((a, b) => distance(a) - distance(b)),
      ...[...retained].filter((paneId) => panes.has(paneId) && mustRetain(paneId)),
    ]);
    const nearby = neighbors().filter((paneId) => neighborsWanted || mounted.has(paneId));
    const live = [...panes.values()]
      .filter((pane) => running.has(pane.paneId) && (neighborsWanted || mounted.has(pane.paneId)))
      .toSorted(
        (a, b) => distance(a.paneId) - distance(b.paneId) || a.plane - b.plane || a.slot - b.slot,
      )
      .map((pane) => pane.paneId);
    const speculative = [...new Set([...nearby, ...live])].filter(
      (paneId) => !required.has(paneId) && panes.has(paneId),
    );
    wanted = new Set([
      ...required,
      ...speculative.slice(0, Math.max(0, MAX_MOUNTED - required.size)),
    ]);
    for (const paneId of wanted) lastWanted.set(paneId, clock);
    cancelSpeculation();
    queue = [...wanted].filter((paneId) => !mounted.has(paneId));
    schedule();
  };

  const requestSettle = () => {
    if (settleTimer !== null || settleDue) return;
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
    interruptPicture();
  };
  const inputEvents = ["keydown", "pointerdown", "wheel"] as const;
  for (const type of inputEvents) {
    window.addEventListener(type, noteInput, { capture: true, passive: true });
  }

  restartNeighborWait();

  return {
    isMounted: (paneId: string) => mounted.has(paneId),
    isMoving: () => moving,
    subscribeMotion: (listener: () => void) => {
      motionListeners.add(listener);
      return () => {
        motionListeners.delete(listener);
      };
    },
    subscribe: (paneId: string, listener: () => void) => {
      let paneListeners = listeners.get(paneId);
      if (!paneListeners) listeners.set(paneId, (paneListeners = new Set()));
      paneListeners.add(listener);
      return () => {
        paneListeners.delete(listener);
      };
    },
    /** Acknowledges the router shell before its route mounts synchronously. */
    committed: (paneId: string, isMounted: boolean) => {
      if (waitingFor !== paneId || isMounted !== mounted.has(paneId)) return;
      clearCommitWait();
      schedule();
    },
    pictureFailed: (paneId: string, startedAt: number) => {
      if (picturing?.paneId === paneId && startedAt >= picturing.since) picturing.failed = true;
    },
    /** Saved pictures bridge camera motion before expensive view mounts resume. */
    setMoving: (next: boolean) => {
      if (moving === next) return;
      moving = next;
      for (const listener of motionListeners) listener();
      if (moving) {
        interruptPicture();
        cancelSpeculation();
        requestSettle();
      } else if (settleDue) {
        settleTimer = setTimeout(settle, 0);
      } else {
        schedule();
      }
    },
    setFocus: (paneId: string | null) => {
      const from = focused ? panes.get(focused) : undefined;
      const to = paneId ? panes.get(paneId) : undefined;
      if ((paneId !== null && !to) || paneId === focused) return;
      if (from && to) {
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
      if (paneId !== null && mounted.has(paneId)) viewed.add(paneId);
      if (paneId !== null && picturing?.paneId === paneId) {
        // A deliberate revisit takes ownership and can replace the failed content.
        picturing = null;
        pictureAttempted.delete(paneId);
      }
      cancelSpeculation();
      restartNeighborWait();
      if (settleTimer !== null) clearTimeout(settleTimer);
      settleTimer = null;
      settleDue = false;
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
      for (const paneId of mounted) if (!panes.has(paneId)) unmount(paneId);
      for (const paneId of visible) if (!panes.has(paneId)) visible.delete(paneId);
      for (const paneId of viewed) if (!panes.has(paneId)) viewed.delete(paneId);
      for (const paneId of pictureAttempted.keys()) {
        if (!panes.has(paneId)) pictureAttempted.delete(paneId);
      }
      if (picturing && !panes.has(picturing.paneId)) picturing = null;
      if (focused && !panes.has(focused)) focused = null;
      queue = queue.filter((paneId) => panes.has(paneId));
      wanted = new Set([...wanted].filter((paneId) => panes.has(paneId)));
      if (waitingFor !== null && !panes.has(waitingFor)) {
        clearCommitWait();
      }
      requestSettle();
    },
    /** Whether panes without a picture are mounted in the background to picture them. */
    setBackgroundPictures: (enabled: boolean) => {
      backgroundPictures = enabled;
      if (!enabled && picturing) {
        const { paneId, failed } = picturing;
        picturing = null;
        if (hasPicture(paneId)) pictureAttempted.delete(paneId);
        else if (!failed) {
          const attempted = pictureAttempted.get(paneId);
          if (attempted) attempted.retryAt = performance.now();
        }
        if (!wanted.has(paneId) && !visible.has(paneId) && paneId !== focused) unmount(paneId);
      }
      requestSettle();
    },
    setRunning: (next: ReadonlySet<string>) => {
      if (next.size === running.size && [...next].every((paneId) => running.has(paneId))) return;
      running = new Set(next);
      requestSettle();
    },
    setRetainedPanes: (next: ReadonlySet<string>) => {
      if (next.size === retained.size && [...next].every((paneId) => retained.has(paneId))) return;
      retained = next;
      requestSettle();
    },
    /** Tells which panes a picture shows faithfully while they are not mounted. */
    setPictures: (
      pictured: (paneId: string) => boolean,
      loaded = true,
      canPicture: (paneId: string) => boolean = () => true,
    ) => {
      hasPicture = pictured;
      const ready = loaded || storedPicturesWaited;
      const next = new Set([...panes.keys()].filter(pictured));
      const excluded = new Set([...panes.keys()].filter((paneId) => !canPicture(paneId)));
      const changed =
        ready !== picturesReady ||
        next.size !== freshPictures.size ||
        [...next].some((paneId) => !freshPictures.has(paneId)) ||
        excluded.size !== pictureExcluded.size ||
        [...excluded].some((paneId) => !pictureExcluded.has(paneId));
      picturesReady = ready;
      freshPictures = next;
      pictureExcluded = excluded;
      if (ready && storedPicturesTimer !== null) {
        clearTimeout(storedPicturesTimer);
        storedPicturesTimer = null;
      } else if (!ready && storedPicturesTimer === null) {
        storedPicturesTimer = setTimeout(() => {
          storedPicturesTimer = null;
          storedPicturesWaited = true;
          picturesReady = true;
          requestSettle();
        }, STORED_PICTURES_WAIT_MS);
      }
      if (!changed) return;
      requestSettle();
    },
    setVisible: (paneId: string, isVisible: boolean) => {
      if (visible.has(paneId) === isVisible) return;
      if (isVisible) {
        visible.add(paneId);
        if (mounted.has(paneId)) viewed.add(paneId);
      } else visible.delete(paneId);
      requestSettle();
    },
    dispose: () => {
      cancelSpeculation();
      clearCommitWait();
      picturing = null;
      motionListeners.clear();
      if (settleTimer !== null) clearTimeout(settleTimer);
      if (neighborTimer !== null) clearTimeout(neighborTimer);
      if (storedPicturesTimer !== null) clearTimeout(storedPicturesTimer);
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
  return mounted;
}
