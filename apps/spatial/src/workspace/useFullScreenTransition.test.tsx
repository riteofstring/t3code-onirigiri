import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import {
  FULL_SCREEN_FADE_OUT_MS,
  FULL_SCREEN_SETTLE_MS,
  useFullScreenTransition,
} from "./useFullScreenTransition";

let renderer: ReactTestRenderer | undefined;
let reducedMotion = false;
let seen: { fullScreen: boolean; phase: string | null } | null = null;
function Probe({ requested, animate }: { requested: boolean; animate: boolean }) {
  const { fullScreen, phase } = useFullScreenTransition(requested, animate);
  useEffect(() => {
    seen = { fullScreen, phase };
  });
  return null;
}
async function show(requested: boolean, animate = true) {
  await act(() => {
    if (renderer) renderer.update(<Probe requested={requested} animate={animate} />);
    else renderer = create(<Probe requested={requested} animate={animate} />);
  });
}
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  seen = null;
  reducedMotion = false;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("fades the workspace out, swaps the layout unseen, then fades it back in", async () => {
  await show(false);
  expect(seen).toEqual({ fullScreen: false, phase: null });

  await show(true);
  expect(seen).toEqual({ fullScreen: false, phase: "out" });

  await advance(FULL_SCREEN_FADE_OUT_MS);
  expect(seen).toEqual({ fullScreen: true, phase: "swap" });

  await advance(32);
  expect(seen).toEqual({ fullScreen: true, phase: "in" });

  await advance(FULL_SCREEN_SETTLE_MS);
  expect(seen).toEqual({ fullScreen: true, phase: null });
});

it("keeps the layout when the toggle is undone during the fade-out", async () => {
  await show(false);
  await show(true);
  await advance(FULL_SCREEN_FADE_OUT_MS / 2);
  await show(false);
  expect(seen).toEqual({ fullScreen: false, phase: "in" });

  await advance(FULL_SCREEN_SETTLE_MS);
  expect(seen).toEqual({ fullScreen: false, phase: null });
});

it("applies the layout at once when the stage cannot animate or motion is reduced", async () => {
  await show(false, false);
  await show(true, false);
  expect(seen).toEqual({ fullScreen: true, phase: null });

  reducedMotion = true;
  await show(false);
  expect(seen).toEqual({ fullScreen: false, phase: null });
});
