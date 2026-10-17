// @vitest-environment jsdom

import { act, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerRestingTransition } from "./ChatComposer";

type AnimationRecord = {
  target: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  currentTime: number;
  canceled: boolean;
  cancel: ReturnType<typeof vi.fn>;
  finished: Promise<void>;
  finish: () => void;
  effect: { getComputedTiming: () => { duration: number } };
};

let container: HTMLDivElement;
let root: Root | undefined;
let cameraScale: number;
let expandedHeight: number;
let reportedResting: boolean;
let observer: ControlledResizeObserver;
let animations: AnimationRecord[];
const measurements = vi.fn();
const publications = vi.fn<(height: number, resting: boolean) => void>();
const publish = (height: number) => publications(height, reportedResting);
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");

function node(part: string) {
  const element = container.querySelector<HTMLElement>(`[data-part="${part}"]`);
  if (!element) throw new Error(`Missing ${part}`);
  return element;
}

function rectangle(element: HTMLElement, scale = cameraScale): DOMRect {
  const composer = node("composer");
  const collapsed = composer.dataset.collapsed === "true";
  const stripHeight = Number(node("strip").dataset.height);
  const naturalHeight = collapsed ? 64.25 : expandedHeight;
  const part = element.dataset.part;
  let height = naturalHeight;
  let top = 700 - stripHeight - naturalHeight;
  let width = 520.5;
  if (part === "overlay") {
    height += stripHeight;
  } else if (part === "strip" || part === "resting-controls") {
    height = stripHeight;
    top = 700 - stripHeight;
  } else if (part === "prompt") {
    height = collapsed ? 24.5 : 80.75;
    top += 8.25;
  } else if (part === "footer" || part === "actions" || part === "controls") {
    height = 24;
    top += naturalHeight - height;
    width = 100.25;
  } else if (part === "body") {
    height -= 16.25;
  }
  const animation = animations.findLast(
    (value) => value.target === element && !value.canceled && value.frames[0]?.height,
  );
  if (animation) {
    const from = Number.parseFloat(String(animation.frames[0]?.height));
    const to = Number.parseFloat(String(animation.frames[1]?.height));
    height = from + (to - from) * (animation.currentTime / Number(animation.options.duration));
  }
  const left = 40.25;
  return {
    x: left * scale,
    y: top * scale,
    top: top * scale,
    left: left * scale,
    bottom: (top + height) * scale,
    right: (left + width) * scale,
    width: width * scale,
    height: height * scale,
    toJSON: () => ({}),
  };
}

class ControlledResizeObserver {
  readonly targets = new Set<Element>();

