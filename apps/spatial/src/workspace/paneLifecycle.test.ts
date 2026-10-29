import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createPaneLifecycleStore, type PaneLifecycleStore } from "./paneLifecycle";

const stores: PaneLifecycleStore[] = [];
const panes = Array.from({ length: 40 }, (_, slot) => ({ paneId: `p${slot}`, plane: 0, slot }));
const mounted = (store: PaneLifecycleStore) =>
  panes.filter((p) => store.isMounted(p.paneId)).map((p) => p.paneId);
const make = () => {
  const store = createPaneLifecycleStore(panes, "p0");
  stores.push(store);
  return store;
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
  );
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps only focus mounted through a forty-pane tour including visible neighbours", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  for (const pane of panes) store.setVisible(pane.paneId, true);
  vi.advanceTimersByTime(20_000);
  expect(mounted(store)).toEqual(["p0"]);
  for (const pane of panes) {
    store.setFocus(pane.paneId);
    expect(mounted(store)).toEqual([pane.paneId]);
  }
  store.setFocus(null);
  expect(mounted(store)).toEqual([]);
});

it("releases departure immediately, skips crossed destinations and mounts final arrival after motion", () => {
  const store = make();
  store.setMoving(true);
  store.setFocus("p1");
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual([]);
  store.setFocus("p30");
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual([]);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p30"]);
});

it.each(["success", "failure", "timeout", "motion", "disable"])(
  "releases the temporary capture on %s",
  (ending) => {
    const store = make();
    const fresh = new Set(["p0"]);
    store.setPictures((id) => fresh.has(id));
    store.setBackgroundPictures(true);
    vi.advanceTimersByTime(4000);
    expect(mounted(store)).toEqual(["p0", "p1"]);
    if (ending === "success") {
      fresh.add("p1");
      store.setPictures((id) => fresh.has(id));
    } else if (ending === "failure") store.pictureFailed("p1", performance.now());
    else if (ending === "motion") store.setMoving(true);
    else if (ending === "disable") store.setBackgroundPictures(false);
    else vi.advanceTimersByTime(10_000);
    expect(store.isMounted("p1")).toBe(false);
    expect(mounted(store).length).toBeLessThanOrEqual(2);
  },
);

it("does not mount during a held resize and replaces stale covers ahead of missing pictures", () => {
  const store = make();
  store.setPictures(
    (id) => id === "p0",
    true,
    () => true,
    (id) => id === "p20",
  );
  window.dispatchEvent(new Event("pointerdown"));
  store.setBackgroundPictures(true);
  store.setFocus("p2");
  vi.advanceTimersByTime(20_000);
  expect(mounted(store)).toEqual([]);
  window.dispatchEvent(new Event("pointerup"));
  expect(mounted(store)).toEqual(["p2"]);
  vi.advanceTimersByTime(450);
  expect(mounted(store)).toEqual(["p2", "p20"]);
  store.setPictures(
    (id) => id === "p0" || id === "p20",
    true,
    () => true,
    (id) => id === "p20",
  );
  expect(mounted(store)).toEqual(["p2"]);
});

it("promotes the capture owner to focus and does not release it on late capture completion", () => {
  const store = make();
  store.setPictures((id) => id === "p0");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(4000);
  store.setFocus("p1");
  expect(mounted(store)).toEqual(["p1"]);
  store.pictureFailed("p1", performance.now());
  expect(mounted(store)).toEqual(["p1"]);
});

it("backs off failed captures while letting other panes get pictures", () => {
  const store = make();
  store.setPictures((id) => id === "p0");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(4000);
  store.pictureFailed("p1", performance.now());
  vi.advanceTimersByTime(100);
  expect(mounted(store)).toEqual(["p0", "p2"]);
  expect(store.isMounted("p1")).toBe(false);
});
