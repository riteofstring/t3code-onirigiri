import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  createPaneLifecycleStore,
  type PaneLifecycleStore,
  type PanePosition,
} from "./paneLifecycle";

const stores: PaneLifecycleStore[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", (handle: ReturnType<typeof setTimeout>) =>
    clearTimeout(handle),
  );
});

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function lifecycle(panes: readonly PanePosition[], focusedPaneId: string | null) {
  const store = createPaneLifecycleStore(panes, focusedPaneId);
  stores.push(store);
  return store;
}

function commitOnChange(store: PaneLifecycleStore, panes: PanePosition[]) {
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => store.committed(paneId, store.isMounted(paneId)));
  }
}

function row(count: number, plane = 0): PanePosition[] {
  return Array.from({ length: count }, (_, slot) => ({
    paneId: `p${plane}-${slot}`,
    plane,
    slot,
  }));
}

function drain(store: PaneLifecycleStore, panes: PanePosition[]) {
  for (let step = 0; step < 40; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
}

function mountedOf(store: PaneLifecycleStore, panes: PanePosition[]) {
  return panes.filter(({ paneId }) => store.isMounted(paneId)).map(({ paneId }) => paneId);
}

it("retries exhausted background pictures after backoff without new input", () => {
  const store = lifecycle(row(3), "p0-0");
  let mounts = 0;
  store.subscribe("p0-2", () => {
    if (store.isMounted("p0-2")) mounts++;
  });
  store.setBackgroundPictures(true);
  store.setPictures(() => false);
  vi.advanceTimersByTime(60_000);
  expect(mounts).toBe(1);
  vi.advanceTimersByTime(5 * 60_000);
  expect(mounts).toBe(2);
  expect(mountedOf(store, row(3)).length).toBeLessThanOrEqual(3);
});

it("gives a departing uncovered view one bounded slot until its first picture completes", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  const pictures = new Set<string>();
  store.setPictures((paneId) => pictures.has(paneId));
  store.setBackgroundPictures(true);
  store.setMoving(true);
  for (let slot = 1; slot < 12; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(200);
    store.committed(`p0-${slot}`, true);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
  }
  expect(store.isMounted("p0-0")).toBe(true);
  pictures.add("p0-0");
  store.setPictures((paneId) => pictures.has(paneId));
  store.setMoving(false);
  vi.advanceTimersByTime(1500);
  expect(store.isMounted("p0-0")).toBe(false);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
});

it.each(["completed", "expired"])(
  "releases a %s picture slot during continuous navigation",
  (result) => {
    const panes = row(28);
    const store = lifecycle(panes, "p0-0");
    const pictures = new Set<string>();
    store.setPictures((paneId) => pictures.has(paneId));
    store.setBackgroundPictures(true);
    store.setMoving(true);
    const visit = (slot: number) => {
      store.setFocus(`p0-${slot}`);
      vi.advanceTimersByTime(900);
      store.committed(`p0-${slot}`, true);
      expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
    };
    for (let slot = 1; slot <= 9; slot++) visit(slot);
    expect(store.isMounted("p0-0")).toBe(true);
    if (result === "completed") {
      pictures.add("p0-0");
      store.setPictures((paneId) => pictures.has(paneId));
      visit(10);
    } else {
      for (let slot = 10; slot <= 24; slot++) visit(slot);
    }
    expect(store.isMounted("p0-0")).toBe(false);
  },
);

it("retries a departing picture owner that expires during continuous navigation", () => {
  const panes = row(28);
  const store = lifecycle(panes, "p0-0");
  const pictures = new Set<string>();
  const transitions: boolean[] = [];
  commitOnChange(store, panes);
  store.subscribe("p0-0", () => transitions.push(store.isMounted("p0-0")));
  store.setPictures((paneId) => pictures.has(paneId));
  store.setBackgroundPictures(true);
  store.setMoving(true);
  for (let slot = 1; slot <= 24; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(900);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
    if (slot === 9) expect(store.isMounted("p0-0")).toBe(true);
  }
  expect(store.isMoving()).toBe(true);
  expect(transitions).toEqual([false]);

  for (const { paneId } of panes) if (paneId !== "p0-0") pictures.add(paneId);
  store.setPictures((paneId) => pictures.has(paneId));
  window.dispatchEvent(new Event("keydown"));
  store.setMoving(false);
  vi.advanceTimersByTime(2900);
  expect(store.isMounted("p0-0")).toBe(false);
  vi.advanceTimersByTime(200);
  expect(transitions).toEqual([false, true]);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);

  pictures.add("p0-0");
  store.setPictures((paneId) => pictures.has(paneId));
  vi.advanceTimersByTime(1200);
  expect(transitions).toEqual([false, true, false]);
  vi.advanceTimersByTime(60_000);
  expect(transitions).toEqual([false, true, false]);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
});

it.each(["motion", "keydown", "pointerdown", "wheel"])(
  "retries an expired background reservation interrupted by %s, then backs off a genuine failure",
  (type) => {
    const panes = row(3);
    const store = lifecycle(panes, "p0-0");
    const transitions: boolean[] = [];
    commitOnChange(store, panes);
    store.subscribe("p0-2", () => transitions.push(store.isMounted("p0-2")));
    store.setPictures((paneId) => paneId !== "p0-2");
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(3500);
    expect(transitions).toEqual([true]);

    if (type === "motion") store.setMoving(true);
    else window.dispatchEvent(new Event(type));
    for (let step = 0; step < 11; step++) {
      vi.advanceTimersByTime(1000);
      if (type !== "motion") window.dispatchEvent(new Event(type));
    }
    if (type === "motion") {
      window.dispatchEvent(new Event("keydown"));
      store.setMoving(false);
    }
    vi.advanceTimersByTime(500);
    expect(transitions).toEqual([true, false]);
    vi.advanceTimersByTime(2400);
    expect(transitions).toEqual([true, false]);
    vi.advanceTimersByTime(200);
    expect(transitions).toEqual([true, false, true]);

    vi.advanceTimersByTime(12_000);
    expect(transitions).toEqual([true, false, true, false]);
    vi.advanceTimersByTime(60_000);
    expect(transitions).toEqual([true, false, true, false]);
    expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1"]);
  },
);

