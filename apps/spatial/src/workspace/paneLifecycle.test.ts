import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { createPaneLifecycleStore, type PaneLifecycleStore } from "./paneLifecycle";

const stores: PaneLifecycleStore[] = [];
const panes = Array.from({ length: 40 }, (_, slot) => ({ paneId: `p${slot}`, plane: 0, slot }));
const mounted = (store: PaneLifecycleStore) =>
  panes.filter((p) => store.isMounted(p.paneId)).map((p) => p.paneId);
const releasable = () => ({ blocksRemoval: () => false, prepareRemoval: vi.fn() });
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
    store.registerChat("p1", releasable());
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

it("mounts one nearest unpictured tree per idle slot and waits for its picture", () => {
  const store = make();
  const pictured = new Set(["p0", "p2"]);
  store.setPictures((id) => pictured.has(id));
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(1999);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(2);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  store.contentMounted("p1");
  pictured.add("p1");
  store.setPictures((id) => pictured.has(id));
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(["p0", "p1", "p3"]);
});

it("pictures every offscreen chat during one long rest, past the retention cap", () => {
  const store = make();
  const pictured = new Set(["p0"]);
  store.setPictures((id) => pictured.has(id));
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(501);
  for (let step = 0; step < 60 && pictured.size < panes.length; step++) {
    for (const id of mounted(store))
      if (!pictured.has(id)) {
        store.contentMounted(id);
        pictured.add(id);
      }
    store.setPictures((id) => pictured.has(id));
    vi.advanceTimersByTime(101);
  }
  expect(pictured.size).toBe(panes.length);
  expect(mounted(store).length).toBeLessThanOrEqual(10);
});

it("keeps the adjacent chats mounted in full screen even when their pictures are current", () => {
  const store = make();
  store.setPictures(() => true);
  store.setFocus("p5");
  store.setKeepNeighbours(true);
  vi.advanceTimersByTime(5000);
  expect(store.isMounted("p4")).toBe(true);
  expect(store.isMounted("p6")).toBe(true);
});

it("mounts no offscreen chat that already has a current picture", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(5000);
  expect(mounted(store)).toEqual(["p0"]);
});

const dataReady = (store: PaneLifecycleStore) =>
  panes.filter((p) => store.keepsDataReady(p.paneId)).map((p) => p.paneId);

it("keeps the six nearest offscreen chats' data ready after the quiet tail without mounting them", () => {
  const store = make();
  store.setVisible("p0", true);
  store.setVisible("p1", true);
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(499);
  expect(dataReady(store)).toEqual([]);
  vi.advanceTimersByTime(3);
  expect(dataReady(store).length).toBeGreaterThan(0);
  expect(dataReady(store).length).toBeLessThan(6);
  vi.advanceTimersByTime(100);
  expect(dataReady(store)).toEqual(["p2", "p3", "p4", "p5", "p6", "p7"]);
  expect(mounted(store)).toEqual(["p0", "p1"]);
});

it("moves the ready data with the focus", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
  store.setFocus("p20");
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toEqual(["p17", "p18", "p19", "p21", "p22", "p23"]);
});

it("readies no data without background pictures or while moving", () => {
  const store = make();
  store.setPictures(() => true);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toEqual([]);
  store.setBackgroundPictures(true);
  store.setMoving(true);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toEqual([]);
  store.setMoving(false);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toHaveLength(6);
});

it("stops readying data on entering overview and resumes at rest", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(502);
  const before = dataReady(store);
  expect(before.length).toBeGreaterThan(0);
  expect(before.length).toBeLessThan(6);
  store.setOverview(true, null);
  store.setBackgroundPictures(false);
  vi.advanceTimersByTime(2000);
  expect(dataReady(store)).toEqual(before);
  store.setOverview(false, "p0");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toHaveLength(6);
});

it("spends a ready slot on no chat that is already mounted", () => {
  const store = make();
  store.setPictures((id) => id !== "p1");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(2500);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  expect(dataReady(store)).toEqual(["p2", "p3", "p4", "p5", "p6", "p7"]);
});

