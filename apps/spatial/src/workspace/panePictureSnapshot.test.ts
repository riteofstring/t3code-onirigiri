// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { captureOnirigiriPanePicture } from "@riteofstring/onirigiri";
import { snapshotPanePicture } from "./panePictureSnapshot";
import { createSnapshotQueue } from "./useSavedPanePictures";

vi.mock("@riteofstring/onirigiri", () => ({ captureOnirigiriPanePicture: vi.fn() }));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({ useTheme: vi.fn() }));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({ useClientSettings: vi.fn() }));
vi.mock("@t3tools/web/src/state/entities", () => ({ useThreadShells: vi.fn() }));
vi.mock("./useWorkspacePanes", () => ({ threadPaneId: vi.fn() }));
const native = vi.mocked(captureOnirigiriPanePicture);
const picture = { image: new Blob(["native pixels"]), cssSize: { width: 400, height: 600 } };
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
  );
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
  native.mockResolvedValue(picture);
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.replaceChildren();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function pane() {
  const element = document.createElement("div");
  element.innerHTML =
    '<div contenteditable="true">draft</div><div style="overflow:auto">scrolled content</div>';
  element.lastElementChild!.scrollTop = 150;
  document.body.append(element);
  return element;
}
it("passes the original edited and scrolled DOM to native capture without cloning", async () => {
  const element = pane();
  const clone = vi.spyOn(element, "cloneNode");
  const signal = new AbortController().signal;
  expect(
    await snapshotPanePicture(
      element,
      () => true,
      async () => true,
      signal,
    ),
  ).toEqual(picture);
  expect(native).toHaveBeenCalledWith(element, signal, expect.any(Function));
  expect(element.firstElementChild!.textContent).toBe("draft");
  expect(element.lastElementChild!.scrollTop).toBe(150);
  expect(clone).not.toHaveBeenCalled();
});
it("leaves unsupported capture without substitute pixels", async () => {
  native.mockResolvedValue(null);
  expect(
    await snapshotPanePicture(
      pane(),
      () => true,
      async () => true,
    ),
  ).toBeNull();
});
it.each(["revision", "abort", "detach"])(
  "returns a completed capture to the caller after %s unless the pane detached",
  async (change) => {
    const element = pane();
    let finish!: (value: typeof picture) => void;
    native.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let current = true;
    const controller = new AbortController();
    const result = snapshotPanePicture(
      element,
      () => current,
      async () => true,
      controller.signal,
    );
    while (native.mock.calls.length === 0) await Promise.resolve();
    if (change === "revision") current = false;
    if (change === "abort") controller.abort();
    if (change === "detach") element.remove();
    finish(picture);
    expect(await result).toBe(change === "detach" ? null : picture);
  },
);
it("does not start native work after cancelled phase admission or for live producers", async () => {
  const element = pane();
  expect(
    await snapshotPanePicture(
      element,
      () => true,
      async () => false,
    ),
  ).toBeNull();
  element.append(document.createElement("canvas"));
  expect(
    await snapshotPanePicture(
      element,
      () => true,
      async () => true,
    ),
  ).toBeNull();
  expect(native).not.toHaveBeenCalled();
});
it.each(["keydown", "wheel", "input", "compositionstart", "pointerdown", "motion", "disable"])(
  "cancels in-flight work on %s and keeps captures serial",
  async (input) => {
    const queue = createSnapshotQueue();
    const active: AbortSignal[] = [];
    const finishes: (() => void)[] = [];
    const draw = vi.fn<Parameters<typeof queue.setDraw>[0]>(
      async (_id, _element, _can, _wait, signal) => {
        active.push(signal);
        await new Promise<void>((resolve) => finishes.push(resolve));
      },
    );
    dispose = queue.setDraw(
      draw,
      () => false,
      () => false,
    );
    queue.request("first", pane());
    queue.request("second", pane());
    await vi.advanceTimersByTimeAsync(300);
    expect(active).toHaveLength(1);
    if (input === "motion") queue.setActivity(true, true);
    else if (input === "disable") queue.setActivity(false, false);
    else
      window.dispatchEvent(
        input === "keydown"
          ? new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true })
          : new Event(input),
      );
    expect(active[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(300);
    expect(active).toHaveLength(1);
    finishes[0]!();
    queue.setActivity(true, false);
    if (input === "pointerdown") window.dispatchEvent(new Event("pointerup"));
    await vi.advanceTimersByTimeAsync(300);
    expect(active).toHaveLength(2);
    finishes[1]!();
  },
);
it("saves a picture that finished encoding during motion once the camera stops", async () => {
  const queue = createSnapshotQueue();
  let finish!: () => void;
  const save = vi.fn();
  const draw = vi.fn<Parameters<typeof queue.setDraw>[0]>(async () => {
    await new Promise<void>((resolve) => (finish = resolve));
    return save;
  });
  dispose = queue.setDraw(
    draw,
    () => false,
    () => false,
  );
  queue.request("first", pane());
  await vi.advanceTimersByTimeAsync(300);
  expect(draw).toHaveBeenCalledOnce();
  queue.setActivity(true, true);
  finish();
  await vi.advanceTimersByTimeAsync(300);
  expect(save).not.toHaveBeenCalled();
  queue.setActivity(true, false);
  await vi.advanceTimersByTimeAsync(300);
  expect(save).toHaveBeenCalledOnce();
});
it("starts a missing visible picture within the half-second route interval", async () => {
  const queue = createSnapshotQueue();
  const draw = vi.fn(async () => {});
  dispose = queue.setDraw(
    draw,
    () => false,
    () => false,
  );
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
  queue.request("first", pane());
  await vi.advanceTimersByTimeAsync(300);
  expect(draw).toHaveBeenCalledOnce();
});

it("cancels scheduled phase admission without starting another capture early", async () => {
  const idle = new Map<number, IdleRequestCallback>();
  let serial = 0;
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) => {
    idle.set(++serial, callback);
    return serial;
  });
  vi.stubGlobal("cancelIdleCallback", (id: number) => idle.delete(id));
  const flush = () => {
    const callbacks = [...idle.values()];
    idle.clear();
    for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 50 });
  };
  const queue = createSnapshotQueue();
  let finish!: () => void;
  const admissions: boolean[] = [];
  const draw = vi.fn<Parameters<typeof queue.setDraw>[0]>(async (_id, _source, _can, wait) => {
    admissions.push(await wait());
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  dispose = queue.setDraw(
    draw,
    () => false,
    () => false,
  );
  queue.request("first", pane());
  queue.request("second", pane());
  await vi.advanceTimersByTimeAsync(300);
  flush();
  expect(draw).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event("input"));
  await Promise.resolve();
  expect(admissions).toEqual([false]);
  expect(idle.size).toBe(0);
  await vi.advanceTimersByTimeAsync(300);
  flush();
  expect(draw).toHaveBeenCalledOnce();
  finish();
  await vi.advanceTimersByTimeAsync(0);
  flush();
  expect(draw).toHaveBeenCalledTimes(2);
  dispose();
});