it("retries a departing owner reserved while recent input still pauses capture", () => {
  const panes = row(10);
  const store = lifecycle(panes, "p0-0");
  const transitions: boolean[] = [];
  commitOnChange(store, panes);
  store.subscribe("p0-0", () => transitions.push(store.isMounted("p0-0")));
  store.setMoving(true);
  for (let slot = 1; slot <= 7; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(200);
  }

  window.dispatchEvent(new Event("keydown"));
  store.setBackgroundPictures(true);
  store.setVisible("p0-9", true);
  store.setMoving(false);
  vi.advanceTimersByTime(100);
  expect(store.isMounted("p0-9")).toBe(true);
  expect(store.isMounted("p0-0")).toBe(true);
  expect(mountedOf(store, panes)).toHaveLength(9);

  store.setPictures((paneId) => paneId !== "p0-0");
  vi.advanceTimersByTime(11_000);
  expect(transitions).toEqual([false, true]);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
});

it("keeps failure backoff when input arrives after an uninterrupted reservation's deadline", () => {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 1000));
  const panes = row(3);
  const store = lifecycle(panes, "p0-0");
  const transitions: boolean[] = [];
  commitOnChange(store, panes);
  store.subscribe("p0-2", () => transitions.push(store.isMounted("p0-2")));
  store.setPictures((paneId) => paneId !== "p0-2");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(4000);
  expect(transitions).toEqual([true]);
  vi.advanceTimersByTime(10_001);
  window.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(5000);
  expect(transitions).toEqual([true, false]);
  vi.advanceTimersByTime(60_000);
  expect(transitions).toEqual([true, false]);
});

it.each(["input", "motion"])(
  "gives every missing pane a turn through repeated %s interruptions",
  (interruption) => {
    const panes = row(4);
    const store = lifecycle(panes, "p0-0");
    const mounts: string[] = [];
    for (const { paneId } of panes) {
      store.subscribe(paneId, () => {
        const mounted = store.isMounted(paneId);
        store.committed(paneId, mounted);
        expect(store.isMounted("p0-2") && store.isMounted("p0-3")).toBe(false);
        expect(mountedOf(store, panes).length).toBeLessThanOrEqual(3);
        if (!mounted || (paneId !== "p0-2" && paneId !== "p0-3")) return;
        mounts.push(paneId);
        setTimeout(() => {
          window.dispatchEvent(new Event("keydown"));
          if (interruption === "motion") {
            store.setMoving(true);
            setTimeout(() => store.setMoving(false), 100);
          }
        }, 8000);
      });
    }
    store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(60_000);
    expect(mounts.slice(0, 4)).toEqual(["p0-2", "p0-3", "p0-2", "p0-3"]);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(3);
  },
);

it("ignores a failed capture started during an earlier reservation of the same pane", () => {
  const panes = row(3);
  const store = lifecycle(panes, "p0-0");
  const mounts: number[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      const mounted = store.isMounted(paneId);
      store.committed(paneId, mounted);
      if (paneId === "p0-2" && mounted) mounts.push(performance.now());
    });
  }
  store.setPictures((paneId) => paneId !== "p0-2");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(3500);
  expect(mounts).toHaveLength(1);
  store.setMoving(true);
  vi.advanceTimersByTime(11_000);
  store.setMoving(false);
  vi.advanceTimersByTime(1);
  expect(mounts).toHaveLength(2);

  store.pictureFailed("p0-2", mounts[0]!);
  window.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(11_000);
  expect(mounts).toHaveLength(3);
});

it("keeps confirmed failure backoff across background deactivation and return", () => {
  const panes = row(4);
  const store = lifecycle(panes, "p0-0");
  const mounts: { paneId: string; at: number }[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      const mounted = store.isMounted(paneId);
      store.committed(paneId, mounted);
      expect(store.isMounted("p0-2") && store.isMounted("p0-3")).toBe(false);
      if (mounted && (paneId === "p0-2" || paneId === "p0-3")) {
        mounts.push({ paneId, at: performance.now() });
      }
    });
  }
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(3500);
  expect(mounts.map(({ paneId }) => paneId)).toEqual(["p0-2"]);
  store.pictureFailed("p0-2", performance.now());

  store.setBackgroundPictures(false);
  expect(store.isMounted("p0-2")).toBe(false);
  vi.advanceTimersByTime(1000);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(1000);
  expect(mounts.map(({ paneId }) => paneId)).toEqual(["p0-2", "p0-3"]);
  vi.advanceTimersByTime(mounts[0]!.at + 5 * 60_000 - performance.now() - 1);
  expect(mounts.filter(({ paneId }) => paneId === "p0-2")).toHaveLength(1);
  vi.advanceTimersByTime(10);
  expect(mounts.filter(({ paneId }) => paneId === "p0-2")).toHaveLength(2);
});

it("keeps interrupted panes in fair order across repeated background deactivation", () => {
  const panes = row(4);
  const store = lifecycle(panes, "p0-0");
  const mounts: string[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      const mounted = store.isMounted(paneId);
      store.committed(paneId, mounted);
      expect(store.isMounted("p0-2") && store.isMounted("p0-3")).toBe(false);
      if (mounted && (paneId === "p0-2" || paneId === "p0-3")) mounts.push(paneId);
    });
  }
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(3500);
  for (let visit = 0; visit < 3; visit++) {
    store.setBackgroundPictures(false);
    expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1"]);
    vi.advanceTimersByTime(1000);
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(1000);
  }
  expect(mounts).toEqual(["p0-2", "p0-3", "p0-2", "p0-3"]);
});

it("mounts the focused pane at once and its neighbours after a rest", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-2");
  store.setPictures((paneId) => paneId !== "p0-1" && paneId !== "p0-3");
  expect(mountedOf(store, panes)).toEqual(["p0-2"]);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
});

it("prepares all four neighboring destinations even when saved pictures exist", () => {
  const panes = [...row(3, 0), ...row(3, 1), ...row(3, 2)];
  const store = lifecycle(panes, "p1-1");
  store.setPictures(() => true);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p1-0", "p1-1", "p1-2", "p2-1"]);
});

