import { createContext, startTransition, use, useEffect, useState } from "react";

import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";

const PICTURE_TIMEOUT_MS = 10_000;
const PICTURE_RETRY_MS = 5 * 60_000;
const STORED_PICTURES_WAIT_MS = 2000;

export interface PanePosition {
  readonly paneId: string;
  readonly plane: number;
  readonly slot: number;
}

export type PictureMount = "background" | "ordinary" | null;

export function createPaneLifecycleStore(
  initialPanes: readonly PanePosition[],
  focusedPaneId: string | null,
) {
  let panes = new Map(initialPanes.map((pane) => [pane.paneId, pane]));
  let focused = focusedPaneId && panes.has(focusedPaneId) ? focusedPaneId : null;
  const mounted = new Set<string>(focused ? [focused] : []);
  const visible = new Set<string>();
  const visited = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();
  const motionListeners = new Set<() => void>();
  const pointers = new Set<number>();
  const retryAt = new Map<string, number>();
  let moving = false;
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
  const admissions = new Map<string, { required: () => boolean; show: () => void }>();
  let admitting: string | null = null;
  let admissionScheduled = false;
  const drainAdmissions = () => {
    if (admissionScheduled || disposed) return;
    admissionScheduled = true;
    queueMicrotask(() => {
      admissionScheduled = false;
      if (disposed || admitting !== null) return;
      const next = [...admissions.keys()]
        .filter((id) => panes.has(id) && admissions.get(id)!.required())
        .sort(
          (a, b) => Number(b === focused) - Number(a === focused) || distance(a) - distance(b),
        )[0];
      if (!next) return;
      admitting = next;
      admissions.get(next)!.show();
    });
  };

  const notify = (paneId: string) => {
    for (const listener of listeners.get(paneId) ?? []) listener();
  };
  const mount = (paneId: string) => {
    if (!mounted.has(paneId)) {
      mounted.add(paneId);
      startTransition(() => notify(paneId));
    }
  };
  const unmount = (paneId: string) => {
    if (mounted.delete(paneId)) notify(paneId);
    if (admitting === paneId) {
      admitting = null;
      admissions.delete(paneId);
      drainAdmissions();
    }
  };
  const cancel = () => {
    if (timer !== null) clearTimeout(timer);
    if (idle !== null) cancelIdleCallback(idle);
    timer = null;
    idle = null;
  };
  const retained = () => {
    const ids = new Set(visible);
    if (!focused) return ids;
    ids.add(focused);
    const center = panes.get(focused);
    if (!center) return ids;
    const positions = [...panes.values()];
    for (const [axis, direction] of [
      ["slot", -1],
      ["slot", 1],
      ["plane", -1],
      ["plane", 1],
    ] as const) {
      const other = axis === "slot" ? "plane" : "slot";
      const neighbour = positions
        .filter(
          (pane) => pane[other] === center[other] && (pane[axis] - center[axis]) * direction > 0,
        )
        .sort((a, b) => Math.abs(a[axis] - center[axis]) - Math.abs(b[axis] - center[axis]))[0];
      if (neighbour) ids.add(neighbour.paneId);
    }
    return ids;
  };
  const reconcile = () => {
    const keep = retained();
    for (const id of keep) if (panes.has(id)) mount(id);
    for (const id of mounted)
      if (!keep.has(id) && id !== capturing?.paneId && hasPicture(id)) unmount(id);
  };
  const release = (retry: boolean) => {
    if (!capturing) return;
    const { paneId } = capturing;
    capturing = null;
    if (hasPicture(paneId) || retry) retryAt.delete(paneId);
    if (!retained().has(paneId) && hasPicture(paneId)) unmount(paneId);
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
          !hasPicture(id) &&
          canPicture(id, visited.has(id)) &&
          (retryAt.get(id) ?? 0) <= performance.now(),
      )
      .sort(
        (a, b) =>
          Number(visible.has(b)) - Number(visible.has(a)) ||
          Number(hasCover(a)) - Number(hasCover(b)) ||
          distance(a) - distance(b),
      )[0];
  const schedule = () => {
    cancel();
    if (disposed) return;
    reconcile();
    if (moving || pointers.size > 0) return;
    if (focused && panes.has(focused)) mount(focused);
    if (!backgroundPictures || !picturesReady) return;
    if (capturing) {
      if (hasPicture(capturing.paneId) || !panes.has(capturing.paneId)) release(false);
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
      if (moving || pointers.size > 0) return;
      if (deadline.didTimeout || deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
        timer = setTimeout(schedule, 100);
        return;
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
  return {
    isMounted: (paneId: string) => mounted.has(paneId),
    isMoving: () => moving || pointers.size > 0,
    currentPicture: (paneId: string) => hasPicture(paneId),
    requestAdmission: (paneId: string, required: () => boolean, show: () => void) => {
      admissions.set(paneId, { required, show });
      drainAdmissions();
      return () => {
        if (admitting !== paneId) admissions.delete(paneId);
        drainAdmissions();
      };
    },
    contentMounted: (paneId: string) => {
      admissions.delete(paneId);
      if (admitting === paneId) admitting = null;
      drainAdmissions();
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
      if (moving) {
        cancel();
        release(true);
      } else {
        schedule();
      }
      for (const listener of motionListeners) listener();
      drainAdmissions();
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
      drainAdmissions();
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
      admissions.clear();
      cancel();
      if (storedTimer !== null) clearTimeout(storedTimer);
      for (const type of inputEvents)
        window.removeEventListener(type, noteInput, { capture: true });
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
    const sync = () => setMounted(store.isMounted(paneId));
    sync();
    return store.subscribe(paneId, sync);
  }, [store, paneId]);
  useEffect(() => {
    store?.setVisible(paneId, visible);
  }, [store, paneId, visible]);
  return mounted;
}
