// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { beginMaximizeReveal } from "./maximizeReveal";

let reducedMotion = false;
const animations: Keyframe[][] = [];

function rect(x: number, y: number, width: number, height: number) {
  return () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height });
}

function createPane() {
  const pane = document.createElement("section");
  pane.dataset.onirigiriSlot = "pane";
  pane.dataset.onirigiriPaneId = "pane:one";
  pane.style.borderRadius = "12px";
  pane.getBoundingClientRect = rect(500, 20, 520, 900) as never;
  document.body.append(pane);
  return pane;
}

beforeEach(() => {
  reducedMotion = false;
  animations.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  Element.prototype.animate = function (keyframes: Keyframe[]) {
    animations.push(keyframes);
    return {} as Animation;
  };
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("opens the maximized pane outward from the box it had before", () => {
  const pane = createPane();
  const reveal = beginMaximizeReveal("pane:one");
  pane.getBoundingClientRect = rect(300, 10, 1300, 980) as never;
  reveal();
  expect(animations).toEqual([
    [
      { clipPath: "inset(10px 580px 70px 200px round 12px)" },
      { clipPath: "inset(0px round 12px)" },
    ],
  ]);
});

it("does not animate when reduced motion is requested", () => {
  reducedMotion = true;
  const pane = createPane();
  const reveal = beginMaximizeReveal("pane:one");
  pane.getBoundingClientRect = rect(300, 10, 1300, 980) as never;
  reveal();
  expect(animations).toEqual([]);
});