it("prepares the next offscreen view beyond a visible strip", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-1");
  store.setPictures(() => true);
  for (const { paneId } of panes.slice(0, 4)) store.setVisible(paneId, true);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(panes.slice(0, 5).map(({ paneId }) => paneId));

  store.setMoving(true);
  store.setFocus("p0-2");
  store.setVisible("p0-0", false);
  store.setVisible("p0-4", true);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-4")).toBe(true);
  expect(store.isMounted("p0-5")).toBe(false);
  store.setMoving(false);
  drain(store, panes);
  expect(store.isMounted("p0-5")).toBe(true);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
});

it("uses spare mounts beyond visible neighbors in both grid axes", () => {
  const panes = [-2, -1, 0, 1, 2].flatMap((plane) =>
    [-2, -1, 0, 1, 2].map((slot) => ({ paneId: `${plane}:${slot}`, plane, slot })),
  );
  const store = lifecycle(panes, "-1:-1");
  store.setPictures(() => true);
  const visible = ["-1:-1", "-1:0", "0:-1", "0:0"];
  for (const paneId of visible) store.setVisible(paneId, true);
  drain(store, panes);
  expect(mountedOf(store, panes).toSorted()).toEqual(
    [...visible, "-1:-2", "-1:1", "-2:-1", "0:-2"].toSorted(),
  );
});

it("keeps a saved picture through motion and mounts its view after the final frame", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p0-9");
  vi.advanceTimersByTime(1200);
  expect(mountedOf(store, panes)).toEqual(["p0-0"]);
  store.setMoving(false);
  expect(store.isMounted("p0-9")).toBe(false);
  vi.advanceTimersByTime(0);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-9"]);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-8", "p0-9", "p0-10"]);
});

it("prepares a destination without a picture during motion and keeps retention bounded", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setMoving(true);
  for (let slot = 1; slot < 12; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(200);
    expect(store.isMounted(`p0-${slot}`)).toBe(true);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
    store.committed(`p0-${slot}`, true);
  }
});

it("keeps cached focus visits bounded when input never becomes quiet", () => {
  const panes = row(20);
  const store = lifecycle(panes, "p0-0");
  commitOnChange(store, panes);
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  for (let slot = 1; slot <= 6; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(1000);
  }
  expect(mountedOf(store, panes)).toHaveLength(8);
  let visible = "p0-6";
  store.setVisible(visible, true);

  for (let slot = 8; slot <= 11; slot++) {
    const paneId = `p0-${slot}`;
    window.dispatchEvent(new Event("keydown"));
    store.setMoving(true);
    store.setFocus(paneId);
    store.setVisible(visible, false);
    store.setVisible(paneId, true);
    visible = paneId;
    vi.advanceTimersByTime(250);
    expect(store.isMounted(paneId)).toBe(false);
    store.setMoving(false);
    vi.advanceTimersByTime(0);
    expect(store.isMounted(paneId)).toBe(true);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
    vi.advanceTimersByTime(50);
  }
});

it.each(["uncaptured focus", "visible neighbor"])(
  "keeps a completed capture neighbor live when the %s mounts",
  (destination) => {
    const panes = row(20);
    const store = lifecycle(panes, "p0-0");
    const fresh = new Set(panes.map(({ paneId }) => paneId));
    const hasPicture = (paneId: string) => fresh.has(paneId);
    commitOnChange(store, panes);
    store.setPictures(hasPicture);
    for (let slot = 1; slot <= 6; slot++) {
      store.setFocus(`p0-${slot}`);
      vi.advanceTimersByTime(1000);
    }
    expect(mountedOf(store, panes)).toHaveLength(8);
    fresh.delete("p0-10");
    store.setPictures(hasPicture);
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(3000);
    expect(store.isMounted("p0-10")).toBe(true);
    expect(mountedOf(store, panes)).toHaveLength(9);

    window.dispatchEvent(new Event("keydown"));
    store.setMoving(true);
    store.setFocus("p0-9");
    store.setVisible("p0-9", true);
    store.setVisible("p0-10", true);
    vi.advanceTimersByTime(250);
    store.setMoving(false);
    vi.advanceTimersByTime(0);
    expect(store.isMounted("p0-9")).toBe(true);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);

    for (const paneId of mountedOf(store, panes)) fresh.delete(paneId);
    fresh.add("p0-10");
    if (destination === "uncaptured focus") fresh.delete("p0-11");
    store.setPictures(hasPicture);
    vi.advanceTimersByTime(50);
    window.dispatchEvent(new Event("keydown"));
    store.setMoving(true);
    store.setFocus(destination === "uncaptured focus" ? "p0-11" : "p0-10");
    store.setVisible("p0-9", false);
    store.setVisible("p0-11", true);
    vi.advanceTimersByTime(200);
    if (destination === "visible neighbor") {
      store.setMoving(false);
      vi.advanceTimersByTime(1);
    }
    expect(store.isMounted("p0-10")).toBe(true);
    expect(store.isMounted("p0-11")).toBe(true);
    expect(store.isMounted("p0-1")).toBe(true);
    expect(store.isMounted("p0-2")).toBe(false);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);

    fresh.add("p0-1");
    store.setPictures(hasPicture);
    store.setMoving(false);
    vi.advanceTimersByTime(201);
    expect(store.isMounted("p0-1")).toBe(false);
    expect(store.isMounted("p0-10")).toBe(true);
    expect(store.isMounted("p0-11")).toBe(true);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
  },
);

