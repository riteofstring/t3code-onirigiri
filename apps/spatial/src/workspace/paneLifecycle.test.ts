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

it("retains loaded panes through a tour and evicts the least recent only after the quiet tail", () => {
  const store = make();
  store.setPictures(() => true);
  store.setVisible("p20", true);
  for (let i = 1; i < 39; i++) store.setFocus(`p${i}`);
  expect(mounted(store)).toHaveLength(39);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toHaveLength(32);
  expect(store.isMounted("p20")).toBe(true);
  expect(store.isMounted("p38")).toBe(true);
  expect(store.isMounted("p0")).toBe(false);
});

it("does not mount or release destinations while moving", () => {
  const store = make();
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p30");
  store.setVisible("p27", true);
  vi.advanceTimersByTime(5000);
  expect(mounted(store)).toEqual(["p0"]);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p0", "p27", "p30"]);
});

it("retains dirty departures even beyond the retention cap", () => {
  const store = make();
  store.setPictures(() => false);
  for (let i = 1; i < 39; i++) store.setFocus(`p${i}`);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toHaveLength(39);
});

it("fills one nearest unloaded tree per idle slot, including panes with saved pictures", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(499);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(2);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  store.contentMounted("p1");
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(["p0", "p1", "p2"]);
});

it("input restarts the quiet interval and leaves retained trees intact", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(400);
  window.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(499);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(2);
  expect(mounted(store)).toEqual(["p0", "p1"]);
});

it("protects the entire visible set when it exceeds the retained cap", () => {
  const store = createPaneLifecycleStore(panes, "p0", 2);
  stores.push(store);
  store.setPictures(() => true);
  for (const id of ["p1", "p2", "p3"]) store.setVisible(id, true);
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual(["p0", "p1", "p2", "p3"]);
});

it("fills the nearest spare tree even when a farther tree lacks a picture", () => {
  const store = make();
  store.setPictures((id) => id === "p0" || id === "p1");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toEqual(["p0", "p1"]);
});
