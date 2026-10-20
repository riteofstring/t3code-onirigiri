import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { usePreviewPanelInlineSize } from "./usePreviewPanelInlineSize";

let renderer: ReactTestRenderer;
let result: ReturnType<typeof usePreviewPanelInlineSize>;
let events: EventTarget;
let container: HTMLElement;
let containerWidth: number;
let resizeCallback: ResizeObserverCallback;
let observer: ResizeObserver;
const readWidth = vi.fn(() => containerWidth);
const observe = vi.fn();
const disconnect = vi.fn();
const savedWidths = new Map<string, string>();
const setItem = vi.fn((key: string, value: string) => savedWidths.set(key, value));
const frames = new Map<number, FrameRequestCallback>();
let frameId: number;

function Panel({ enabled }: { enabled: boolean }) {
  const size = usePreviewPanelInlineSize(undefined, {
    enabled,
    container,
    widthStorageKey: "test-preview-width",
  });
  useLayoutEffect(() => {
    result = size;
  });
  return null;
}

async function resizeWindow(width: number) {
  window.innerWidth = width;
  await act(() => events.dispatchEvent(new Event("resize")));
}

async function paintFrame() {
  await act(() => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(0);
  });
}

async function resizeContainer(width: number) {
  containerWidth = width;
  await act(() =>
    resizeCallback(
      [
        {
          target: container,
          contentRect: {
            x: 0,
            y: 0,
            top: 0,
            left: 0,
            right: width,
            bottom: 600,
            width,
            height: 600,
            toJSON: () => ({ width, height: 600 }),
          },
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        },
      ],
      observer,
    ),
  );
}

beforeEach(async () => {
  events = new EventTarget();
  containerWidth = 900;
  container = Object.defineProperty({}, "clientWidth", { get: readWidth }) as HTMLElement;
  frames.clear();
  frameId = 0;
  savedWidths.clear();
  savedWidths.set("test-preview-width", "900");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    innerWidth: 1600,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    localStorage: { getItem: (key: string) => savedWidths.get(key) ?? null, setItem },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
  });
  observer = { observe, unobserve: vi.fn(), disconnect };
  vi.stubGlobal("ResizeObserver", function (callback: ResizeObserverCallback) {
    resizeCallback = callback;
    return observer;
  });
  await act(() => {
    renderer = create(<Panel enabled={false} />);
  });
});

afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("inline preview measurement lifetime", () => {
  it("does not lay out an absent panel's container on mount or window resize", async () => {
    expect(readWidth).not.toHaveBeenCalled();
    expect(observe).not.toHaveBeenCalled();
    await resizeWindow(1200);
    expect(frames.size).toBe(0);
    await paintFrame();
    expect(readWidth).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("clamps on opening and follows container and window resizing without overwriting the saved width", async () => {
    await act(() => renderer.update(<Panel enabled />));
    expect(result.width).toBe(540);
    await resizeContainer(1300);
    expect(result.width).toBe(900);
    await resizeWindow(1000);
    await paintFrame();
    expect(result.width).toBe(700);
    expect(savedWidths.get("test-preview-width")).toBe("900");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("cancels pending measurements while absent and remeasures before showing again", async () => {
    await act(() => renderer.update(<Panel enabled />));
    await resizeWindow(1400);
    expect(frames.size).toBe(1);
    await act(() => renderer.update(<Panel enabled={false} />));
    expect(frames.size).toBe(0);
    readWidth.mockClear();
    await resizeContainer(600);
    await resizeWindow(1000);
    await paintFrame();
    expect(readWidth).not.toHaveBeenCalled();
    await act(() => renderer.update(<Panel enabled />));
    expect(result.width).toBe(360);
    await resizeContainer(1400);
    expect(result.width).toBe(700);
    expect(savedWidths.get("test-preview-width")).toBe("900");
    expect(setItem).not.toHaveBeenCalled();
  });
});