it("keeps a departing picture slot when every other view is visibly required", () => {
  const panes = row(14);
  const store = lifecycle(panes, "p0-0");
  const fresh = new Set(panes.map(({ paneId }) => paneId));
  const hasPicture = (paneId: string) => fresh.has(paneId);
  commitOnChange(store, panes);
  store.setPictures(hasPicture);
  for (let slot = 1; slot <= 6; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(1000);
  }
  fresh.delete("p0-10");
  store.setPictures(hasPicture);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(3000);
  expect(mountedOf(store, panes)).toHaveLength(9);

  const visible = [...panes.slice(0, 8).map(({ paneId }) => paneId), "p0-11"];
  for (const paneId of visible) store.setVisible(paneId, true);
  store.setMoving(true);
  store.setFocus("p0-10");
  vi.advanceTimersByTime(200);
  fresh.delete("p0-11");
  store.setPictures(hasPicture);
  store.setFocus("p0-11");
  vi.advanceTimersByTime(200);
  expect(visible.every(store.isMounted)).toBe(true);
  expect(store.isMounted("p0-10")).toBe(true);
  expect(mountedOf(store, panes)).toHaveLength(visible.length + 1);

  fresh.add("p0-10");
  store.setPictures(hasPicture);
  store.setMoving(false);
  vi.advanceTimersByTime(201);
  expect(store.isMounted("p0-10")).toBe(false);
  expect(mountedOf(store, panes)).toEqual(visible);
});

it("still waits for quiet focus when motion finishes before the mount delay", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p0-9");
  vi.advanceTimersByTime(50);
  store.setMoving(false);
  vi.advanceTimersByTime(149);
  expect(store.isMounted("p0-9")).toBe(false);
  vi.advanceTimersByTime(1);
  expect(store.isMounted("p0-9")).toBe(true);
});

it("discards a deferred destination when focus changes before the posted mount", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p0-8");
  vi.advanceTimersByTime(250);
  store.setMoving(false);
  store.setFocus("p0-10");
  vi.advanceTimersByTime(199);
  expect(mountedOf(store, panes)).toEqual(["p0-0"]);
  vi.advanceTimersByTime(1);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-10"]);
});

it("pauses neighbor and background preparation through same-pane camera motion", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId !== "p0-11");
  store.setBackgroundPictures(true);
  drain(store, panes);
  const warm = mountedOf(store, panes);
  store.setPictures((paneId) => paneId !== "p0-10");
  store.setMoving(true);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(warm);
  store.setMoving(false);
  vi.advanceTimersByTime(0);
  vi.advanceTimersByTime(1);
  expect(store.isMounted("p0-10")).toBe(true);
});

it("cancels a deferred focused mount on disposal", () => {
  const panes = row(12);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p0-9");
  vi.advanceTimersByTime(250);
  store.setMoving(false);
  store.dispose();
  vi.runAllTimers();
  expect(mountedOf(store, panes)).toEqual(["p0-0"]);
});

it("abandons a deferred destination when navigation leaves pane focus", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p0-9");
  vi.advanceTimersByTime(250);
  store.setFocus(null);
  store.setMoving(false);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-0"]);
});

it("does not postpone a focused mount when unrelated thread pictures and labels keep updating", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setFocus("p0-9");
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(50);
    store.setPanes(panes.map((pane) => ({ ...pane })));
    store.setPictures(() => true);
  }
  expect(store.isMounted("p0-9")).toBe(true);
});

it("keeps recent prepared views while one extra view is pictured in the background", () => {
  const panes = row(16);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  for (let slot = 1; slot <= 8; slot++) {
    store.setFocus(`p0-${slot}`);
    drain(store, panes);
  }
  const warm = mountedOf(store, panes);
  expect(warm).toHaveLength(8);
  store.setPictures((paneId) => paneId !== "p0-15");
  store.setBackgroundPictures(true);
  for (let step = 0; step < 6; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  expect(mountedOf(store, panes)).toEqual([...warm, "p0-15"]);
  store.setPictures(() => true);
  vi.advanceTimersByTime(1200);
  expect(mountedOf(store, panes)).toEqual(warm);
});

it("keeps every visible pane live even when overview exceeds the retention budget", () => {
  const panes = [...row(4, 0), ...row(12, 1)];
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  for (const { paneId } of row(12, 1)) store.setVisible(paneId, true);
  store.setFocus("p0-1");
  drain(store, panes);
  const mounted = mountedOf(store, panes);
  expect(mounted).toEqual(["p0-1", ...row(12, 1).map(({ paneId }) => paneId)]);
  for (const { paneId } of row(12, 1)) store.setVisible(paneId, false);
  drain(store, panes);
  expect(mountedOf(store, panes)).toHaveLength(8);
  expect(store.isMounted("p0-2")).toBe(true);
});

it("keeps at most eight views, unmounting the least recently wanted only to make room", () => {
  const panes = row(20);
  const store = lifecycle(panes, "p0-0");
  for (let slot = 1; slot < 12; slot++) {
    store.setPictures((paneId) => paneId !== `p0-${slot + 1}` && paneId !== `p0-${slot - 1}`);
    store.setFocus(`p0-${slot}`);
    drain(store, panes);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
  }
  const mounted = mountedOf(store, panes);
  expect(mounted).toContain("p0-11");
  expect(mounted).toContain("p0-12");
  expect(mounted).not.toContain("p0-0");
  expect(mounted.length).toBe(8);
});

it("does not evict visible views when an unpictured destination mounts during motion", () => {
  const panes = row(14);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId !== "p0-13");
  for (let slot = 0; slot < 10; slot++) store.setVisible(`p0-${slot}`, true);
  drain(store, panes);
  const live = mountedOf(store, panes);
  expect(live).toHaveLength(10);
  store.setMoving(true);
  store.setFocus("p0-13");
  vi.advanceTimersByTime(250);
  expect(mountedOf(store, panes)).toEqual([...live, "p0-13"]);
});

it("releases overview views one commit at a time after input quiets, retaining nearby views", () => {
  const panes = row(20);
  const store = lifecycle(panes, "p0-19");
  store.setPictures(() => true);
  for (const { paneId } of panes) store.setVisible(paneId, true);
  drain(store, panes);
  const released: string[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      if (!store.isMounted(paneId)) released.push(paneId);
    });
  }
  store.setMoving(true);
  store.setFocus("p0-1");
  for (const { paneId } of panes) store.setVisible(paneId, paneId === "p0-1");
  vi.advanceTimersByTime(250);
  store.setMoving(false);
  window.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(250);
  expect(released).toEqual([]);
  vi.advanceTimersByTime(200);
  expect(released).toHaveLength(1);
  expect(mountedOf(store, panes)).toHaveLength(19);
  store.committed(released[0]!, false);
  vi.advanceTimersByTime(1);
  expect(released).toHaveLength(2);
  drain(store, panes);
  expect(mountedOf(store, panes)).toHaveLength(8);
  expect(released).not.toContain("p0-0");
  expect(released).not.toContain("p0-2");
});

