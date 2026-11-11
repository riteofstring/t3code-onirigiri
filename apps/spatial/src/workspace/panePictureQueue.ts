import type { PictureMount } from "./paneLifecycle";
import { PICTURE_IDLE_BUDGET_MS } from "./panePictureIdle";

// Measuring inside a pane whose contents are unrendered forces the browser to style them all, so a
// chat is placed by its pane's box.
function paneBox(element: HTMLElement) {
  return (element.closest?.('[data-onirigiri-slot="pane"]') ?? element).getBoundingClientRect();
}

export function onScreen(element: HTMLElement): boolean {
  const view = element.ownerDocument?.defaultView;
  if (!view || typeof element.getBoundingClientRect !== "function") return false;
  const box = paneBox(element);
  const stage = element.closest?.('[data-onirigiri-slot="stage"]')?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
    right: view.innerWidth,
    bottom: view.innerHeight,
  };
  return (
    box.right > stage.left &&
    box.bottom > stage.top &&
    box.left < stage.right &&
    box.top < stage.bottom
  );
}

const SNAPSHOT_RETRY_MS = 3000;
const FIRST_PICTURE_INPUT_QUIET_MS = 250;
const SNAPSHOT_RETRY_LIMIT_MS = 5 * 60_000;

function distanceFromCenter(element: HTMLElement) {
  const { left, top, width, height } = paneBox(element);
  return Math.hypot(
    left + width / 2 - window.innerWidth / 2,
    top + height / 2 - window.innerHeight / 2,
  );
}

