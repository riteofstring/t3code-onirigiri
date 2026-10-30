import { afterEach, expect, it, vi } from "vite-plus/test";
import { afterUsablePaint } from "./afterUsablePaint";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function frames() {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (key: number) => callbacks.delete(key));
  return () => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    for (const callback of pending) callback(0);
  };
}

it("lets the settled composer paint before history runs in a separate task", () => {
  vi.useFakeTimers();
  const paint = frames();
  const history = vi.fn();
  afterUsablePaint(history);
  paint();
  expect(history).not.toHaveBeenCalled();
  paint();
  expect(history).not.toHaveBeenCalled();
  vi.runAllTimers();
  expect(history).toHaveBeenCalledOnce();
});

it.each([0, 1, 2])("cancels obsolete history after %i frames", (count) => {
  vi.useFakeTimers();
  const paint = frames();
  const history = vi.fn();
  const cancel = afterUsablePaint(history);
  for (let index = 0; index < count; index++) paint();
  cancel();
  paint();
  paint();
  vi.runAllTimers();
  expect(history).not.toHaveBeenCalled();
});