it("takes a still-visible queued pane ahead of a newly hidden one during input", () => {
  const panes = row(10);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  for (const paneId of ["p0-5", "p0-6", "p0-7"]) store.setVisible(paneId, true);
  vi.advanceTimersByTime(250);
  expect(store.isMounted("p0-5")).toBe(true);
  store.setVisible("p0-6", false);
  window.dispatchEvent(new Event("keydown"));
  store.committed("p0-5", true);
  vi.advanceTimersByTime(1);
  expect(store.isMounted("p0-6")).toBe(false);
  expect(store.isMounted("p0-7")).toBe(true);
});

it("starts required visible preparation after motion even if focus does not change", () => {
  const panes = row(12);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setMoving(true);
  store.setVisible("p0-10", true);
  store.setVisible("p0-11", true);
  vi.advanceTimersByTime(1200);
  expect(mountedOf(store, panes)).toEqual(["p0-0"]);
  store.setMoving(false);
  vi.advanceTimersByTime(1);
  expect(store.isMounted("p0-10")).toBe(true);
  expect(store.isMounted("p0-11")).toBe(false);
  vi.advanceTimersByTime(1999);
  expect(store.isMounted("p0-11")).toBe(false);
  vi.advanceTimersByTime(2);
  expect(store.isMounted("p0-11")).toBe(true);
});

it.each(["speculative", "previously visible"])(
  "prepares visible panes ahead of a stalled %s pane without accepting its late acknowledgement",
  (kind) => {
    const store = lifecycle(row(10), "p0-0");
    store.setPictures(() => true);
    if (kind === "previously visible") store.setVisible("p0-1", true);
    vi.advanceTimersByTime(650);
    expect(store.isMounted("p0-1")).toBe(true);
    store.setVisible("p0-1", false);
    store.setMoving(true);
    store.setVisible("p0-8", true);
    store.setVisible("p0-9", true);
    vi.advanceTimersByTime(250);
    expect(store.isMounted("p0-8")).toBe(false);
    store.setMoving(false);
    vi.advanceTimersByTime(1);
    expect(store.isMounted("p0-8")).toBe(true);
    expect(store.isMounted("p0-9")).toBe(false);
    store.committed("p0-1", true);
    vi.advanceTimersByTime(1);
    expect(store.isMounted("p0-9")).toBe(false);
    store.committed("p0-8", true);
    vi.advanceTimersByTime(1);
    expect(store.isMounted("p0-9")).toBe(true);
  },
);

it("prepares only the next pictured neighbour in the direction of travel", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-2");
  store.setPictures(() => true);
  store.setFocus("p0-3");
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-2", "p0-3", "p0-4"]);
});

it("mounts panes without a picture one at a time to picture them, then lets them go", () => {
  const panes = row(5);
  const store = lifecycle(panes, "p0-0");
  const pictured = new Set(["p0-0", "p0-1"]);
  store.setPictures((paneId) => pictured.has(paneId));
  store.setBackgroundPictures(true);
  const step = (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 500) {
      vi.advanceTimersByTime(500);
      for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
    }
  };
  step(5000);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-2"]);
  pictured.add("p0-2");
  store.setPictures((paneId) => pictured.has(paneId));
  step(1000);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-3"]);
  step(12_000);
  expect(store.isMounted("p0-3")).toBe(false);
  step(60_000);
  expect(store.isMounted("p0-3")).toBe(false);
});

it("pictures a briefly visible pane after rest before untouched panes", () => {
  const panes = row(8);
  const store = lifecycle(panes, "p0-0");
  const pictured = new Set(["p0-0", "p0-1"]);
  commitOnChange(store, panes);
  store.setPictures((paneId) => pictured.has(paneId));
  store.setBackgroundPictures(true);
  store.setMoving(true);
  store.setVisible("p0-6", true);
  vi.advanceTimersByTime(45);
  store.setVisible("p0-6", false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-6")).toBe(false);

  window.dispatchEvent(new Event("keydown"));
  store.setMoving(false);
  vi.advanceTimersByTime(2900);
  expect(store.isMounted("p0-6")).toBe(false);
  vi.advanceTimersByTime(200);
  expect(store.isMounted("p0-6")).toBe(true);
  expect(store.isMounted("p0-2")).toBe(false);

  pictured.add("p0-6");
  store.setPictures((paneId) => pictured.has(paneId));
  vi.advanceTimersByTime(1200);
  expect(store.isMounted("p0-6")).toBe(false);
  expect(store.isMounted("p0-2")).toBe(true);
});

it("prepares a crossed pane at cache capacity without refilling its later eviction", () => {
  const panes = row(8);
  const store = lifecycle(panes, "p0-0");
  const pictured = new Set(["p0-0", "p0-1"]);
  const canPicture = (paneId: string, visited = false) => pictured.has(paneId) || visited;
  const mounts: string[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      if (store.isMounted(paneId)) mounts.push(paneId);
      store.committed(paneId, store.isMounted(paneId));
    });
  }
  store.setPictures((paneId) => pictured.has(paneId), true, canPicture);
  store.setBackgroundPictures(true);
  store.setMoving(true);
  store.setVisible("p0-6", true);
  store.setVisible("p0-6", false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-6")).toBe(false);
  store.setMoving(false);
  vi.advanceTimersByTime(3500);
  expect(store.isMounted("p0-6")).toBe(true);
  expect(store.isMounted("p0-2")).toBe(false);

  pictured.add("p0-6");
  store.setPictures((paneId) => pictured.has(paneId), true, canPicture);
  vi.advanceTimersByTime(1200);
  expect(store.isMounted("p0-6")).toBe(false);
  pictured.delete("p0-6");
  store.setPictures((paneId) => pictured.has(paneId), true, canPicture);
  vi.advanceTimersByTime(6 * 60_000);
  expect(mounts.filter((paneId) => paneId === "p0-6")).toHaveLength(1);

  store.setVisible("p0-6", true);
  store.setVisible("p0-6", false);
  vi.advanceTimersByTime(3500);
  expect(mounts.filter((paneId) => paneId === "p0-6")).toHaveLength(2);
});

