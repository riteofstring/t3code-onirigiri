import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  measureComposerMultilinePrompt,
  useComposerMultilinePrompt,
} from "./useComposerMultilinePrompt";

function measure(input: {
  width: number;
  height: number;
  resting?: boolean;
  hidden?: boolean;
  scale?: number;
}) {
  const scale = input.scale ?? 1;
  const layoutWidth = input.hidden ? 0 : input.resting ? 400 : 500;
  const editor = {
    clientWidth: layoutWidth,
    offsetWidth: layoutWidth,
    getBoundingClientRect: () => ({ width: layoutWidth * scale }),
  };
  const body = { clientWidth: 532, querySelector: () => editor };
  vi.stubGlobal("getComputedStyle", (element: unknown) =>
    element === body
      ? { paddingLeft: "16px", paddingRight: "16px" }
      : { lineHeight: input.resting ? "32px" : "22.75px" },
  );
  vi.stubGlobal("document", {
    createRange: () => ({
      selectNodeContents() {},
      getBoundingClientRect: () => ({ width: input.width * scale, height: input.height * scale }),
    }),
  });
  return measureComposerMultilinePrompt(body as unknown as HTMLElement);
}

afterEach(() => vi.unstubAllGlobals());

describe("composer prompt line measurement", () => {
  it("allows a single line even though the editor has a larger minimum height", () => {
    expect(measure({ width: 500, height: 22.75 })).toBe(false);
  });

  it("keeps soft-wrapped lines expanded", () => {
    expect(measure({ width: 500, height: 45.5 })).toBe(true);
  });

  it("recognizes a long restored draft while the resting row is unwrapped", () => {
    expect(measure({ width: 700, height: 32, resting: true })).toBe(true);
  });

  it("uses the expanded width so inline actions cannot cause a collapse loop", () => {
    expect(measure({ width: 450, height: 32, resting: true })).toBe(false);
    expect(measure({ width: 500, height: 22.75 })).toBe(false);
  });

  it("allows collapse again after deleting the second line", () => {
    expect(measure({ width: 500, height: 45.5 })).toBe(true);
    expect(measure({ width: 500, height: 22.75 })).toBe(false);
  });

  it("measures the same under a scaled ancestor", () => {
    expect(measure({ width: 500, height: 45.5, scale: 0.4 })).toBe(true);
    expect(measure({ width: 500, height: 22.75, scale: 0.4 })).toBe(false);
  });

  it("retains the previous measurement when the editor is hidden", () => {
    expect(measure({ width: 0, height: 0, hidden: true })).toBeNull();
  });
});

describe("composer prompt line observation", () => {
  let renderer: ReactTestRenderer | undefined;
  afterEach(async () => {
    if (renderer) await act(() => renderer!.unmount());
    renderer = undefined;
  });

  it("follows a replaced editor element", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const observed = new Set<unknown>();
    let mutate = () => {};
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(element: unknown) {
          observed.add(element);
        }
        unobserve(element: unknown) {
          observed.delete(element);
        }
        disconnect() {
          observed.clear();
        }
      },
    );
    vi.stubGlobal(
      "MutationObserver",
      class {
        constructor(callback: () => void) {
          mutate = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const staticEditor = { clientWidth: 0 };
    const liveEditor = { clientWidth: 0 };
    let editor = staticEditor;
    const body = { querySelector: () => editor } as unknown as HTMLElement;
    function Probe() {
      useComposerMultilinePrompt(body);
      return null;
    }
    await act(() => {
      renderer = create(createElement(Probe));
    });
    expect(observed.has(staticEditor)).toBe(true);

    editor = liveEditor;
    mutate();
    await act(() => frames.shift()?.(0));
    expect(observed.has(liveEditor)).toBe(true);
    expect(observed.has(staticEditor)).toBe(false);
    expect(observed.has(body)).toBe(true);
  });
});
