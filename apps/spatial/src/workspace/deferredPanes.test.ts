// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { deferOtherPanes, isDeferredPane, releaseDeferredPanes } from "./deferredPanes";

let idle: (() => void)[] = [];

function createPanes(lefts: number[], focused: number) {
  const root = document.createElement("div");
  const panes = lefts.map((left, index) => {
    const pane = document.createElement("section");
    pane.dataset.onirigiriSlot = "pane";
    pane.dataset.focused = String(index === focused);
    pane.getBoundingClientRect = () => new DOMRect(left, 0, 100, 100);
    pane.append(document.createElement("div"));
    root.append(pane);
    return pane;
  });
  document.body.append(root);
  return { root, panes };
}
const held = (panes: HTMLElement[]) => panes.map((pane) => isDeferredPane(pane.firstElementChild!));

beforeEach(() => {
  idle = [];
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => idle.push(callback));
  vi.stubGlobal("cancelIdleCallback", (id: number) => {
    idle[id - 1] = () => {};
  });
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("holds every pane but the focused one, then releases one per idle period from nearest out", () => {
  const { root, panes } = createPanes([900, 0, 300, 100], 3);
  deferOtherPanes(root);
  expect(held(panes)).toEqual([true, true, true, false]);
  releaseDeferredPanes(root);
  expect(held(panes)).toEqual([true, true, true, false]);
  idle.shift()!();
  expect(held(panes)).toEqual([true, false, true, false]);
  idle.shift()!();
  expect(held(panes)).toEqual([true, false, false, false]);
  idle.shift()!();
  expect(held(panes)).toEqual([false, false, false, false]);
  expect(idle).toEqual([]);
});

it("releases every held pane at once when the release is cancelled", () => {
  const { root, panes } = createPanes([0, 100, 200], 0);
  deferOtherPanes(root);
  releaseDeferredPanes(root)();
  expect(held(panes)).toEqual([false, false, false]);
});
