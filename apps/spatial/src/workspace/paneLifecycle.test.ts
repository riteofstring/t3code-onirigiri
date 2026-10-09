import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createPaneLifecycleStore, type PanePosition } from "./paneLifecycle";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", (handle: ReturnType<typeof setTimeout>) =>
    clearTimeout(handle),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function row(count: number, plane = 0): PanePosition[] {
  return Array.from({ length: count }, (_, slot) => ({
    paneId: `p${plane}-${slot}`,
    plane,
    slot,
  }));
}

// Lets every queued speculative mount happen, reporting each commit at once.
function drain(store: ReturnType<typeof createPaneLifecycleStore>, panes: PanePosition[]) {
  for (let step = 0; step < 40; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
}

function mountedOf(store: ReturnType<typeof createPaneLifecycleStore>, panes: PanePosition[]) {
  return panes.filter(({ paneId }) => store.isMounted(paneId)).map(({ paneId }) => paneId);
}

it("mounts the focused pane at once and its neighbours after a rest", () => {
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-2");
  store.setPictures((paneId) => paneId !== "p0-1" && paneId !== "p0-3");
  expect(mountedOf(store, panes)).toEqual(["p0-2"]);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
  store.dispose();
});

it("prepares all four neighboring destinations even when saved pictures exist", () => {
  const panes = [...row(3, 0), ...row(3, 1), ...row(3, 2)];
  const store = createPaneLifecycleStore(panes, "p1-1");
  store.setPictures(() => true);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p1-0", "p1-1", "p1-2", "p2-1"]);
  store.dispose();
});

it("does not postpone a focused mount when unrelated thread pictures and labels keep updating", () => {
  const panes = row(12);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setFocus("p0-9");
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(50);
    store.setPanes(panes.map((pane) => ({ ...pane })));
    store.setPictures(() => true);
  }
  expect(store.isMounted("p0-9")).toBe(true);
  store.dispose();
});

it("keeps recent prepared views while one extra view is pictured in the background", () => {
  const panes = row(16);
  const store = createPaneLifecycleStore(panes, "p0-0");
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
  store.dispose();
});

it("prepares the next pane in the direction of travel even with many panes on screen", () => {
  const panes = [...row(4, 0), ...row(12, 1)];
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures((paneId) => paneId.startsWith("p0-") && paneId !== "p0-2");
  for (const { paneId } of row(12, 1)) store.setVisible(paneId, true);
  store.setFocus("p0-1");
  drain(store, panes);
  const mounted = mountedOf(store, panes);
  expect(mounted).toContain("p0-1");
  expect(mounted).toContain("p0-2");
  expect(mounted.length).toBe(8);
  store.dispose();
});

it("keeps at most eight views, unmounting the least recently wanted only to make room", () => {
  const panes = row(20);
  const store = createPaneLifecycleStore(panes, "p0-0");
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
  store.dispose();
});

it("leaves pictured panes unmounted unless they are neighboring destinations", () => {
  const panes = [...row(4, 0), ...row(4, 1)];
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures((paneId) => paneId.startsWith("p1-"));
  for (const { paneId } of row(4, 1)) store.setVisible(paneId, true);
  store.setVisible("p0-3", true);
  drain(store, panes);
  const mounted = mountedOf(store, panes);
  expect(mounted.filter((paneId) => paneId.startsWith("p1-"))).toEqual(["p1-0"]);
  expect(mounted).toContain("p0-3");
  expect(mounted).toContain("p0-1");
  store.dispose();
});

it("prepares only the next pictured neighbour in the direction of travel", () => {
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-2");
  store.setPictures(() => true);
  store.setFocus("p0-3");
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-2", "p0-3", "p0-4"]);
  store.dispose();
});

it("mounts panes without a picture one at a time to picture them, then lets them go", () => {
  const panes = row(5);
  const store = createPaneLifecycleStore(panes, "p0-0");
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
  // The nearest unpictured pane is mounted and waits for its picture.
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-2"]);
  pictured.add("p0-2");
  store.setPictures((paneId) => pictured.has(paneId));
  step(1000);
  // The next one waits a moment after the last.
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1"]);
  step(6000);
  expect(mountedOf(store, panes)).toEqual(["p0-0", "p0-1", "p0-3"]);
  // A pane that never gets a picture is let go after a while and not retried.
  step(12_000);
  expect(store.isMounted("p0-3")).toBe(false);
  step(60_000);
  expect(store.isMounted("p0-3")).toBe(false);
  store.dispose();
});

