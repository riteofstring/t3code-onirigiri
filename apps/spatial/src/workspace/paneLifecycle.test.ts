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

it("retains visible panes and navigation neighbours through a forty-pane tour", () => {
  const store = make();
  store.setPictures(() => true);
  store.setVisible("p20", true);
  for (let i = 1; i < 39; i++) {
    store.setFocus(`p${i}`);
    expect(mounted(store)).toEqual(
      [...new Set([i - 1, i, i + 1, 20])].sort((a, b) => a - b).map((i) => `p${i}`),
    );
  }
});

it("mounts cold destinations and newly visible content during motion", () => {
  const store = make();
  store.setPictures(() => true);
  store.setMoving(true);
  store.setFocus("p30");
  store.setVisible("p27", true);
  expect(mounted(store)).toEqual(["p27", "p29", "p30", "p31"]);
});

it("keeps departure mounted until its current capture is available", () => {
  const store = make();
  let current = false;
  store.setPictures((id) => id !== "p0" || current);
  store.setMoving(true);
  store.setFocus("p30");
  expect(store.isMounted("p0")).toBe(true);
  store.pictureFailed("p0", performance.now());
  expect(store.isMounted("p0")).toBe(true);
  current = true;
  store.setPictures((id) => id !== "p0" || current);
  expect(store.isMounted("p0")).toBe(false);
});

it("prepares vertical neighbours as well as horizontal neighbours", () => {
  const store = createPaneLifecycleStore(
    [...panes, { paneId: "up", slot: 0, plane: -2 }, { paneId: "down", slot: 0, plane: 3 }],
    "p0",
  );
  stores.push(store);
  expect(store.isMounted("up")).toBe(true);
  expect(store.isMounted("down")).toBe(true);
  expect(mounted(store)).toEqual(["p0", "p1"]);
});

it("serializes required admissions by destination then distance, reprioritizing pending work", async () => {
  const store = make();
  store.setMoving(true);
  store.setFocus("p20");
  const shown: string[] = [];
  let oldRequired = true;
  store.requestAdmission(
    "p5",
    () => oldRequired,
    () => shown.push("p5"),
  );
  store.requestAdmission(
    "p19",
    () => true,
    () => shown.push("p19"),
  );
  store.requestAdmission(
    "p20",
    () => true,
    () => shown.push("p20"),
  );
  await Promise.resolve();
  expect(shown).toEqual(["p20"]);
  await Promise.resolve();
  expect(shown).toEqual(["p20"]);
  oldRequired = false;
  store.setFocus("p18");
  store.requestAdmission(
    "p18",
    () => true,
    () => shown.push("p18"),
  );
  store.contentMounted("p20");
  await Promise.resolve();
  expect(shown).toEqual(["p20", "p18"]);
  store.contentMounted("p18");
  await Promise.resolve();
  expect(shown).toEqual(["p20", "p18", "p19"]);
  store.contentMounted("p19");
  await Promise.resolve();
  expect(shown).toEqual(["p20", "p18", "p19"]);
});