it.each(["never visible", "removed"])(
  "does not prioritize a %s pane at cache capacity",
  (condition) => {
    const panes = row(8);
    const store = lifecycle(panes, "p0-0");
    const pictured = new Set(["p0-0", "p0-1"]);
    store.setPictures(
      (paneId) => pictured.has(paneId),
      true,
      (paneId, visited = false) => pictured.has(paneId) || visited,
    );
    store.setBackgroundPictures(true);
    store.setMoving(true);
    if (condition === "removed") {
      store.setVisible("p0-6", true);
      store.setVisible("p0-6", false);
      store.setPanes(panes.filter((pane) => pane.paneId !== "p0-6"));
      store.setPanes(panes);
    } else {
      store.setFocus("p0-6");
      store.setFocus("p0-0");
    }
    vi.advanceTimersByTime(1000);
    store.setMoving(false);
    drain(store, panes);
    expect(store.isMounted("p0-6")).toBe(false);
  },
);

it.each(["keydown", "pointerdown", "wheel"])(
  "waits for input to quiet after %s between background pictures",
  (type) => {
    const panes = row(4);
    const store = lifecycle(panes, "p0-0");
    commitOnChange(store, panes);
    const pictured = new Set(["p0-0", "p0-1"]);
    store.setPictures((paneId) => pictured.has(paneId));
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(3500);
    expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-2"]);

    pictured.add("p0-2");
    store.setPictures((paneId) => pictured.has(paneId));
    window.dispatchEvent(new Event(type));
    vi.advanceTimersByTime(2900);
    expect(store.isMounted("p0-3")).toBe(false);
    vi.advanceTimersByTime(200);
    expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-3"]);
  },
);

it("continues preparing when a view never reports a React commit", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-2");
  store.setPictures(() => true);
  vi.advanceTimersByTime(5000);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
});

it("accepts synchronous mount commits without stranding the next destination", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-2");
  commitOnChange(store, panes);
  store.setPictures(() => true);
  vi.advanceTimersByTime(1000);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
});

it("continues preparation after a pending view is removed before committing", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-2");
  store.setPictures(() => true);
  vi.advanceTimersByTime(700);
  expect(store.isMounted("p0-3")).toBe(true);
  store.setPanes(panes.filter(({ paneId }) => paneId !== "p0-3"));
  vi.advanceTimersByTime(500);
  expect(store.isMounted("p0-4")).toBe(true);
  expect(store.isMounted("p0-3")).toBe(false);
});

it("does not keep cancelling idle preparation when picture freshness is unchanged", () => {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 500));
  const panes = row(6);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  for (let step = 0; step < 14; step++) {
    vi.advanceTimersByTime(100);
    store.setPictures(() => true);
  }
  expect(store.isMounted("p0-1")).toBe(true);
});

it("prepares visible views ahead of neighbors without waiting for stored pictures", () => {
  const panes = row(10);
  const store = lifecycle(panes, "p0-0");
  store.setVisible("p0-8", true);
  store.setPictures(() => false, false);
  vi.advanceTimersByTime(250);
  expect(store.isMounted("p0-8")).toBe(true);
  expect(store.isMounted("p0-1")).toBe(false);
  store.committed("p0-8", true);
  store.setPictures(() => true, true);
  vi.advanceTimersByTime(3000);
  expect(store.isMounted("p0-8")).toBe(true);
  expect(store.isMounted("p0-1")).toBe(true);
});

it("prepares visible panes serially even while input keeps speculative mounts paused", () => {
  const panes = row(10);
  const store = lifecycle(panes, "p0-0");
  store.setVisible("p0-8", true);
  store.setVisible("p0-9", true);
  store.setPictures(() => false, false);
  for (let step = 0; step < 10; step++) {
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(100);
  }
  expect(store.isMounted("p0-8")).toBe(true);
  expect(store.isMounted("p0-9")).toBe(false);
  expect(store.isMounted("p0-1")).toBe(false);
  store.committed("p0-8", true);
  vi.advanceTimersByTime(1);
  expect(store.isMounted("p0-9")).toBe(true);
  store.committed("p0-9", true);
  vi.advanceTimersByTime(500);
  expect(store.isMounted("p0-1")).toBe(true);
});

it("does not apply failure backoff to a successful picture that later becomes stale", () => {
  const panes = row(3);
  const store = lifecycle(panes, "p0-0");
  const pictured = new Set(["p0-0", "p0-1"]);
  store.setPictures((paneId) => pictured.has(paneId));
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(5000);
  expect(store.isMounted("p0-2")).toBe(true);
  store.committed("p0-2", true);
  pictured.add("p0-2");
  store.setPictures((paneId) => pictured.has(paneId));
  vi.advanceTimersByTime(1200);
  expect(store.isMounted("p0-2")).toBe(false);
  pictured.delete("p0-2");
  store.setPictures((paneId) => pictured.has(paneId));
  vi.advanceTimersByTime(5000);
  expect(store.isMounted("p0-2")).toBe(true);
});

it("lets the newly focused view commit before preparing its neighbor", () => {
  const panes = row(10);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setFocus("p0-8");
  store.setVisible("p0-9", true);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-8")).toBe(true);
  expect(store.isMounted("p0-9")).toBe(false);
  store.committed("p0-8", true);
  vi.advanceTimersByTime(100);
  expect(store.isMounted("p0-9")).toBe(true);
});

it("does not repeatedly mount a running thread just to update its background picture", () => {
  const panes = row(3);
  const store = lifecycle(panes, "p0-0");
  store.setBackgroundPictures(true);
  store.setPictures(
    (paneId) => paneId !== "p0-2",
    true,
    (paneId) => paneId !== "p0-2",
  );
  drain(store, panes);
  expect(store.isMounted("p0-2")).toBe(false);
  store.setPictures(
    (paneId) => paneId !== "p0-2",
    true,
    () => true,
  );
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-2")).toBe(true);
});

