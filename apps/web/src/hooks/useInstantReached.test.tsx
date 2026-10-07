import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useInstantReached } from "./useInstantReached";

let renderer: ReactTestRenderer;
let reached = false;
let renders = 0;

function Probe({ at }: { at: number | null }) {
  const value = useInstantReached(at);
  useLayoutEffect(() => {
    reached = value;
    renders += 1;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  renders = 0;
});

afterEach(() => {
  act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("turns true once at the instant without re-rendering before it", () => {
  act(() => {
    renderer = create(<Probe at={60_000} />);
  });
  act(() => vi.advanceTimersByTime(59_999));
  expect(reached).toBe(false);
  expect(renders).toBe(1);
  act(() => vi.advanceTimersByTime(1));
  expect(reached).toBe(true);
  expect(renders).toBe(2);
});

it("reports an instant already passed on the first render and never reaches null", () => {
  act(() => {
    renderer = create(<Probe at={-1} />);
  });
  expect(reached).toBe(true);
  expect(renders).toBe(1);
  act(() => renderer.update(<Probe at={null} />));
  act(() => vi.advanceTimersByTime(600_000));
  expect(reached).toBe(false);
});

it("restarts when the instant moves", () => {
  act(() => {
    renderer = create(<Probe at={1_000} />);
  });
  act(() => renderer.update(<Probe at={5_000} />));
  act(() => vi.advanceTimersByTime(1_000));
  expect(reached).toBe(false);
  act(() => vi.advanceTimersByTime(4_000));
  expect(reached).toBe(true);
});
