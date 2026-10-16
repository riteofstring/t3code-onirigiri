import { expect, it, vi } from "vite-plus/test";
import { createRenderScheduler } from "./renderScheduler.ts";

it("coalesces frame and pointer invalidations, then stops scheduling when idle or disposed", () => {
  const callbacks: FrameRequestCallback[] = [];
  const request = vi.fn((callback: FrameRequestCallback) => {
    callbacks.push(callback);
    return callbacks.length;
  });
  const cancel = vi.fn();
  const render = vi.fn();
  const scheduler = createRenderScheduler(render, request, cancel);
  scheduler.invalidate();
  scheduler.invalidate();
  expect(request).toHaveBeenCalledTimes(1);
  callbacks[0]?.(0);
  expect(render).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  scheduler.invalidate();
  scheduler.dispose();
  scheduler.dispose();
  scheduler.invalidate();
  callbacks[1]?.(0);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(2);
  expect(render).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(2);
});

it("cancels queued work while hidden and draws once with the latest state on return", () => {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  const request = vi.fn((callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  const render = vi.fn();
  const scheduler = createRenderScheduler(render, request, (id) => pending.delete(id));
  scheduler.invalidate();
  scheduler.setActive(false);
  scheduler.invalidate();
  scheduler.invalidate();
  expect(pending.size).toBe(0);
  expect(render).not.toHaveBeenCalled();
  scheduler.setActive(true);
  scheduler.setActive(true);
  scheduler.invalidate();
  expect(pending.size).toBe(1);
  const callback = [...pending.values()][0]!;
  pending.clear();
  callback(0);
  expect(render).toHaveBeenCalledOnce();
  expect(pending.size).toBe(0);
  scheduler.dispose();
  scheduler.setActive(false);
  scheduler.setActive(true);
  expect(pending.size).toBe(0);
});
