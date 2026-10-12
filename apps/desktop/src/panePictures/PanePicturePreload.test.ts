import { afterEach, expect, it, vi } from "vite-plus/test";

import * as Protocol from "./PanePictureProtocol.ts";

const ipc = vi.hoisted(() => ({ once: vi.fn(), invoke: vi.fn() }));
vi.mock("electron", () => ({ ipcRenderer: ipc }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.resetModules();
});

it.each(["svg", "empty-png", "to-blob-error"])(
  "recovers from %s content failure and rasterizes the next picture on the same port",
  async (failure) => {
    let failing = true;
    class Image extends EventTarget {
      set src(_value: string) {
        queueMicrotask(() =>
          this.dispatchEvent(new Event(failing && failure === "svg" ? "error" : "load")),
        );
      }
      removeAttribute() {}
    }
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ scale: vi.fn(), drawImage }),
      toBlob: (resolve: (blob: Blob | null) => void) => {
        if (failing && failure === "to-blob-error") throw new Error("Tainted canvas");
        resolve(failing ? null : new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }));
      },
    };
    const close = vi.fn();
    vi.stubGlobal("Image", Image);
    vi.stubGlobal("document", { createElement: () => canvas });
    vi.stubGlobal("window", { close });
    vi.stubGlobal("devicePixelRatio", 1);
    const listeners = new Map<string, (event: MessageEvent) => Promise<void>>();
    const port = {
      addEventListener: (name: string, listener: (event: MessageEvent) => Promise<void>) =>
        listeners.set(name, listener),
      start: vi.fn(),
      postMessage: vi.fn(),
    };
    await import("../pane-picture-preload.ts");
    const register = ipc.once.mock.calls.find(([channel]) => channel === Protocol.PORT)![1];
    register({ ports: [port] }, "document");
    const input = {
      open: '<svg xmlns="http://www.w3.org/2000/svg">',
      styles: "",
      content: "</svg>",
      width: 20,
      height: 30,
      scale: 1,
    };
    await listeners.get("message")!(new MessageEvent("message", { data: { id: 1, input } }));
    expect(port.postMessage).toHaveBeenLastCalledWith({ id: 1, buffer: null });
    expect(close).not.toHaveBeenCalled();
    failing = false;
    await listeners.get("message")!(new MessageEvent("message", { data: { id: 2, input } }));
    const response = port.postMessage.mock.lastCall!;
    expect(response[0]).toMatchObject({ id: 2, buffer: expect.any(ArrayBuffer) });
    expect(response[1]).toEqual([response[0].buffer]);
    expect(drawImage).toHaveBeenCalled();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(close).not.toHaveBeenCalled();
    expect(ipc.invoke).not.toHaveBeenCalled();
  },
);
