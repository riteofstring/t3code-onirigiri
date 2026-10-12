import * as NodeEvents from "node:events";
import type { DesktopPanePictureRasterInput } from "@t3tools/contracts";
import type { IpcRenderer } from "electron";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createPanePictureRasterClient } from "./PanePictureRasterClient.ts";
import * as Protocol from "./PanePictureProtocol.ts";

const input: DesktopPanePictureRasterInput = {
  open: '<svg xmlns="http://www.w3.org/2000/svg">',
  styles: "",
  content: "</svg>",
  width: 20,
  height: 30,
  scale: 1,
};
function png(width = 20, height = 30) {
  const bytes = new Uint8Array(45);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  view.setUint32(37, 0x49454e44);
  return bytes.buffer;
}
class Port extends EventTarget {
  start = vi.fn();
  postMessage = vi.fn();
  close = vi.fn();
  result(id: number, buffer: ArrayBuffer | null) {
    this.dispatchEvent(new MessageEvent("message", { data: { id, buffer } }));
  }
}
function fixture() {
  const port = new Port();
  const ipc = Object.assign(new NodeEvents.EventEmitter(), {
    invoke: vi.fn(async (channel: string): Promise<unknown> => {
      if (channel === Protocol.CONNECT) {
        ipc.emit(Protocol.PORT, { ports: [port] }, "a");
        return true;
      }
      return undefined;
    }),
  });
  const rasterize = createPanePictureRasterClient(ipc as unknown as IpcRenderer, "a");
  return { port, ipc, rasterize };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("connects from a document without secure-context randomUUID", async () => {
  const port = new Port();
  const ipc = Object.assign(new NodeEvents.EventEmitter(), {
    invoke: vi.fn<(channel: string) => Promise<unknown>>(),
  });
  vi.stubGlobal("crypto", {
    getRandomValues: (words: Uint32Array) => {
      words.set([1, 2, 3, 4]);
      return words;
    },
  });
  const rasterize = createPanePictureRasterClient(ipc as unknown as IpcRenderer);
  ipc.invoke = vi.fn(async (channel: string) => {
    if (channel === Protocol.CONNECT) {
      ipc.emit(Protocol.PORT, { ports: [port] }, "1-2-3-4");
      return true;
    }
    return undefined;
  });
  const result = rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  port.result(1, png());
  expect(await result).not.toBeNull();
  expect(ipc.invoke).toHaveBeenCalledWith(Protocol.CONNECT, "1-2-3-4");
});

it("lazily returns matching PNG pixels without copying their transferred buffer", async () => {
  const f = fixture();
  expect(f.ipc.invoke).not.toHaveBeenCalled();
  const result = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  const buffer = png();
  f.port.result(1, buffer);
  expect((await result)!.buffer).toBe(buffer);
  expect(f.port.postMessage).toHaveBeenCalledWith({ id: 1, input }, []);
  expect(f.ipc.invoke).not.toHaveBeenCalledWith(Protocol.STOP, "a");
});

it.each([
  { ...input, scale: 0 },
  { ...input, width: Infinity },
  { ...input, width: 10000, height: 10000 },
  { ...input, content: "é".repeat(Protocol.MAX_INPUT_BYTES / 2) },
])("falls back on unsupported input without opening a helper", async (unsupported) => {
  const f = fixture();
  expect(await f.rasterize(unsupported)).toBeNull();
  expect(f.ipc.invoke).not.toHaveBeenCalled();
});

it.each(["timeout", "port-close", "message-error", "post-failure", "bad-png", "wrong-size"])(
  "closes the port and settles without a stop acknowledgement after %s, then latches off",
  async (failure) => {
    const f = fixture();
    const original = f.ipc.invoke.getMockImplementation()!;
    f.ipc.invoke.mockImplementation((channel) =>
      channel === Protocol.STOP ? new Promise(() => {}) : original(channel),
    );
    if (failure === "post-failure")
      f.port.postMessage.mockImplementation(() => {
        throw new Error("closed");
      });
    let settled = false;
    const result = f.rasterize(input).then((value) => {
      settled = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);
    if (failure === "timeout") await vi.advanceTimersByTimeAsync(Protocol.JOB_TIMEOUT_MS);
    if (failure === "port-close") f.port.dispatchEvent(new Event("close"));
    if (failure === "message-error") f.port.dispatchEvent(new Event("messageerror"));
    if (failure === "bad-png") f.port.result(1, new ArrayBuffer(45));
    if (failure === "wrong-size") f.port.result(1, png(21));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(f.ipc.invoke).toHaveBeenCalledWith(Protocol.STOP, "a");
    expect(await result).toBeNull();
    expect(await f.rasterize(input)).toBeNull();
    expect(
      f.ipc.invoke.mock.calls.filter(([channel]) => channel === Protocol.CONNECT),
    ).toHaveLength(1);
    expect(f.port.close).toHaveBeenCalledOnce();
  },
);

it("ignores stale document notifications, wrong request results and late ports", async () => {
  const f = fixture();
  const result = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  f.ipc.emit(Protocol.UNAVAILABLE, {}, "old");
  f.port.result(999, png());
  expect(f.ipc.invoke).not.toHaveBeenCalledWith(Protocol.STOP, "a");
  f.port.result(1, png());
  expect(await result).not.toBeNull();
  const late = new Port();
  f.ipc.emit(Protocol.PORT, { ports: [late] }, "old");
  expect(late.close).toHaveBeenCalledOnce();
});

it("bounds connection setup and closes a late delivered port", async () => {
  const f = fixture();
  f.ipc.invoke.mockImplementation((channel) =>
    channel === Protocol.CONNECT ? new Promise(() => {}) : Promise.resolve(undefined),
  );
  const result = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(Protocol.CONNECT_TIMEOUT_MS);
  expect(await result).toBeNull();
  f.ipc.emit(Protocol.PORT, { ports: [f.port] }, "a");
  expect(f.port.close).toHaveBeenCalledOnce();
});

it("settles once when port closure reenters stop and its IPC handler has gone away", async () => {
  const f = fixture();
  const original = f.ipc.invoke.getMockImplementation()!;
  f.ipc.invoke.mockImplementation((channel) =>
    channel === Protocol.STOP
      ? Promise.reject(new Error("handler unavailable"))
      : original(channel),
  );
  f.port.close.mockImplementation(() => f.port.dispatchEvent(new Event("close")));
  const result = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  f.port.dispatchEvent(new Event("messageerror"));
  expect(await result).toBeNull();
  expect(f.port.close).toHaveBeenCalledOnce();
  expect(f.ipc.invoke.mock.calls.filter(([channel]) => channel === Protocol.STOP)).toHaveLength(1);
  expect(await f.rasterize(input)).toBeNull();
});

it("closes the outstanding helper port on overflow without dispatching another job", async () => {
  const f = fixture();
  const first = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  expect(await f.rasterize(input)).toBeNull();
  expect(await first).toBeNull();
  expect(f.port.postMessage).toHaveBeenCalledOnce();
  expect(f.port.close).toHaveBeenCalledOnce();
});

it("keeps a healthy helper after content-specific failure and accepts its next picture", async () => {
  const f = fixture();
  const failed = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  f.port.result(1, null);
  expect(await failed).toBeNull();
  const next = f.rasterize(input);
  await vi.advanceTimersByTimeAsync(0);
  f.port.result(2, png());
  expect(await next).not.toBeNull();
  expect(f.port.postMessage).toHaveBeenCalledTimes(2);
  expect(f.port.close).not.toHaveBeenCalled();
  expect(f.ipc.invoke).toHaveBeenCalledTimes(1);
});
