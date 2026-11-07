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
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("retains loaded panes through a tour and evicts the farthest clean trees only after the quiet tail", () => {
  const store = make();
  store.setPictures(() => true);
  store.setVisible("p20", true);
  for (let i = 1; i < 39; i++) store.setFocus(`p${i}`);
  expect(mounted(store)).toHaveLength(39);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toHaveLength(10);
  expect(store.isMounted("p20")).toBe(true);
  expect(store.isMounted("p38")).toBe(true);
  expect(mounted(store)).toEqual(["p20", ...Array.from({ length: 9 }, (_, i) => `p${30 + i}`)]);
  expect(store.isMounted("p0")).toBe(false);
});

it.each(["batch", "successive"])(
  "releases removed visibility after %s closes and a later re-add",
  (removal) => {
    const store = make();
    store.setPictures(() => true);
    const removed = panes.slice(1, 15);
    for (const pane of removed) store.setVisible(pane.paneId, true);
    store.registerChat("p1", () => null);
    let current = panes;
    if (removal === "batch") {
      current = panes.filter((pane) => !removed.includes(pane));
      store.setPanes(current);
    } else {
      for (const pane of removed) {
        current = current.filter((entry) => entry !== pane);
        store.setPanes(current);
      }
    }
    for (let i = 15; i < 40; i++) store.setFocus(`p${i}`);
    vi.advanceTimersByTime(501);

    expect(mounted(store)).toEqual(panes.slice(30).map((pane) => pane.paneId));
    expect(store.timelineDeferred("p1")).toBe(false);
    store.setPanes(panes);
    expect(store.isMounted("p1")).toBe(false);
    store.setVisible("p1", true);
    expect(store.isMounted("p1")).toBe(true);
  },
);

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

it("keeps dirty mounted panes beyond ten until their pictures become current", () => {
  const store = make();
  for (let i = 1; i < 15; i++) store.setFocus(`p${i}`);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toHaveLength(15);
  store.setPictures(() => true);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${5 + i}`));
});

it("replaces distant clean trees with nearest neighbours after a focus jump", () => {
  const store = make();
  store.setPictures(() => true);
  for (let i = 1; i < 40; i++) store.setFocus(`p${i}`);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${30 + i}`));
  store.setFocus("p0");
  store.setBackgroundPictures(true);
  for (let i = 1; i < 10; i++) {
    vi.advanceTimersByTime(101);
    store.contentMounted(`p${i}`);
  }
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`));
});

it("removes eligible chat DOM after a covered frame, then admits focused and peer composers before timelines", () => {
  const store = make();
  store.setVisible("p0", true);
  store.setVisible("p1", true);
  store.setPictures(() => true);
  store.registerChat("p0", () => null);
  store.registerChat("p1", () => null);
  store.setMoving(true);
  expect(store.isMounted("p0")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(store.isMounted("p0")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(mounted(store)).toEqual([]);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p0"]);
  expect(store.timelineDeferred("p0")).toBe(true);
  store.composerReady("p0");
  expect(mounted(store)).toEqual(["p0", "p1"]);
  vi.advanceTimersByTime(100);
  expect(store.timelineDeferred("p0")).toBe(true);
  store.composerReady("p1");
  vi.advanceTimersByTime(16);
  expect(store.timelineDeferred("p1")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(store.timelineDeferred("p0")).toBe(false);
  expect(store.timelineDeferred("p1")).toBe(true);
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p1")).toBe(false);
  expect(store.measurements().moves[0]).toMatchObject({ removed: ["p0", "p1"], latched: [] });
});

it.each([
  "pending-approval",
  "pending-question",
  "in-progress-turn",
  "local-ui-interaction",
  "no-current-picture",
  "picture-not-decoded",
])("latches %s for the entire move", (reason) => {
  const store = make();
  store.setPictures(() => true);
  let risk: string | null = reason;
  const inspect = vi.fn(() => risk);
  store.registerChat("p0", inspect);
  store.setMoving(true);
  risk = null;
  store.setPictures(() => true);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0")).toBe(true);
  expect(inspect).toHaveBeenCalledOnce();
  expect(store.motionDecision("p0")).toBe(reason);
  expect(store.measurements().moves[0]?.latched).toEqual([{ paneId: "p0", reason }]);
  store.setMoving(false);
  store.setMoving(true);
  vi.advanceTimersByTime(32);
  expect(store.isMounted("p0")).toBe(false);
});

it("cancels removal on a short reversal and releases no timeline during a second move", () => {
  const store = make();
  store.setVisible("p0", true);
  store.registerChat("p0", () => null);
  store.setMoving(true);
  vi.advanceTimersByTime(16);
  store.setMoving(false);
  vi.advanceTimersByTime(16);
  expect(store.isMounted("p0")).toBe(true);
  store.setMoving(true);
  vi.advanceTimersByTime(32);
  store.setMoving(false);
  store.composerReady("p0");
  vi.advanceTimersByTime(16);
  store.setMoving(true);
  vi.advanceTimersByTime(16);
  expect(store.timelineDeferred("p0")).toBe(true);
});

it("keeps background picture preparation behind the visible arrival and mounts its full timeline", () => {
  const store = make();
  store.setFocus("p2");
  store.setFocus("p0");
  store.setVisible("p0", true);
  store.setVisible("p1", true);
  for (const id of ["p0", "p1", "p2"]) store.registerChat(id, () => null);
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  store.setMoving(true);
  vi.advanceTimersByTime(32);
  store.setMoving(false);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p2")).toBe(false);
  store.composerReady("p0");
  store.composerReady("p1");
  vi.advanceTimersByTime(33);
  expect(store.isMounted("p2")).toBe(false);
  vi.advanceTimersByTime(33);
  expect(store.isMounted("p2")).toBe(true);
  expect(store.timelineDeferred("p2")).toBe(false);
});

it("stages a cold visible chat behind the focused composer", () => {
  const store = make();
  store.registerChat("p0", () => null);
  store.registerChat("p1", () => null);
  store.setMoving(true);
  store.setVisible("p1", true);
  vi.advanceTimersByTime(32);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p0"]);
  store.composerReady("p0");
  expect(mounted(store)).toEqual(["p0", "p1"]);
  expect(store.timelineDeferred("p1")).toBe(true);
  vi.advanceTimersByTime(100);
  expect(store.timelineDeferred("p0")).toBe(true);
  store.composerReady("p1");
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p0")).toBe(false);
  expect(store.timelineDeferred("p1")).toBe(true);
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p1")).toBe(false);
});

it("does not wait for a pending composer that leaves the destination", () => {
  const store = make();
  for (const id of ["p0", "p1"]) {
    store.registerChat(id, () => null);
    store.setVisible(id, true);
  }
  store.setMoving(true);
  vi.advanceTimersByTime(32);
  store.setMoving(false);
  store.composerReady("p0");
  store.setMoving(true);
  store.setVisible("p1", false);
  store.setMoving(false);
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p0")).toBe(false);
});

it("mounts only visible chats without a current picture while overview has no focus", () => {
  const store = make();
  store.setPictures((id) => id !== "p26");
  store.setFocus(null);
  for (const id of ["p25", "p26", "p27"]) store.setVisible(id, true);
  vi.advanceTimersByTime(600);
  expect(store.isMounted("p26")).toBe(true);
  expect(store.isMounted("p25")).toBe(false);
  expect(store.isMounted("p27")).toBe(false);
});
