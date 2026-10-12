// @vitest-environment jsdom

import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { BrowserSurfaceSlot } from "./BrowserSurfaceSlot";
import {
  BrowserSurfaceProjectionContext,
  type BrowserSurfaceProjectionPolicy,
} from "./browserSurfaceProjection";
import { acquireBrowserSurface, useBrowserSurfaceStore } from "./browserSurfaceStore";

class Observations {
  readonly targets = new Set<Element>();
  constructor(readonly notify: () => void) {}
  observe(target: Element) {
    this.targets.add(target);
  }
  disconnect() {
    this.targets.clear();
  }
}

let renderer: ReactTestRenderer | undefined;
let mutations: Observations | undefined;
let resizes: Observations;
let host: HTMLDivElement;
let content: HTMLDivElement;
let slot: HTMLDivElement;
let rect: DOMRect;
let measure: ReturnType<typeof vi.fn<() => DOMRect>>;
let policy: BrowserSurfaceProjectionPolicy;
const state = () => useBrowserSurfaceStore.getState().byTabId.guest!;

function view(projection: BrowserSurfaceProjectionPolicy | null = policy, layoutVersion = 0) {
  return (
    <BrowserSurfaceProjectionContext value={projection}>
      <BrowserSurfaceSlot
        tabId="guest"
        visible
        cornerRadius={12}
        zIndex={42}
        layoutVersion={layoutVersion}
      />
    </BrowserSurfaceProjectionContext>
  );
}

async function mount(projection: BrowserSurfaceProjectionPolicy | null = policy) {
  await act(() => {
    renderer = create(view(projection), { createNodeMock: () => slot });
  });
  measure.mockClear();
}

async function hide() {
  host.dataset.visible = "false";
  content.dataset.runtimeState = "hidden";
  await act(() => mutations!.notify());
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (notify: () => void) {
      resizes = new Observations(notify);
      return resizes;
    }),
  );
  vi.stubGlobal(
    "MutationObserver",
    vi.fn(function (notify: () => void) {
      mutations = new Observations(notify);
      return mutations;
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  host = document.createElement("div");
  content = document.createElement("div");
  slot = document.createElement("div");
  document.body.append(host);
  host.append(content);
  content.append(slot);
  host.dataset.visible = "true";
  content.dataset.runtimeState = "live";
  rect = new DOMRect(100, 80, 400, 600);
  measure = vi.fn(() => rect);
  slot.getBoundingClientRect = measure;
  slot.checkVisibility = () => content.dataset.runtimeState !== "hidden";
  Object.defineProperties(slot, {
    clientWidth: { get: () => 400 },
    clientHeight: { get: () => 600 },
  });
  policy = {
    canPresent: () => host.dataset.visible !== "false" && content.dataset.runtimeState !== "hidden",
    occluders: () => [],
    interactive: () => true,
    focus: () => undefined,
  };
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  mutations = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("hides a departing guest without reading layout or rewriting its hidden presentation", async () => {
  await mount();
  const shown = state();
  await hide();
  const hidden = state();
  expect(hidden.visible).toBe(false);
  expect(hidden.rect).toEqual(shown.rect);
  expect(hidden.projection).toEqual(shown.projection);
  expect(hidden.owner).toBe(shown.owner);
  expect(hidden.cornerRadius).toBe(12);
  expect(hidden.zIndex).toBe(42);
  rect = new DOMRect(-1000, 80, 400, 600);
  await act(() => mutations!.notify());
  expect(state()).toBe(hidden);
  expect(measure).not.toHaveBeenCalled();
});

it("waits for live content before restoring fresh geometry and input", async () => {
  await mount();
  await hide();
  host.dataset.visible = "true";
  rect = new DOMRect(200, 120, 200, 300);
  await act(() => mutations!.notify());
  expect(state().visible).toBe(false);
  expect(measure).not.toHaveBeenCalled();
  content.dataset.runtimeState = "live";
  await act(() => mutations!.notify());
  expect(state().visible).toBe(true);
  expect(state().rect).toEqual({ x: 200, y: 120, width: 200, height: 300 });
  expect(state().projection).toMatchObject({
    width: 400,
    height: 600,
    scaleX: 0.5,
    scaleY: 0.5,
    interactive: true,
  });
  expect(measure).toHaveBeenCalledOnce();
});

it("measures an initially hidden guest to retain its backing size", async () => {
  host.dataset.visible = "false";
  content.dataset.runtimeState = "hidden";
  await mount();
  expect(state().visible).toBe(false);
  expect(state().rect).toEqual({ x: 100, y: 80, width: 400, height: 600 });
  expect(state().projection).toMatchObject({ width: 400, height: 600 });
  const initial = state();
  await act(() => mutations!.notify());
  expect(state()).toBe(initial);
  expect(measure).not.toHaveBeenCalled();
});

it.each(["observer", "resize", "scroll", "presentation"] as const)(
  "keeps explicit %s measurement working while hidden",
  async (source) => {
    await mount();
    await hide();
    rect = new DOMRect(-1200, 90, 440, 650);
    await act(() => {
      if (source === "observer") resizes.notify();
      else if (source === "presentation") renderer!.update(view(policy, 1));
      else window.dispatchEvent(new Event(source));
    });
    expect(measure).toHaveBeenCalledOnce();
    expect(state().visible).toBe(false);
    expect(state().rect).toEqual({ x: -1200, y: 90, width: 440, height: 650 });
    const resized = state();
    await act(() => mutations!.notify());
    expect(state()).toBe(resized);
    expect(measure).toHaveBeenCalledOnce();
  },
);

it("does not reclaim a guest through hidden mutations but honors explicit presentation", async () => {
  await mount();
  await hide();
  const replacement = acquireBrowserSurface("guest", false);
  replacement.present({ x: 20, y: 30, width: 300, height: 200 }, true);
  const otherOwner = state().owner;
  await act(() => mutations!.notify());
  expect(state().owner).toBe(otherOwner);
  expect(state().visible).toBe(true);
  expect(measure).not.toHaveBeenCalled();
  await act(() => renderer!.update(view(policy, 1)));
  expect(state().owner).not.toBe(otherOwner);
  expect(state().visible).toBe(false);
  expect(measure).toHaveBeenCalledOnce();
  replacement.release();
  expect(state().owner).not.toBeNull();
});

it("rebinds ancestors while hidden so the returning guest can be measured", async () => {
  await mount();
  await hide();
  const formerHost = host;
  host = document.createElement("div");
  host.dataset.visible = "false";
  document.body.append(host);
  host.append(content);
  await act(() => mutations!.notify());
  expect(mutations!.targets.has(host)).toBe(true);
  expect(mutations!.targets.has(formerHost)).toBe(false);
  expect(resizes.targets.has(host)).toBe(true);
  expect(measure).not.toHaveBeenCalled();
  host.dataset.visible = "true";
  content.dataset.runtimeState = "live";
  await act(() => mutations!.notify());
  expect(state().visible).toBe(true);
  expect(measure).toHaveBeenCalledOnce();
});

it("preserves rounded geometry and resize behavior outside spatial projection", async () => {
  rect = new DOMRect(10.3, 20.7, 300.4, 200.6);
  await mount(null);
  expect(mutations).toBeUndefined();
  expect(state().projection).toBeNull();
  expect(state().rect).toEqual({ x: 10, y: 21, width: 300, height: 201 });
  rect = new DOMRect(40.8, 30.2, 450.5, 300.1);
  await act(() => resizes.notify());
  expect(state().rect).toEqual({ x: 41, y: 30, width: 451, height: 300 });
  expect(state().visible).toBe(true);
});
