import { createContext, startTransition, use, useEffect, useState } from "react";

import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";

const MAX_MOUNTED = 10;
const QUIET_MS = 500;

const PICTURE_TIMEOUT_MS = 10_000;
const PICTURE_RETRY_MS = 5 * 60_000;
const STORED_PICTURES_WAIT_MS = 2000;
const HISTORY_LIMIT = 200;

export interface PanePosition {
  readonly paneId: string;
  readonly plane: number;
  readonly slot: number;
}

export type PictureMount = "background" | "ordinary" | null;

export function createPaneLifecycleStore(
  initialPanes: readonly PanePosition[],
  focusedPaneId: string | null,
  maxMounted = MAX_MOUNTED,
) {
  let panes = new Map(initialPanes.map((pane) => [pane.paneId, pane]));
  let focused = focusedPaneId && panes.has(focusedPaneId) ? focusedPaneId : null;
  const mounted = new Set<string>(focused ? [focused] : []);
  const visible = new Set<string>();
  const loaded = new Set<string>();
  let quietSince = performance.now();
  const visited = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const motionListeners = new Set<() => void>();
  const pointers = new Set<number>();
  const retryAt = new Map<string, number>();
  const chats = new Map<string, () => string | null>();
  const motionDecisions = new Map<string, string | null>();
  const deferred = new Set<string>();
  const pendingComposers = new Set<string>();
  const arrivals: {
    paneId: string;
    inputAt: number;
    composerTypeableAt?: number;
    timelineInteractiveAt?: number;
  }[] = [];
  const moves: {
    inputAt: number;
    removed: string[];
    latched: { paneId: string; reason: string }[];
  }[] = [];
  let inputAt = performance.now();
  let arrivalInputAt = inputAt;
  let arrivalFrame: number | null = null;
  let removalFrame: number | null = null;
  let moving = false;
  let keepNeighbours = false;
  let backgroundPictures = false;
  let picturesReady = true;
  let storedTimer: ReturnType<typeof setTimeout> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  let hasPicture: (paneId: string) => boolean = () => false;
  let hasCover: (paneId: string) => boolean = () => false;
  let canPicture: (paneId: string, visited: boolean) => boolean = () => true;
  let capturing: { paneId: string; since: number } | null = null;
  let disposed = false;

  const notify = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) listener();
  };
  const mount = (paneId: string) => {
    if (!mounted.has(paneId)) {
      mounted.add(paneId);
      if (chats.has(paneId) && retained().has(paneId)) {
        deferred.add(paneId);
        pendingComposers.add(paneId);
        arrivals.push({ paneId, inputAt: arrivalInputAt });
        if (arrivals.length > HISTORY_LIMIT) arrivals.shift();
      } else deferred.delete(paneId);
      startTransition(() => notify(paneId));
    }
  };
  const unmount = (paneId: string) => {
    loaded.delete(paneId);
    pendingComposers.delete(paneId);
    if (chats.has(paneId)) deferred.add(paneId);
    if (mounted.delete(paneId)) notify(paneId);
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    if (idle !== null) cancelIdleCallback(idle);
    timer = null;
    idle = null;
  };
  const retained = () => {
    if (!focused) return new Set([...visible].filter((id) => !hasPicture(id)));
    const ids = new Set(visible);
    ids.add(focused);
    if (keepNeighbours)
      for (const id of panes.keys()) if ([1, 1000].includes(distance(id))) ids.add(id);
    return ids;
  };
  const reconcile = () => {
    const keep = retained();
    if (moving || pointers.size > 0) return;
    for (const id of pendingComposers) if (!keep.has(id)) pendingComposers.delete(id);
    if (focused && keep.has(focused)) mount(focused);
    if (focused && pendingComposers.has(focused)) return;
    for (const id of keep) if (panes.has(id)) mount(id);
    if (performance.now() - quietSince < QUIET_MS) return;
    for (const id of [...mounted].sort((a, b) => distance(b) - distance(a))) {
      if (mounted.size <= Math.max(maxMounted, keep.size)) break;
      if (!keep.has(id) && id !== capturing?.paneId && hasPicture(id) && !chats.get(id)?.())
        unmount(id);
    }
  };
  const release = (retry: boolean) => {
    if (!capturing) return;
    const { paneId } = capturing;
    capturing = null;
    if (hasPicture(paneId) || retry) retryAt.delete(paneId);
  };
  const distance = (paneId: string) => {
    const center = focused ? panes.get(focused) : undefined;
    const pane = panes.get(paneId)!;
    return (
      Math.abs(pane.plane - (center?.plane ?? 0)) * 1000 + Math.abs(pane.slot - (center?.slot ?? 0))
    );
  };
  const nextPicture = () =>
    [...panes.keys()]
      .filter(
        (id) =>
          !mounted.has(id) &&
          !visible.has(id) &&
          (hasPicture(id) || canPicture(id, visited.has(id))) &&
          (retryAt.get(id) ?? 0) <= performance.now(),
      )
      .sort(
        (a, b) =>
          distance(a) - distance(b) ||
          Number(hasCover(a)) - Number(hasCover(b)),
      )[0];
  const revealTimelines = () => {
    if (![...mounted].some((id) => deferred.has(id))) return;
    if (moving || pendingComposers.size > 0 || arrivalFrame !== null) return;
    arrivalFrame = requestAnimationFrame(() => {
      arrivalFrame = requestAnimationFrame(() => {
        arrivalFrame = null;
        if (moving || pendingComposers.size > 0) return;
        const next = [...mounted]
          .filter((id) => deferred.has(id))
          .sort((a, b) => distance(a) - distance(b))[0];
        if (next !== undefined && deferred.delete(next)) notify(next);
        schedule();
      });
    });
  };
  const schedule = () => {
    cancel();
    if (disposed) return;
    reconcile();
    revealTimelines();
    if (moving || pointers.size > 0) return;
    const quietRemaining = QUIET_MS - (performance.now() - quietSince);
    if (quietRemaining > 0) {
      timer = setTimeout(schedule, quietRemaining);
      return;
    }
    if (focused && panes.has(focused)) mount(focused);
    if (
      pendingComposers.size > 0 ||
      [...mounted].some((id) => deferred.has(id)) ||
      !backgroundPictures ||
      !picturesReady
    )
      return;
    if (capturing) {
      if (
        (loaded.has(capturing.paneId) && hasPicture(capturing.paneId)) ||
        !panes.has(capturing.paneId)
      )
        release(false);
      else if (performance.now() - capturing.since >= PICTURE_TIMEOUT_MS) release(false);
      else {
        timer = setTimeout(schedule, 100);
        return;
      }
    }
    const paneId = nextPicture();
    if (!paneId) {
      const retry = Math.min(
        ...[...retryAt]
          .filter(([id]) => panes.has(id) && !hasPicture(id) && canPicture(id, visited.has(id)))
          .map(([, at]) => at),
      );
      if (retry > performance.now() && Number.isFinite(retry))
        timer = setTimeout(schedule, retry - performance.now());
      return;
    }
    idle = requestIdleCallback((deadline) => {
      idle = null;
      if (moving || pointers.size > 0 || performance.now() - quietSince < QUIET_MS) return;
      if (deadline.didTimeout || deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
        timer = setTimeout(schedule, 100);
        return;
      }
      if (mounted.size >= maxMounted) {
        const keep = retained();
        const farthest = [...mounted]
          .filter((id) => !keep.has(id) && hasPicture(id) && !chats.get(id)?.())
          .sort((a, b) => distance(b) - distance(a))[0];
        if (!farthest || distance(farthest) <= distance(paneId)) return;
        unmount(farthest);
      }
      const since = performance.now();
      capturing = { paneId, since };
      retryAt.set(paneId, since + PICTURE_RETRY_MS);
      mount(paneId);
      timer = setTimeout(schedule, 100);
    });
  };
  const noteInput = (event: Event) => {
    if (event.type === "blur" && event.target !== window) return;
    if (event.type === "pointerdown") pointers.add((event as PointerEvent).pointerId);
    else if (event.type === "blur") pointers.clear();
    else if (["pointerup", "pointercancel", "lostpointercapture"].includes(event.type))
      pointers.delete((event as PointerEvent).pointerId);
    inputAt = performance.now();
    quietSince = inputAt;
    cancel();
    release(true);
    for (const listener of motionListeners) listener();
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
  for (const type of inputEvents)
    window.addEventListener(type, noteInput, { capture: true, passive: true });

  reconcile();
  const store = {
    registerChat: (paneId: string, prepare: () => string | null) => {
      chats.set(paneId, prepare);
      return () => {
        chats.delete(paneId);
        deferred.delete(paneId);
        pendingComposers.delete(paneId);
        schedule();
      };
    },
    motionDecision: (paneId: string) => motionDecisions.get(paneId),
    timelineDeferred: (paneId: string) => deferred.has(paneId),
    composerReady: (paneId: string) => {
      if (!pendingComposers.delete(paneId)) return;
      schedule();
    },
    recordReady: (paneId: string, kind: "composerTypeableAt" | "timelineInteractiveAt") => {
      const arrival = arrivals.findLast((entry) => entry.paneId === paneId);
      if (arrival && arrival[kind] === undefined) arrival[kind] = performance.now();
    },
    measurements: () => ({
      arrivals: arrivals.map((entry) => ({ ...entry })),
      moves: moves.map((entry) => ({
        ...entry,
        removed: [...entry.removed],
        latched: entry.latched.map((item) => ({ ...item })),
      })),
    }),
    isMounted: (paneId: string) => mounted.has(paneId),
    isMoving: () => moving || pointers.size > 0,
    isCameraMoving: () => moving,
    currentPicture: (paneId: string) => hasPicture(paneId),
    contentMounted: (paneId: string) => {
      loaded.add(paneId);
    },
    pictureMount: (paneId: string): PictureMount =>
      !mounted.has(paneId) ? null : capturing?.paneId === paneId ? "background" : "ordinary",
    subscribeMotion: (listener: () => void) => {
      motionListeners.add(listener);
      return () => {
        motionListeners.delete(listener);
      };
    },
    subscribe: (paneId: string, listener: () => void) => {
      let entries = listeners.get(paneId);
      if (!entries) listeners.set(paneId, (entries = new Set()));
      entries.add(listener);
      return () => {
        entries.delete(listener);
      };
    },
    pictureFailed: (paneId: string, startedAt: number) => {
      if (capturing?.paneId === paneId && startedAt >= capturing.since) {
        release(false);
        schedule();
      }
    },
    setMoving: (next: boolean) => {
      if (moving === next) return;
      moving = next;
      quietSince = performance.now();
      if (moving) {
        arrivalInputAt = inputAt;
        if (arrivalFrame !== null) cancelAnimationFrame(arrivalFrame);
        arrivalFrame = null;
        motionDecisions.clear();
        const move = {
          inputAt,
          removed: [] as string[],
          latched: [] as { paneId: string; reason: string }[],
        };
        const removable: string[] = [];
        for (const id of mounted) {
          const prepare = chats.get(id);
          if (!prepare) continue;
          const reason = prepare();
          motionDecisions.set(id, reason);
          if (reason === null) removable.push(id);
          else move.latched.push({ paneId: id, reason });
        }
        moves.push(move);
        if (moves.length > HISTORY_LIMIT) moves.shift();
        if (removable.length > 0)
          removalFrame = requestAnimationFrame(() => {
            removalFrame = requestAnimationFrame(() => {
              removalFrame = null;
              if (moving)
                for (const id of removable) {
                  unmount(id);
                  move.removed.push(id);
                }
            });
          });
        cancel();
        release(true);
      } else {
        if (removalFrame !== null) cancelAnimationFrame(removalFrame);
        removalFrame = null;
        const move = moves.at(-1);
        for (const [paneId, reason] of motionDecisions)
          if (reason === null && mounted.has(paneId))
            move?.latched.push({ paneId, reason: "motion-ended-before-removal" });
        motionDecisions.clear();
        schedule();
      }
      for (const listener of motionListeners) listener();
    },
    setKeepNeighbours: (next: boolean) => {
      if (keepNeighbours === next) return;
      keepNeighbours = next;
      reconcile();
    },
    setFocus: (paneId: string | null) => {
      if (focused === paneId || (paneId !== null && !panes.has(paneId))) return;
      focused = paneId;
      if (capturing?.paneId === focused) {
        capturing = null;
        retryAt.delete(paneId!);
      }
      reconcile();
      schedule();
    },
    setPanes: (next: readonly PanePosition[]) => {
      panes = new Map(next.map((pane) => [pane.paneId, pane]));
      if (focused && !panes.has(focused)) focused = null;
      if (capturing && !panes.has(capturing.paneId)) release(false);
      for (const id of mounted) if (!panes.has(id)) unmount(id);
      for (const id of retryAt.keys()) if (!panes.has(id)) retryAt.delete(id);
      schedule();
    },
    setBackgroundPictures: (enabled: boolean) => {
      backgroundPictures = enabled;
      if (!enabled) release(true);
      schedule();
    },
    setPictures: (
      pictured: (paneId: string) => boolean,
      loaded = true,
      eligible: (paneId: string, visited: boolean) => boolean = () => true,
      covered: (paneId: string) => boolean = pictured,
    ) => {
      hasPicture = pictured;
      hasCover = covered;
      canPicture = eligible;
      picturesReady = loaded;
      if (loaded && storedTimer !== null) {
        clearTimeout(storedTimer);
        storedTimer = null;
      } else if (!loaded && storedTimer === null)
        storedTimer = setTimeout(() => {
          storedTimer = null;
          picturesReady = true;
          schedule();
        }, STORED_PICTURES_WAIT_MS);
      schedule();
      for (const listener of motionListeners) listener();
    },
    setVisible: (paneId: string, isVisible: boolean) => {
      if (isVisible) {
        visible.add(paneId);
        visited.add(paneId);
      } else visible.delete(paneId);
      schedule();
    },
    dispose: () => {
      disposed = true;
      if (arrivalFrame !== null) cancelAnimationFrame(arrivalFrame);
      if (removalFrame !== null) cancelAnimationFrame(removalFrame);
      cancel();
      if (storedTimer !== null) clearTimeout(storedTimer);
      for (const type of inputEvents)
        window.removeEventListener(type, noteInput, { capture: true });
    },
  };
  return store;
}

export type PaneLifecycleStore = ReturnType<typeof createPaneLifecycleStore>;

export const PaneLifecycleContext = createContext<PaneLifecycleStore | null>(null);

export function usePaneMounted(paneId: string, visible: boolean): boolean {
  const store = use(PaneLifecycleContext);
  const [mounted, setMounted] = useState(() => store?.isMounted(paneId) ?? true);
  useEffect(() => {
    if (!store) return;
    const sync = () => setMounted(store.isMounted(paneId));
    sync();
    return store.subscribe(paneId, sync);
  }, [store, paneId]);
  useEffect(() => {
    store?.setVisible(paneId, visible);
  }, [store, paneId, visible]);
  return mounted;
}