it("waits for an idle slot with time to spare before readying data", () => {
  const store = make();
  let remaining = 0;
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => remaining }), 1),
  );
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(700);
  expect(dataReady(store)).toEqual([]);
  remaining = 50;
  vi.advanceTimersByTime(100);
  expect(dataReady(store)).toHaveLength(6);
});

it("forgets ready data for panes that are removed", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(700);
  expect(store.keepsDataReady("p1")).toBe(true);
  store.setPanes(panes.filter((pane) => pane.paneId !== "p1"));
  expect(store.keepsDataReady("p1")).toBe(false);
});

it("mounts only the retained chats after a move when every picture is current", () => {
  const store = make();
  store.setVisible("p0", true);
  store.setVisible("p1", true);
  for (const id of ["p0", "p1"]) store.registerChat(id, releasable());
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  store.setMoving(true);
  vi.advanceTimersByTime(48);
  expect(mounted(store)).toEqual([]);
  store.setMoving(false);
  store.composerReady("p0");
  store.composerReady("p1");
  vi.advanceTimersByTime(5000);
  expect(mounted(store)).toEqual(["p0", "p1"]);
});

it("mounts an offscreen chat once its picture stops being current", () => {
  const store = make();
  store.setPictures(() => true);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(5000);
  expect(mounted(store)).toEqual(["p0"]);
  store.setPictures((id) => id !== "p3");
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toEqual(["p0", "p3"]);
});

it("input restarts the rest interval before the next picture mount", () => {
  const store = make();
  store.setPictures((id) => id === "p0");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(400);
  window.dispatchEvent(new Event("keydown"));
  vi.advanceTimersByTime(1999);
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

it("skips pictured neighbours for the nearest chat that lacks a picture", () => {
  const store = make();
  store.setPictures((id) => id === "p0" || id === "p1");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(2001);
  expect(mounted(store)).toEqual(["p0", "p2"]);
});

it("pictures the chats focused most recently before nearer ones", () => {
  const store = make();
  store.setPictures((id) => id === "p0");
  vi.advanceTimersByTime(1);
  store.setFocus("p20");
  vi.advanceTimersByTime(1);
  store.setFocus("p30");
  vi.advanceTimersByTime(1);
  store.setFocus("p0");
  store.setPictures((id) => id === "p0");
  store.setMoving(true);
  for (const id of ["p20", "p30"]) store.registerChat(id, releasable());
  store.setMoving(false);
  store.setMoving(true);
  vi.advanceTimersByTime(72);
  store.setMoving(false);
  const pictured = new Set<string>();
  const take = (id: string) => {
    store.contentMounted(id);
    pictured.add(id);
    store.setPictures((pane) => pictured.has(pane));
  };
  store.setPictures((pane) => pictured.has(pane));
  expect(mounted(store)).toEqual(["p0"]);
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(2001);
  expect(mounted(store)).toEqual(["p0", "p30"]);
  take("p30");
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(["p0", "p20", "p30"]);
  take("p20");
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(["p0", "p1", "p20", "p30"]);
});

it("keeps dirty mounted panes beyond ten until their pictures become current", () => {
  const store = make();
  for (let i = 1; i < 15; i++) store.setFocus(`p${i}`);
  vi.advanceTimersByTime(501);
  expect(mounted(store)).toHaveLength(15);
  store.setPictures(() => true);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${5 + i}`));
});

it("replaces distant clean trees with the nearest stale neighbours after a focus jump", () => {
  const store = make();
  const stale = new Set<string>();
  store.setPictures((id) => !stale.has(id));
  for (let i = 1; i < 40; i++) store.setFocus(`p${i}`);
  vi.advanceTimersByTime(2001);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${30 + i}`));
  for (let i = 1; i < 10; i++) stale.add(`p${i}`);
  store.setPictures((id) => !stale.has(id));
  store.setFocus("p0");
  store.setBackgroundPictures(true);
  for (let i = 1; i < 10; i++) {
    vi.advanceTimersByTime(101);
    store.contentMounted(`p${i}`);
    stale.delete(`p${i}`);
    store.setPictures((id) => !stale.has(id));
  }
  vi.advanceTimersByTime(101);
  expect(mounted(store)).toEqual(Array.from({ length: 10 }, (_, i) => `p${i}`));
});