export function createSnapshotQueue() {
  type Draw = (
    paneId: string,
    element: HTMLElement,
    canStart: () => boolean,
    waitToDraw: () => Promise<boolean>,
    signal: AbortSignal,
  ) => Promise<void | (() => unknown)>;
  const pending = new Map<
    string,
    { element: HTMLElement; after: number; retryAfter: number; background: boolean }
  >();
  let draw: Draw | null = null;
  const finished: (() => unknown)[] = [];
  let needsPicture: (paneId: string) => boolean = () => false;
  let hasSavedPixels: (paneId: string) => boolean = () => false;
  let mountOf: (paneId: string) => PictureMount = () => "ordinary";
  let focusedAt: (paneId: string) => number = () => 0;
  let enabled = true;
  let moving = false;
  let covered = false;
  let drawing = false;
  let continuation: {
    paneId: string;
    background: boolean;
    resolve: (admitted: boolean) => void;
    cancel: () => void;
    drop: () => void;
  } | null = null;
  let idle: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastInput = performance.now();
  let activeCapture: AbortController | null = null;
  const pointers = new Set<number>();
  const noteInput = (event?: Event) => {
    if (event?.type === "blur" && event.target !== window) return;
    const navigation =
      event instanceof KeyboardEvent &&
      event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      event.key.startsWith("Arrow");
    if (!navigation) lastInput = performance.now();
    activeCapture?.abort();
    continuation?.cancel();
    continuation = null;
    if (event?.type === "pointerdown") pointers.add((event as PointerEvent).pointerId);
    else if (
      event?.type === "pointerup" ||
      event?.type === "pointercancel" ||
      event?.type === "lostpointercapture"
    )
      pointers.delete((event as PointerEvent).pointerId);
    else if (event?.type === "blur") pointers.clear();
    cancelScheduled();
    if (event) next();
  };
  const inputEvents = [
    "keydown",
    "beforeinput",
    "input",
    "compositionstart",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "wheel",
    "blur",
  ] as const;
  const shown = (element: HTMLElement) => !covered && onScreen(element);
  const cancelScheduled = () => {
    if (idle !== null) cancelIdleCallback(idle);
    if (timer !== null) clearTimeout(timer);
    idle = null;
    timer = null;
  };
  const next = () => {
    if (
      !enabled ||
      moving ||
      pointers.size > 0 ||
      (drawing && !continuation) ||
      idle !== null ||
      timer !== null ||
      (!continuation && pending.size === 0 && finished.length === 0) ||
      !draw
    )
      return;
    const current = draw;
    idle = requestIdleCallback((deadline) => {
      idle = null;
      if (draw !== current) return;
      const save = finished.shift();
      if (save) {
        drawing = true;
        void Promise.resolve()
          .then(save)
          .catch(() => {})
          .finally(() => {
            drawing = false;
            next();
          });
        return;
      }
      if (!continuation && pending.size === 0) return;
      if (continuation && mountOf(continuation.paneId) === null) {
        const abandoned = continuation;
        continuation = null;
        abandoned.drop();
        return;
      }
      if (deadline.timeRemaining() < 4) {
        next();
        return;
      }
      const now = performance.now();
      const due = ([_paneId, request]: [string, { after: number; background: boolean }]) =>
        Math.max(lastInput + FIRST_PICTURE_INPUT_QUIET_MS, request.after);
      if (continuation) {
        const resumeAt = lastInput + FIRST_PICTURE_INPUT_QUIET_MS;
        if (
          continuation.background &&
          [...pending].some((candidate) => !candidate[1].background && due(candidate) <= resumeAt)
        ) {
          const yielding = continuation;
          continuation = null;
          yielding.cancel();
          return;
        }
        if (resumeAt > now) {
          timer = setTimeout(() => {
            timer = null;
            next();
          }, resumeAt - now);
          return;
        }
        if (continuation.background && deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
          next();
          return;
        }
        const resume = continuation;
        continuation = null;
        resume.resolve(true);
        return;
      }
      const offScreen = [...pending].filter(([, request]) => !shown(request.element));
      if (offScreen.length === 0) return;
      const dueRequests = offScreen.filter((candidate) => due(candidate) <= now);
      const priority = ([paneId, request]: (typeof dueRequests)[number]) =>
        request.background ? 2 : hasSavedPixels(paneId) ? 1 : 0;
      const [paneId, request] = dueRequests.length
        ? dueRequests.sort(
            (a, b) =>
              priority(a) - priority(b) ||
              focusedAt(b[0]) - focusedAt(a[0]) ||
              distanceFromCenter(a[1].element) - distanceFromCenter(b[1].element),
          )[0]!
        : offScreen.reduce((first, candidate) => (due(candidate) < due(first) ? candidate : first));
      const wait = due([paneId, request]) - now;
      if (wait > 0) {
        timer = setTimeout(() => {
          timer = null;
          next();
        }, wait);
        return;
      }
      if (request.background && deadline.timeRemaining() < PICTURE_IDLE_BUDGET_MS) {
        next();
        return;
      }
      pending.delete(paneId);
      const owner = mountOf(paneId);
      if (owner === null) {
        next();
        return;
      }
      drawing = true;
      const controller = new AbortController();
      activeCapture = controller;
      const background = request.background && owner === "background";
      let deferred = false;
      let dropped = false;
      const canStart = () => {
        if (mountOf(paneId) === null) dropped = true;
        else if (
          controller.signal.aborted ||
          !enabled ||
          moving ||
          pointers.size > 0 ||
          performance.now() - lastInput < FIRST_PICTURE_INPUT_QUIET_MS
        )
          deferred = true;
        return !deferred && !dropped && draw === current;
      };
      const waitToDraw = () => {
        if (draw !== current || controller.signal.aborted) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          continuation = {
            paneId,
            background,
            resolve,
            cancel: () => {
              deferred = true;
              resolve(false);
            },
            drop: () => {
              dropped = true;
              resolve(false);
            },
          };
          next();
        });
      };
      void current(paneId, request.element, canStart, waitToDraw, controller.signal)
        .then((save) => {
          if (save && draw === current) finished.push(save);
        })
        .catch(() => {})
        .finally(() => {
          drawing = false;
          if (activeCapture === controller) activeCapture = null;
          if (controller.signal.aborted) deferred = true;
          if (draw === current && !pending.has(paneId) && !dropped) {
            if (deferred) pending.set(paneId, request);
            else if (request.element.isConnected && needsPicture(paneId)) {
              pending.set(paneId, {
                ...request,
                after: performance.now() + request.retryAfter,
                retryAfter: Math.min(request.retryAfter * 2, SNAPSHOT_RETRY_LIMIT_MS),
              });
            }
          }
          next();
        });
    });
  };
  const request = (paneId: string, element: HTMLElement) => {
    if (mountOf(paneId) === null) return;
    pending.set(paneId, {
      element,
      after:
        performance.now() + (mountOf(paneId) === "background" ? FIRST_PICTURE_INPUT_QUIET_MS : 0),
      retryAfter: SNAPSHOT_RETRY_MS,
      background: mountOf(paneId) === "background",
    });
    if (timer !== null) clearTimeout(timer);
    timer = null;
    next();
  };
  const setDraw = (
    nextDraw: Draw,
    nextNeedsPicture: (paneId: string) => boolean,
    nextHasSavedPixels: (paneId: string) => boolean,
    nextMountOf: (paneId: string) => PictureMount = () => "ordinary",
    nextFocusedAt: (paneId: string) => number = () => 0,
  ) => {
    draw = nextDraw;
    needsPicture = nextNeedsPicture;
    hasSavedPixels = nextHasSavedPixels;
    mountOf = nextMountOf;
    focusedAt = nextFocusedAt;
    for (const type of inputEvents) {
      window.addEventListener(type, noteInput, { capture: true, passive: true });
    }
    next();
    return () => {
      if (draw !== nextDraw) return;
      activeCapture?.abort();
      draw = null;
      pending.clear();
      finished.length = 0;
      pointers.clear();
      cancelScheduled();
      continuation?.resolve(false);
      continuation = null;
      for (const type of inputEvents) {
        window.removeEventListener(type, noteInput, { capture: true });
      }
    };
  };
  const stop = () => {
    activeCapture?.abort();
    continuation?.cancel();
    continuation = null;
  };
  const setActivity = (nextEnabled: boolean, nextMoving: boolean) => {
    if (enabled === nextEnabled && moving === nextMoving) return;
    enabled = nextEnabled;
    moving = nextMoving;
    if (!enabled || moving) stop();
    cancelScheduled();
    next();
  };
  const setCovered = (nextCovered: boolean) => {
    if (covered === nextCovered) return;
    covered = nextCovered;
    if (!covered) stop();
    cancelScheduled();
    next();
  };
  return { request, setDraw, setActivity, setCovered, shown };
}