  constructor(private readonly callback: ResizeObserverCallback) {
    observer = this;
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  deliver(targets = [...this.targets]) {
    this.deliverEntries(
      targets.map(
        (target) =>
          ({ target, contentRect: rectangle(target as HTMLElement, 1) }) as ResizeObserverEntry,
      ),
    );
  }

  deliverEntries(entries: ResizeObserverEntry[]) {
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

function Composer({
  collapsed,
  resting,
  restingControls,
}: {
  collapsed: boolean;
  resting: boolean;
  restingControls: RefObject<HTMLDivElement | null>;
}) {
  useLayoutEffect(() => {
    reportedResting = resting;
  }, [resting]);
  const ref = useComposerRestingTransition(collapsed, resting, restingControls, publish, true, 240);
  return (
    <div
      ref={ref}
      data-part="composer"
      data-collapsed={String(collapsed)}
      style={{ width: "520.5px", boxSizing: "border-box" }}
    >
      <div data-chat-composer-surface="true" data-part="surface">
        <div data-chat-composer-body="true" data-part="body">
          <div data-composer-prompt-surface="true" data-part="prompt" />
          <div data-chat-composer-transition-actions="true" data-part="actions" />
          <div data-chat-composer-controls="left" data-part="controls" />
        </div>
      </div>
      <div data-chat-composer-footer="true" data-part="footer" />
    </div>
  );
}

function Surface({
  collapsed,
  resting,
  stripHeight,
  mounted,
}: {
  collapsed: boolean;
  resting: boolean;
  stripHeight: number;
  mounted: boolean;
}) {
  const restingControls = useRef<HTMLDivElement>(null);
  return (
    <div data-slot="composer-shell" data-part="shell">
      <div
        data-chat-composer-overlay="true"
        data-part="overlay"
        style={{ width: "520.5px", boxSizing: "border-box" }}
      >
        {mounted ? (
          <Composer collapsed={collapsed} resting={resting} restingControls={restingControls} />
        ) : (
          <div data-part="status">Provider status</div>
        )}
        {mounted && (
          <div
            data-composer-model-strip="true"
            data-part="strip"
            data-height={stripHeight}
            style={{ marginTop: "-16.25px" }}
          >
            <div ref={restingControls} data-part="resting-controls" />
          </div>
        )}
      </div>
    </div>
  );
}

function Parent({
  collapsed,
  resting,
  stripHeight,
  mounted,
}: {
  collapsed: boolean;
  resting: boolean;
  stripHeight: number;
  mounted: boolean;
}) {
  const [committedStripHeight, setCommittedStripHeight] = useState(0);
  useLayoutEffect(() => setCommittedStripHeight(stripHeight), [stripHeight]);
  return (
    <Surface
      collapsed={collapsed}
      resting={resting}
      stripHeight={committedStripHeight}
      mounted={mounted}
    />
  );
}

async function render(collapsed = false, resting = false, stripHeight = 27.5, mounted = true) {
  await act(() => {
    root?.render(
      <Parent
        collapsed={collapsed}
        resting={resting}
        stripHeight={stripHeight}
        mounted={mounted}
      />,
    );
  });
}

async function resize(targets?: Element[]) {
  await act(() => observer.deliver(targets));
}

beforeEach(() => {
  cameraScale = 0.4;
  expandedHeight = 156.75;
  reportedResting = false;
  animations = [];
  measurements.mockClear();
  publications.mockClear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", ControlledResizeObserver);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    measurements(this);
    return rectangle(this);
  });
  vi.spyOn(HTMLElement.prototype, "getClientRects").mockImplementation(function (
    this: HTMLElement,
  ) {
    measurements(this);
    return [rectangle(this)] as unknown as DOMRectList;
  });
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
      let finish = () => {};
      const record: AnimationRecord = {
        target: this,
        frames,
        options,
        currentTime: 0,
        canceled: false,
        cancel: vi.fn(() => {
          record.canceled = true;
        }),
        finished: new Promise<void>((resolve) => {
          finish = resolve;
        }),
        finish: () => finish(),
        effect: { getComputedTiming: () => ({ duration: Number(options.duration) }) },
      };
      animations.push(record);
      return record as unknown as Animation;
    },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container.remove();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("composer resting geometry", () => {
  it.each([false, true])(
    "initializes a collapsed=%s composer only on resize delivery",
    async (collapsed) => {
      await render(collapsed, collapsed);
      expect(measurements).not.toHaveBeenCalled();
      expect(publications).not.toHaveBeenCalled();
      await resize();
      expect(publications).toHaveBeenCalledOnce();
      expect(publications.mock.calls[0]?.[0]).toBeCloseTo((collapsed ? 64.25 : 156.75) + 27.5);
      expect(publications.mock.calls[0]?.[1]).toBe(collapsed);
      expect(animations).toHaveLength(0);
    },
  );

  it("coalesces parent-strip and resting changes before the first delivery", async () => {
    await render(true, true, 27.5);
    await render(false, false, 31.25);
    expect(measurements).not.toHaveBeenCalled();
    expect(publications).not.toHaveBeenCalled();
    await resize();
    expect(publications.mock.calls).toEqual([[188, false]]);
    expect(animations).toHaveLength(0);

    await render(true, true, 31.25);
    const height = animations.find((animation) => animation.target === node("composer"));
    expect(height?.frames).toEqual([{ height: "156.75px" }, { height: "64.25px" }]);
    expect(animations.find((animation) => animation.target === node("strip"))?.frames).toEqual([
      { height: "16.25px" },
      { height: "31.25px" },
    ]);
  });

  it.each([0.125, 0.5, 1, 2])(
    "preserves fractional transition geometry at scale %s",
    async (scale) => {
      cameraScale = scale;
      await render(true, true);
      await resize();
      await render(false, false);
      const height = animations.find((animation) => animation.target === node("composer"));
      expect(height?.frames).toEqual([{ height: "64.25px" }, { height: "156.75px" }]);
      expect(node("overlay").style.height).toBe("184.25px");
      expect(animations.find((animation) => animation.target === node("strip"))?.frames).toEqual([
        { height: "27.5px" },
        { height: "16.25px" },
      ]);
    },
  );

  it("republishes an initialized resting flag even when geometry is unchanged", async () => {
    await render(false, false);
    await resize();
    publications.mockClear();
    await render(false, true);
    expect(publications.mock.calls).toEqual([[184.25, true]]);
    expect(animations).toHaveLength(0);
  });

  it("retargets a body resize from the current height without restarting arrival fades", async () => {
    await render(true, true);
    await resize();
    await render(false, false);
    const first = animations.find((animation) => animation.target === node("composer"));
    expect(first).toBeDefined();
    if (!first) throw new Error("Missing height animation");
    first.currentTime = 120;
    const arrivals = animations.filter((animation) => animation.frames[0]?.opacity === 0);
    expect(arrivals.length).toBeGreaterThan(0);
    expandedHeight = 180.5;
    await resize([node("body")]);
    const retargeted = animations.findLast((animation) => animation.target === node("composer"));
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(retargeted?.frames).toEqual([{ height: "110.5px" }, { height: "180.5px" }]);
    expect(retargeted?.options.duration).toBe(240);
    expect(node("overlay").style.height).toBe("208px");
    for (const arrival of arrivals) expect(arrival.cancel).not.toHaveBeenCalled();
    await act(() => first.finish());
    expect(node("overlay").style.height).toBe("208px");
  });

  it("ignores a retained initial delivery after removal", async () => {
    await render();
    const targets = [...observer.targets];
    const staleEntries = targets.map(
      (target) =>
        ({ target, contentRect: rectangle(target as HTMLElement, 1) }) as ResizeObserverEntry,
    );
    await act(() => root?.unmount());
    root = undefined;
    await act(() => {
      observer.deliverEntries(staleEntries);
    });
    expect(measurements).not.toHaveBeenCalled();
    expect(publications).not.toHaveBeenCalled();
    expect(animations).toHaveLength(0);
    expect(observer.targets.size).toBe(0);
  });

  it("cancels an active transition and releases the surviving shell and overlay on removal", async () => {
    await render(true, true);
    await resize();
    await render(false, false);
    const overlay = node("overlay");
    const shell = node("shell");
    const active = [...animations];
    expect(overlay.style.height).toBe("184.25px");
    expect(shell.hasAttribute("data-model-strip-transition")).toBe(true);
    await render(false, false, 27.5, false);
    expect(node("shell")).toBe(shell);
    expect(shell.isConnected).toBe(true);
    expect(node("overlay")).toBe(overlay);
    expect(node("status").textContent).toBe("Provider status");
    expect(shell.querySelector('[data-part="composer"]')).toBeNull();
    expect(shell.querySelector('[data-part="strip"]')).toBeNull();
    expect(shell.hasAttribute("data-model-strip-transition")).toBe(false);
    expect(overlay.style.height).toBe("");
    expect(overlay.style.display).toBe("");
    for (const animation of active) expect(animation.cancel).toHaveBeenCalled();
    const published = publications.mock.calls.length;
    await act(() => {
      for (const animation of active) animation.finish();
      vi.advanceTimersByTime(1000);
    });
    expect(publications).toHaveBeenCalledTimes(published);
    expect(overlay.style.height).toBe("");
    expect(shell.hasAttribute("data-model-strip-transition")).toBe(false);
  });
});