it("removes eligible chat DOM one chat per frame after a covered frame, then admits the focused chat whole before its peer", () => {
  const store = make();
  store.setVisible("p0", true);
  store.setVisible("p1", true);
  store.setPictures(() => true);
  store.registerChat("p0", releasable());
  store.registerChat("p1", releasable());
  store.setMoving(true);
  expect(store.isMounted("p0")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(store.isMounted("p0")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(mounted(store)).toEqual(["p1"]);
  vi.advanceTimersByTime(16);
  expect(mounted(store)).toEqual([]);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p0"]);
  expect(store.timelineDeferred("p0")).toBe(true);
  store.composerReady("p0");
  vi.advanceTimersByTime(16);
  expect(store.timelineDeferred("p0")).toBe(true);
  vi.advanceTimersByTime(16);
  expect(store.timelineDeferred("p0")).toBe(false);
  expect(mounted(store)).toEqual(["p0"]);
  store.setPresented("p0", true);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  expect(store.timelineDeferred("p1")).toBe(true);
  store.composerReady("p1");
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p1")).toBe(false);
});

it("holds a blocked chat live for the entire move and prepares only removable chats", () => {
  const store = make();
  store.setPictures(() => true);
  let blocked = true;
  const held = { blocksRemoval: vi.fn(() => blocked), prepareRemoval: vi.fn() };
  store.registerChat("p0", held);
  store.setMoving(true);
  blocked = false;
  store.setPictures(() => true);
  vi.advanceTimersByTime(1000);
  expect(store.isMounted("p0")).toBe(true);
  expect(held.blocksRemoval).toHaveBeenCalledOnce();
  expect(held.prepareRemoval).not.toHaveBeenCalled();
  expect(store.holdsLiveInMotion("p0")).toBe(true);
  store.setMoving(false);
  expect(store.holdsLiveInMotion("p0")).toBeUndefined();
  store.setMoving(true);
  expect(store.holdsLiveInMotion("p0")).toBe(false);
  expect(held.prepareRemoval).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(32);
  expect(store.isMounted("p0")).toBe(false);
});

it("cancels removal on a short reversal and releases no timeline during a second move", () => {
  const store = make();
  store.setVisible("p0", true);
  store.registerChat("p0", releasable());
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
  for (const id of ["p0", "p1", "p2"]) store.registerChat(id, releasable());
  store.setPictures((id) => id !== "p2");
  store.setBackgroundPictures(true);
  store.setMoving(true);
  vi.advanceTimersByTime(72);
  store.setMoving(false);
  vi.advanceTimersByTime(2000);
  expect(store.isMounted("p2")).toBe(false);
  store.composerReady("p0");
  vi.advanceTimersByTime(33);
  store.setPresented("p0", true);
  store.composerReady("p1");
  vi.advanceTimersByTime(50);
  expect(store.isMounted("p2")).toBe(false);
  store.setPresented("p1", true);
  vi.advanceTimersByTime(50);
  expect(store.isMounted("p2")).toBe(true);
  expect(store.timelineDeferred("p2")).toBe(false);
});

it("stages a cold visible chat behind the whole focused chat, or after a wait if its composer never reports ready", () => {
  const store = make();
  store.registerChat("p0", releasable());
  store.registerChat("p1", releasable());
  store.setMoving(true);
  store.setVisible("p1", true);
  vi.advanceTimersByTime(32);
  store.setMoving(false);
  expect(mounted(store)).toEqual(["p0"]);
  store.composerReady("p0");
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p0")).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual(["p0"]);
  store.setPresented("p0", true);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  expect(store.timelineDeferred("p1")).toBe(true);
  store.composerReady("p1");
  vi.advanceTimersByTime(32);
  expect(store.timelineDeferred("p1")).toBe(false);

  store.setPresented("p0", false);
  store.setMoving(true);
  vi.advanceTimersByTime(100);
  store.setMoving(false);
  vi.advanceTimersByTime(2400);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(200);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  store.composerReady("p1");
  vi.advanceTimersByTime(64);
  expect(store.timelineDeferred("p1")).toBe(false);
});

it("does not wait for a pending composer that leaves the destination", () => {
  const store = make();
  for (const id of ["p0", "p1"]) {
    store.registerChat(id, releasable());
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

it("remounts every visible chat, one at a time, when motion ends on an empty cell, pictured or not", () => {
  const store = make();
  store.setPictures((id) => id !== "p26");
  for (const id of ["p25", "p26", "p27"]) store.registerChat(id, releasable());
  store.setMoving(true);
  store.setFocus(null);
  for (const id of ["p25", "p26", "p27"]) store.setVisible(id, true);
  store.setMoving(false);
  const visibleMounted = () => mounted(store).filter((id) => id !== "p0");
  expect(visibleMounted()).toEqual(["p25"]);
  store.setPresented("p25", true);
  expect(visibleMounted()).toEqual(["p25", "p26"]);
  store.setPresented("p26", true);
  expect(visibleMounted()).toEqual(["p25", "p26", "p27"]);
});

it("admits no arriving chat in overview and restores focused-first admission when it ends", () => {
  const store = make();
  for (const id of ["p0", "p1", "p2"]) store.registerChat(id, releasable());
  store.setOverview(true, null);
  store.setMoving(true);
  for (const id of ["p1", "p2"]) store.setVisible(id, true);
  store.setMoving(false);
  vi.advanceTimersByTime(1000);
  expect(mounted(store)).toEqual(["p0"]);
  store.setOverview(false, "p1");
  expect(mounted(store)).toEqual(["p0", "p1"]);
  expect(store.timelineDeferred("p1")).toBe(true);
  expect(store.isMounted("p2")).toBe(false);
  store.composerReady("p1");
  expect(store.isMounted("p2")).toBe(false);
  store.setPresented("p1", true);
  expect(store.isMounted("p2")).toBe(true);
});

it("pictures unpictured chats behind their overview cards, on-screen and nearest the overview focus first", () => {
  const store = make();
  const pictured = new Set(["p0"]);
  store.setPictures((id) => pictured.has(id));
  store.setBackgroundPictures(true);
  store.setOverviewFocus("p20");
  store.setOverview(true, null);
  for (const id of ["p18", "p21", "p22"]) store.setVisible(id, true);
  const picture = (id: string) => {
    store.contentMounted(id);
    pictured.add(id);
    store.setPictures((candidate) => pictured.has(candidate));
    vi.advanceTimersByTime(102);
  };
  vi.advanceTimersByTime(1999);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(2);
  expect(mounted(store)).toEqual(["p0", "p21"]);
  picture("p21");
  expect(store.isMounted("p18")).toBe(true);
  picture("p18");
  expect(store.isMounted("p22")).toBe(true);
  picture("p22");
  expect(store.isMounted("p20")).toBe(true);
  expect(store.isMounted("p19")).toBe(false);
});

it("still pictures no chat that is on screen outside overview", () => {
  const store = make();
  store.setPictures(() => false);
  store.setBackgroundPictures(true);
  store.setVisible("p1", true);
  vi.advanceTimersByTime(2001);
  expect(store.isMounted("p1")).toBe(true);
  expect(store.pictureMount("p1")).toBe("ordinary");
  expect(store.pictureMount("p2")).toBe("background");
});

it("drops a chat still loading for its picture a frame after input arrives, and keeps one that has loaded", () => {
  const store = make();
  store.setPictures((id) => id === "p0");
  store.setBackgroundPictures(true);
  vi.advanceTimersByTime(2001);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  window.dispatchEvent(new Event("keydown"));
  expect(mounted(store)).toEqual(["p0", "p1"]);
  vi.advanceTimersByTime(16);
  expect(mounted(store)).toEqual(["p0"]);
  vi.advanceTimersByTime(2001);
  expect(mounted(store)).toEqual(["p0", "p1"]);
  store.contentMounted("p1");
  window.dispatchEvent(new Event("keydown"));
  expect(mounted(store)).toEqual(["p0", "p1"]);
});