it("prepares a distant running view after neighbors and retains it through focus changes", () => {
  const panes = row(20);
  const store = lifecycle(panes, "p0-0");
  const mounts: string[] = [];
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => {
      if (store.isMounted(paneId)) mounts.push(paneId);
    });
  }
  store.setPictures(() => true);
  store.setRunning(new Set(["p0-19"]));
  drain(store, panes);
  expect(mounts.slice(0, 2)).toEqual(["p0-1", "p0-19"]);
  for (let slot = 1; slot <= 10; slot++) {
    store.setFocus(`p0-${slot}`);
    vi.advanceTimersByTime(250);
    expect(store.isMounted("p0-19")).toBe(true);
    drain(store, panes);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
  }
  expect(mounts.filter((paneId) => paneId === "p0-19")).toHaveLength(1);
});

it("keeps a visited running chat ready while a dense overview moves it offscreen", () => {
  const panes = [...row(2), ...row(10, 1)];
  const store = lifecycle(panes, "p0-0");
  const transitions: boolean[] = [];
  store.subscribe("p0-0", () => transitions.push(store.isMounted("p0-0")));
  store.setRunning(new Set(["p0-0", "p0-1"]));
  store.setPictures((paneId) => !paneId.startsWith("p0-"));
  store.setMoving(true);
  store.setFocus("p1-0");
  for (const { paneId } of row(10, 1)) store.setVisible(paneId, true);
  vi.advanceTimersByTime(250);
  store.setMoving(false);
  drain(store, panes);

  expect(mountedOf(store, panes)).toEqual(["p0-0", ...row(10, 1).map(({ paneId }) => paneId)]);
  expect(store.isMounted("p0-1")).toBe(false);
  store.setVisible("p0-0", true);
  expect(store.isMounted("p0-0")).toBe(true);
  expect(transitions).toEqual([]);

  store.setVisible("p0-0", false);
  store.setRunning(new Set(["p0-1"]));
  store.setPictures(() => true);
  drain(store, panes);
  expect(store.isMounted("p0-0")).toBe(false);
  expect(transitions).toEqual([false]);
});

it("uses spare capacity for running views without displacing visible content", () => {
  const panes = row(14);
  const store = lifecycle(panes, "p0-5");
  const unpictured = new Set(["p0-0", "p0-1", "p0-2", "p0-3", "p0-8", "p0-13"]);
  for (const paneId of unpictured) if (paneId !== "p0-13") store.setVisible(paneId, true);
  store.setPictures((paneId) => !unpictured.has(paneId));
  store.setRunning(new Set(["p0-13"]));
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual([
    "p0-0",
    "p0-1",
    "p0-2",
    "p0-3",
    "p0-4",
    "p0-5",
    "p0-6",
    "p0-8",
  ]);
  unpictured.delete("p0-0");
  store.setPictures((paneId) => !unpictured.has(paneId));
  drain(store, panes);
  expect(store.isMounted("p0-0")).toBe(true);
  expect(store.isMounted("p0-13")).toBe(false);
  store.setVisible("p0-0", false);
  drain(store, panes);
  expect(store.isMounted("p0-13")).toBe(true);
  expect(store.isMounted("p0-4")).toBe(true);
  expect(store.isMounted("p0-6")).toBe(true);
  expect(mountedOf(store, panes)).toHaveLength(8);
});

it("chooses the closest running views with stable geometric tie breaking", () => {
  const panes = [...row(5, 0), ...row(5, 1), ...row(5, 2)];
  const store = lifecycle(panes, "p1-2");
  const unpictured = new Set(["p0-0", "p2-4"]);
  for (const paneId of unpictured) store.setVisible(paneId, true);
  store.setPictures((paneId) => !unpictured.has(paneId));
  store.setRunning(new Set(["p2-1", "p0-1", "p0-4"]));
  drain(store, panes);
  expect(store.isMounted("p0-1")).toBe(true);
  expect(store.isMounted("p2-1")).toBe(false);
  expect(store.isMounted("p0-4")).toBe(false);
  expect(mountedOf(store, panes)).toHaveLength(8);
});

it("releases finished and removed running views through ordinary retention", () => {
  const panes = row(26);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setRunning(new Set(["p0-25"]));
  drain(store, panes);
  store.setRunning(new Set());
  drain(store, panes);
  expect(store.isMounted("p0-25")).toBe(true);
  for (let slot = 1; slot <= 10; slot++) {
    store.setFocus(`p0-${slot}`);
    drain(store, panes);
  }
  expect(store.isMounted("p0-25")).toBe(false);
  store.setRunning(new Set(["p0-25"]));
  drain(store, panes);
  expect(store.isMounted("p0-25")).toBe(true);
  store.setPanes(panes.slice(0, -1));
  drain(store, panes.slice(0, -1));
  expect(store.isMounted("p0-25")).toBe(false);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
});

it("does not restart preparation when running membership is unchanged", () => {
  const panes = row(8);
  const store = lifecycle(panes, "p0-0");
  store.setPictures(() => true);
  store.setRunning(new Set(["p0-7"]));
  for (let step = 0; step < 20; step++) {
    vi.advanceTimersByTime(50);
    store.setRunning(new Set(["p0-7"]));
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-7"]);
});

it("retains a background view that starts running before its picture finishes", () => {
  const panes = row(8);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId !== "p0-7");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(3000);
  for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-7")).toBe(true);
  store.setRunning(new Set(["p0-7"]));
  store.setPictures(
    (paneId) => paneId !== "p0-7",
    true,
    (paneId) => paneId !== "p0-7",
  );
  drain(store, panes);
  expect(store.isMounted("p0-7")).toBe(true);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
});

it("cancels background picturing while covered and retries the interrupted pane on return", () => {
  const panes = row(5);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId !== "p0-2");
  store.setBackgroundPictures(true);
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  expect(store.isMounted("p0-2")).toBe(true);

  store.setBackgroundPictures(false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-2")).toBe(false);
  vi.advanceTimersByTime(20_000);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1"]);

  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(5000);
  expect(store.isMounted("p0-2")).toBe(true);
  expect(store.isMounted("p0-3")).toBe(false);
});