it("continues preparing when a view never reports a React commit", () => {
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-2");
  store.setPictures(() => true);
  vi.advanceTimersByTime(5000);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
  store.dispose();
});

it("accepts synchronous mount commits without stranding the next destination", () => {
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-2");
  for (const { paneId } of panes) {
    store.subscribe(paneId, () => store.committed(paneId, store.isMounted(paneId)));
  }
  store.setPictures(() => true);
  vi.advanceTimersByTime(1000);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
  store.dispose();
});

it("continues preparation after a pending view is removed before committing", () => {
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-2");
  store.setPictures(() => true);
  vi.advanceTimersByTime(700);
  expect(store.isMounted("p0-3")).toBe(true);
  store.setPanes(panes.filter(({ paneId }) => paneId !== "p0-3"));
  vi.advanceTimersByTime(500);
  expect(store.isMounted("p0-4")).toBe(true);
  expect(store.isMounted("p0-3")).toBe(false);
  store.dispose();
});

it("does not keep cancelling idle preparation when picture freshness is unchanged", () => {
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 500));
  const panes = row(6);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures(() => true);
  for (let step = 0; step < 14; step++) {
    vi.advanceTimersByTime(100);
    store.setPictures(() => true);
  }
  expect(store.isMounted("p0-1")).toBe(true);
  store.dispose();
});

it("prepares neighbors but waits for stored pictures before mounting other visible views", () => {
  const panes = row(10);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setVisible("p0-8", true);
  store.setPictures(() => false, false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-1")).toBe(true);
  expect(store.isMounted("p0-8")).toBe(false);
  store.committed("p0-1", true);
  store.setPictures(() => true, true);
  vi.advanceTimersByTime(3000);
  expect(store.isMounted("p0-8")).toBe(false);
  store.dispose();
});

it("resumes visible preparation when stored pictures never finish loading", () => {
  const panes = row(10);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setVisible("p0-8", true);
  store.setPictures(() => false, false);
  vi.advanceTimersByTime(1000);
  store.committed("p0-1", true);
  vi.advanceTimersByTime(1500);
  expect(store.isMounted("p0-8")).toBe(true);
  store.dispose();
});

it("does not apply failure backoff to a successful picture that later becomes stale", () => {
  const panes = row(3);
  const store = createPaneLifecycleStore(panes, "p0-0");
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
  store.dispose();
});

it("lets the newly focused view commit before preparing its neighbor", () => {
  const panes = row(10);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures(() => true);
  store.setFocus("p0-8");
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-8")).toBe(true);
  expect(store.isMounted("p0-9")).toBe(false);
  store.committed("p0-8", true);
  vi.advanceTimersByTime(100);
  expect(store.isMounted("p0-9")).toBe(true);
  store.dispose();
});

it("does not repeatedly mount a running thread just to update its background picture", () => {
  const panes = row(3);
  const store = createPaneLifecycleStore(panes, "p0-0");
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
  store.dispose();
});

it("cancels background picturing while covered and retries the interrupted pane on return", () => {
  const panes = row(5);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
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
  store.dispose();
});

it("retains a visible view when its background picturing is disabled", () => {
  const panes = row(5);
  const store = createPaneLifecycleStore(panes, "p0-0");
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
  store.setBackgroundPictures(true);
  for (let step = 0; step < 5; step++) {
    vi.advanceTimersByTime(1000);
    for (const { paneId } of panes) store.committed(paneId, store.isMounted(paneId));
  }
  store.setVisible("p0-2", true);
  vi.advanceTimersByTime(250);
  store.setBackgroundPictures(false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0-2")).toBe(true);
  store.setFocus("p0-2");
  vi.advanceTimersByTime(250);
  expect(store.isMounted("p0-2")).toBe(true);
  store.dispose();
});

it("retries a cancelled picture mount before the old commit deadline", () => {
  const panes = row(5);
  const store = createPaneLifecycleStore(panes, "p0-0");
  const transitions: boolean[] = [];
  store.subscribe("p0-2", () => transitions.push(store.isMounted("p0-2")));
  store.setPictures((paneId) => paneId === "p0-0" || paneId === "p0-1");
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
  store.dispose();
});
