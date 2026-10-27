import { createContext, startTransition, use, useEffect, useState } from "react";

import {
  BACKGROUND_PICTURE_QUIET_MS,
  PICTURE_IDLE_BUDGET_MS,
  observePicturePressure,
} from "./panePictureIdle";

const NEIGHBORS = 4;
// Remounting a conversation costs far more than keeping it: editor, list measurement and
// transcript work dominate arrival. Repeated tours of a typical workspace stay mounted.
const MAX_MOUNTED = 32;
const SETTLE_MS = 200;
const NEIGHBOR_SETTLE_MS = 600;
const INPUT_QUIET_MS = 400;
// Preparing views ahead keeps visits warm; a long frame pauses it only briefly.
const MOUNT_PRESSURE_QUIET_MS = 500;
const COMMIT_TIMEOUT_MS = 2000;
const STORED_PICTURES_WAIT_MS = 2000;
const PICTURE_TIMEOUT_MS = 10_000;
const PICTURE_RETRY_MS = 5 * 60_000;

export interface PanePosition {
  readonly paneId: string;
  readonly plane: number;
  readonly slot: number;
}

type Direction = "left" | "right" | "up" | "down";

export type PictureMount = "background" | "ordinary" | null;

export function createPaneLifecycleStore(
  initialPanes: readonly PanePosition[],
  focusedPaneId: string | null,
  maxMounted = MAX_MOUNTED,
  prepareAhead = true,
) {
  let panes = new Map(initialPanes.map((pane) => [pane.paneId, pane]));
  let focused =
    focusedPaneId && panes.has(focusedPaneId) ? focusedPaneId : (initialPanes[0]?.paneId ?? null);
  let direction: Direction | null = null;
  let running: ReadonlySet<string> = new Set();
  let retained: ReadonlySet<string> = new Set();
  const visible = new Set<string>();
  const mounted = new Set<string>(focused ? [focused] : []);
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
  const pointers = new Set<number>();
  let busyUntil = 0;
  let pictureBusyUntil = 0;
  let clock = 0;
  let hasPicture: (paneId: string) => boolean = () => false;
  let canPicture: (paneId: string, visited: boolean) => boolean = () => true;
  const unpicturedVisits = new Set<string>();
  let freshPictures = new Set<string>();
  let pictureExcluded = new Set<string>();
  let picturesReady = true;
  let storedPicturesTimer: ReturnType<typeof setTimeout> | null = null;
  let storedPicturesWaited = false;
  let picturing: {
    paneId: string;
    since: number;
    interrupted: boolean;
    failed: boolean;
  } | null = null;
  const pictureAttempted = new Map<string, { since: number; retryAt: number }>();
  let pictureTimer: ReturnType<typeof setTimeout> | null = null;
  let backgroundPictures = false;
  let backgroundQuietFrom = performance.now();
  const pictureEligible = (paneId: string) => canPicture(paneId, unpicturedVisits.has(paneId));

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

  const mustRetain = (paneId: string) =>
    (retained.has(paneId) || running.has(paneId)) && viewed.has(paneId);

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

  const reservePicture = (paneId: string) => {
    const since = performance.now();
    picturing = { paneId, since, interrupted: false, failed: false };
    pictureAttempted.set(paneId, { since, retryAt: since + PICTURE_RETRY_MS });
  };

  const interruptPicture = () => {
    if (picturing && performance.now() - picturing.since < PICTURE_TIMEOUT_MS) {
      picturing.interrupted = true;
    }
  };

  const evictBeyond = (limit: number, keep: ReadonlySet<string>) => {
    picturingPending();
    const paneId = evictionCandidate(limit + (picturing ? 1 : 0), keep);
    if (paneId !== null) unmount(paneId);
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

  const nextToPicture = (): string | null => {
    if (!backgroundPictures || !picturesReady) return null;
    const center = focused ? panes.get(focused) : undefined;
    let best: string | null = null;
    let bestAttempt = Infinity;
    let bestVisited = false;
    let bestDistance = Infinity;
    for (const pane of panes.values()) {
      if (mounted.has(pane.paneId)) continue;
      if (!pictureEligible(pane.paneId)) continue;
      const attempted = pictureAttempted.get(pane.paneId);
      if (attempted !== undefined && performance.now() < attempted.retryAt) continue;
      if (hasPicture(pane.paneId)) continue;
      const since = attempted?.since ?? -Infinity;
      const visited = unpicturedVisits.has(pane.paneId);
      const distance = center
        ? Math.abs(pane.plane - center.plane) * 1000 + Math.abs(pane.slot - center.slot)
        : 0;
      if (
        since < bestAttempt ||
        (since === bestAttempt &&
          ((visited && !bestVisited) || (visited === bestVisited && distance < bestDistance)))
      ) {
        bestAttempt = since;
        bestVisited = visited;
        bestDistance = distance;
        best = pane.paneId;
      }
    }
    return best;
  };

  const picturingPending = () => {
    if (!picturing) return false;
    const { paneId, since } = picturing;
    const done =
      retained.has(paneId) ||
      hasPicture(paneId) ||
      !panes.has(paneId) ||
      performance.now() - since >= PICTURE_TIMEOUT_MS;
    if (!done) return true;
    releasePicture(paneId, picturing.interrupted && !picturing.failed);
    return false;
  };

  const releasePicture = (paneId: string, retry: boolean) => {
    picturing = null;
    if (hasPicture(paneId)) pictureAttempted.delete(paneId);
    else if (retry) {
      const attempted = pictureAttempted.get(paneId);
      if (attempted) attempted.retryAt = performance.now();
    }
    // A pictured view stays mounted within the budget so visiting it is a warm arrival;
    // eviction releases pictured views first.
    if (!hasPicture(paneId) && !wanted.has(paneId) && !visible.has(paneId) && paneId !== focused)
      unmount(paneId);
  };

  const visibleQueued = () => queue.some((paneId) => visible.has(paneId) && !mounted.has(paneId));

  const schedule = () => {
    if (moving) return;
    if (
      waitingFor !== null &&
      waitingFor !== focused &&
      !visible.has(waitingFor) &&
      visibleQueued()
    ) {
      clearCommitWait();
    }
    if (waitingFor !== null || idleCallback !== null || quietTimer !== null) return;
    if (pictureTimer !== null) return;
    if (
      queue.length === 0 &&
      picturing === null &&
      nextToPicture() === null &&
      evictionCandidate(maxMounted + (picturing ? 1 : 0), wanted) === null
    ) {
      const retryAt =
        backgroundPictures && picturesReady
          ? Math.min(
              ...[...pictureAttempted].flatMap(([paneId, attempted]) =>
                panes.has(paneId) &&
                !mounted.has(paneId) &&
                pictureEligible(paneId) &&
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
    if (pointers.size > 0) return;
    const wait = Math.max(lastInput + INPUT_QUIET_MS, busyUntil) - performance.now();
    if (wait > 0) {
      quietTimer = setTimeout(() => {
        quietTimer = null;
        schedule();
      }, wait);
      return;
    }
    idleCallback = requestIdleCallback(advance);
  };

  const advance = (deadline?: IdleDeadline) => {
    idleCallback = null;
    if (moving) return;
    queue = queue.filter((paneId) => panes.has(paneId) && !mounted.has(paneId));
    if (!visibleQueued()) {
      if (pointers.size > 0) return;
      if (
        performance.now() < Math.max(lastInput + INPUT_QUIET_MS, busyUntil) ||
        (deadline && (deadline.didTimeout || deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS))
      ) {
        schedule();
        return;
      }
    }
    picturingPending();
    if (queue.length > 0) {
      const visibleIndex = queue.findIndex((paneId) => visible.has(paneId));
      const paneId = queue.splice(Math.max(0, visibleIndex), 1)[0]!;
      evictBeyond(maxMounted - 1, wanted);
      mountPrepared(paneId);
      return;
    }
    const retiring = evictionCandidate(maxMounted + (picturing ? 1 : 0), wanted);
    if (retiring !== null) {
      waitForCommit(retiring);
      mounted.delete(retiring);
      viewed.delete(retiring);
      notify(retiring);
      return;
    }
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
    const wait =
      Math.max(
        Math.max(lastInput, backgroundQuietFrom) + BACKGROUND_PICTURE_QUIET_MS,
        pictureBusyUntil,
      ) - now;
    if (wait > 0) {
      waitForPicture(wait);
      return;
    }
    const retainedCount = [...mounted].filter(
      (paneId) => panes.has(paneId) && mustRetain(paneId) && paneId !== focused,
    ).length;
    if (mounted.size >= Math.max(maxMounted, retainedCount + (focused ? 1 : 0)) + 1) return;
    reservePicture(paneId);
    mountPrepared(paneId);
  };

  const nearestInDirection = (center: PanePosition, dir: Direction): string | null => {
    const horizontal = dir === "left" || dir === "right";
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const pane of panes.values()) {
      if (visible.has(pane.paneId)) continue;
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
      return;
    }
    settleDue = false;
    clock += 1;
    const required = new Set([
      ...(focused ? [focused] : []),
      ...[...visible]
        .filter((paneId) => panes.has(paneId))
        .toSorted((a, b) => distance(a) - distance(b)),
      ...[...mounted].filter((paneId) => panes.has(paneId) && mustRetain(paneId)),
    ]);
    // Once the focused pane has settled, prepare every pane, neighbours first, so any
    // later visit is a warm arrival; the mount budget bounds how many stay mounted.
    const nearby = (
      neighborsWanted && prepareAhead
        ? [...neighbors(), ...[...panes.keys()].toSorted((a, b) => distance(a) - distance(b))]
        : neighbors()
    ).filter((paneId) => neighborsWanted || mounted.has(paneId));
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
      ...speculative.slice(0, Math.max(0, maxMounted - required.size)),
    ]);
    for (const paneId of wanted) lastWanted.set(paneId, clock);
    if (focused && panes.has(focused) && !mounted.has(focused)) {
      mountPrepared(focused);
      evictBeyond(maxMounted, wanted);
    }
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

  const noteInput = (event: Event) => {
    if (event.type === "blur" && event.target !== window) return;
    lastInput = performance.now();
    if (event.type === "pointerdown") pointers.add((event as PointerEvent).pointerId);
    else if (event.type === "blur") pointers.clear();
    else if (
      event.type === "pointerup" ||
      event.type === "pointercancel" ||
      event.type === "lostpointercapture"
    )
      pointers.delete((event as PointerEvent).pointerId);
    interruptPicture();
    if (event.type !== "keydown" && event.type !== "wheel" && event.type !== "pointerdown")
      schedule();
  };
  const inputEvents = [
    "keydown",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "wheel",
    "blur",
  ] as const;
  for (const type of inputEvents) {
    window.addEventListener(type, noteInput, { capture: true, passive: true });
  }
  const stopObservingPressure = observePicturePressure((finishedAt) => {
    busyUntil = Math.max(busyUntil, finishedAt + MOUNT_PRESSURE_QUIET_MS);
    pictureBusyUntil = Math.max(pictureBusyUntil, finishedAt + BACKGROUND_PICTURE_QUIET_MS);
    schedule();
  });

  restartNeighborWait();

  return {
    isMounted: (paneId: string) => mounted.has(paneId),
    isMoving: () => moving,
    pictureMount: (paneId: string): PictureMount =>
      !mounted.has(paneId) ? null : picturing?.paneId === paneId ? "background" : "ordinary",
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
    committed: (paneId: string, isMounted: boolean) => {
      if (waitingFor !== paneId || isMounted !== mounted.has(paneId)) return;
      clearCommitWait();
      schedule();
    },
    pictureFailed: (paneId: string, startedAt: number) => {
      if (picturing?.paneId === paneId && startedAt >= picturing.since) picturing.failed = true;
    },
    setMoving: (next: boolean) => {
      if (moving === next) return;
      moving = next;
      for (const listener of motionListeners) listener();
      if (moving) {
        interruptPicture();
        cancelSpeculation();
        requestSettle();
        return;
      }
      backgroundQuietFrom = performance.now();
      if (settleDue) settleTimer = setTimeout(settle, 0);
      else schedule();
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
      for (const paneId of unpicturedVisits) {
        if (!panes.has(paneId)) unpicturedVisits.delete(paneId);
      }
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
    setBackgroundPictures: (enabled: boolean) => {
      if (enabled && !backgroundPictures) backgroundQuietFrom = performance.now();
      backgroundPictures = enabled;
      if (!enabled && picturing) releasePicture(picturing.paneId, !picturing.failed);
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
    setPictures: (
      pictured: (paneId: string) => boolean,
      loaded = true,
      eligible: (paneId: string, visited: boolean) => boolean = () => true,
    ) => {
      hasPicture = pictured;
      canPicture = eligible;
      const ready = loaded || storedPicturesWaited;
      const next = new Set([...panes.keys()].filter(pictured));
      for (const paneId of next) unpicturedVisits.delete(paneId);
      const excluded = new Set([...panes.keys()].filter((paneId) => !pictureEligible(paneId)));
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
        if (panes.has(paneId) && !hasPicture(paneId)) unpicturedVisits.add(paneId);
        if (mounted.has(paneId)) viewed.add(paneId);
      } else visible.delete(paneId);
      requestSettle();
    },
    dispose: () => {
      stopObservingPressure();
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
