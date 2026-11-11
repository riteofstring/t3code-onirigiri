// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { beginFullScreenGrow } from "./FullScreenBorder";

let reducedMotion = false;
const animations: { element: Element; keyframes: Keyframe[] }[] = [];

function rect(x: number, y: number, width: number, height: number) {
  return () => ({ x, y, width, height, top: y, left: x, right: x + width, bottom: y + height });
}

function createStage() {
  const spatial = document.createElement("div");
  spatial.getBoundingClientRect = rect(0, 0, 1600, 1000) as never;
  const workspace = document.createElement("div");
  workspace.className = "onirigiri-workspace";
  const pane = document.createElement("section");
  pane.dataset.onirigiriSlot = "pane";
  pane.dataset.focused = "true";
  pane.getBoundingClientRect = rect(500, 20, 520, 900) as never;
  workspace.append(pane);
  const border = document.createElement("div");
  border.getBoundingClientRect = rect(0, 0, 1600, 1000) as never;
  for (const piece of [
    "top-left",
    "top",
    "top-right",
    "right",
    "bottom-right",
    "bottom",
    "bottom-left",
    "left",
  ]) {
    const span = document.createElement("span");
    span.dataset.piece = piece;
    border.append(span);
  }
  spatial.append(workspace, border);
  document.body.append(spatial);
  return { border, pane };
}

beforeEach(() => {
  reducedMotion = false;
  animations.length = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
    animations.push({ element: this, keyframes });
    return { finished: new Promise(() => {}), cancel: () => {} } as unknown as Animation;
  };
  Element.prototype.getAnimations = () => [];
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("grows the focus border from where the pane was before it filled the screen", () => {
  const { border, pane } = createStage();
  const grow = beginFullScreenGrow(border);
  pane.getBoundingClientRect = rect(0, 0, 1600, 1000) as never;
  grow();
  expect(border.dataset.motion).toBe("grow");
  expect(border.parentElement?.hasAttribute("data-spatial-border-motion")).toBe(true);
  const topLeft = animations.find(
    ({ element }) => (element as HTMLElement).dataset.piece === "top-left",
  );
  expect(topLeft?.keyframes[0]).toEqual({ transform: "translate(500px, 20px)" });
  expect(topLeft?.keyframes[1]?.transform).toMatch(/^translate\(-\d+px, -\d+px\)$/);
});

it("does not animate the border when reduced motion is requested", () => {
  reducedMotion = true;
  const { border } = createStage();
  beginFullScreenGrow(border)();
  expect(border.dataset.motion).toBeUndefined();
  expect(animations).toEqual([]);
});
