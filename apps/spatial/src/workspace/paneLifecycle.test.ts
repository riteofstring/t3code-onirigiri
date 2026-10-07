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
  expect(mountedOf(store, panes)).toEqual(["p0-2"]);
  drain(store, panes);
  expect(mountedOf(store, panes)).toEqual(["p0-1", "p0-2", "p0-3"]);
  store.dispose();
});

it("prepares the next pane in the direction of travel even with many panes on screen", () => {
  const panes = [...row(4, 0), ...row(12, 1)];
  const store = createPaneLifecycleStore(panes, "p0-0");
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