it("retains a visible view when its background picturing is disabled", () => {
  const panes = row(5);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
  store.setBackgroundPictures(true);
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  store.setVisible("p0-2", true);
  store.setBackgroundPictures(false);
  expect(store.isMounted("p0-2")).toBe(true);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-2")).toBe(true);
  store.setFocus("p0-2");
  vi.advanceTimersByTime(250);
  expect(store.isMounted("p0-2")).toBe(true);
});

it("retries a cancelled picture mount before the old commit deadline", () => {
  const panes = row(5);
  const store = lifecycle(panes, "p0-0");
  const transitions: boolean[] = [];
  store.subscribe("p0-2", () => transitions.push(store.isMounted("p0-2")));
  store.setPictures((paneId) => paneId !== "p0-2");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(1000);
  store.committed("p0-1", true);
  vi.advanceTimersByTime(2200);
  expect(transitions).toEqual([true]);
  store.setBackgroundPictures(false);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(500);
  expect(transitions).toEqual([true, false, true]);
  expect(store.isMounted("p0-0")).toBe(true);
});

it.each(["producer", "running"] as const)(
  "retains viewed %s panes beyond eight warm views until release",
  (kind) => {
    const panes = row(16);
    const store = lifecycle(panes, "p0-0");
    const retained = new Set(panes.slice(0, 10).map((pane) => pane.paneId));
    for (const paneId of retained) store.setVisible(paneId, true);
    const retain = kind === "running" ? store.setRunning : store.setRetainedPanes;
    retain(retained);
    store.setPictures((paneId) => !retained.has(paneId));
    drain(store, panes);
    for (const paneId of retained) store.setVisible(paneId, false);
    store.setFocus("p0-15");
    drain(store, panes);
    expect([...retained].every(store.isMounted)).toBe(true);
    expect(store.isMounted("p0-15")).toBe(true);
    expect(mountedOf(store, panes)).toHaveLength(11);

    store.setPanes(panes.slice(1));
    expect(store.isMounted("p0-0")).toBe(false);
    store.setPictures(() => true);
    retain(new Set());
    drain(store, panes);
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
    expect(store.isMounted("p0-15")).toBe(true);
  },
);

it("keeps a prepared producer after it becomes visible through disable and timeout", () => {
  const panes = row(6);
  const store = lifecycle(panes, "p0-0");
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
  store.setBackgroundPictures(true);
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  expect(store.isMounted("p0-2")).toBe(true);
  store.setVisible("p0-2", true);
  store.setRetainedPanes(new Set(["p0-2"]));
  store.setVisible("p0-2", false);
  store.setBackgroundPictures(false);
  expect(store.isMounted("p0-2")).toBe(true);
  store.setBackgroundPictures(true);
  store.setPictures(
    (paneId) => paneId === "p0-0" || paneId === "p0-1",
    true,
    (paneId) => paneId !== "p0-2",
  );
  let nextPrepared = false;
  for (let step = 0; step < 20; step++) {
    vi.advanceTimersByTime(1000);
    expect(store.isMounted("p0-2")).toBe(true);
    nextPrepared ||= store.isMounted("p0-3");
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  expect(nextPrepared).toBe(true);
});

it.each(["producer", "running"] as const)(
  "still prepares one static picture when viewed %s panes exceed the warm target",
  (kind) => {
    const panes = row(12);
    const store = lifecycle(panes, "p0-0");
    const retained = new Set(panes.slice(0, 10).map((pane) => pane.paneId));
    for (const paneId of retained) store.setVisible(paneId, true);
    const retain = kind === "running" ? store.setRunning : store.setRetainedPanes;
    retain(retained);
    drain(store, panes);
    for (const paneId of retained) store.setVisible(paneId, false);
    store.setPictures(
      () => false,
      true,
      (paneId) => !retained.has(paneId),
    );
    store.setBackgroundPictures(true);
    let pictured = false;
    for (let step = 0; step < 30; step++) {
      vi.advanceTimersByTime(1000);
      pictured ||= store.isMounted("p0-10");
      expect(mountedOf(store, panes).length).toBeLessThanOrEqual(11);
      for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
    }
    expect([...retained].every(store.isMounted)).toBe(true);
    expect(pictured).toBe(true);
  },
);

it("does not retain never-visible producers discovered by passive picture preparation", () => {
  const panes = row(25);
  const store = lifecycle(panes, "p0-0");
  const discovered = new Set<string>();
  for (const { paneId } of panes.slice(2)) {
    store.setVisible(paneId, true);
    store.setVisible(paneId, false);
    store.setFocus(paneId);
    store.setFocus("p0-0");
    expect(store.isMounted(paneId)).toBe(false);
  }
  store.setBackgroundPictures(true);
  for (let step = 0; step < 120; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) {
      if (store.isMounted(paneId)) discovered.add(paneId);
      store.committed(paneId, store.isMounted(paneId));
    }
    store.setRetainedPanes(new Set(discovered));
    store.setPictures(
      () => false,
      true,
      (paneId) => !discovered.has(paneId),
    );
    expect(mountedOf(store, panes).length).toBeLessThanOrEqual(9);
  }
  expect(discovered.size).toBe(25);
  store.setFocus("p0-10");
  drain(store, panes);
  store.setFocus("p0-20");
  drain(store, panes);
  expect(store.isMounted("p0-10")).toBe(true);
  expect(store.isMounted("p0-20")).toBe(true);
  expect(mountedOf(store, panes).length).toBeLessThanOrEqual(8);
});

it("does not add speculative picture mounts beyond a large visible overview", () => {
  const panes = row(20);
  const store = lifecycle(panes, "p0-0");
  for (const pane of panes.slice(0, 18)) store.setVisible(pane.paneId, true);
  store.setBackgroundPictures(true);
  drain(store, panes);
  expect(mountedOf(store, panes)).toHaveLength(18);
  expect(store.isMounted("p0-18")).toBe(false);
  expect(store.isMounted("p0-19")).toBe(false);
});
