// @effect-diagnostics globalTimers:off -- Sandboxed preload deadlines run at Electron message callbacks, outside Effect fibers.

import type { DesktopPanePictureRasterInput } from "@t3tools/contracts";
import type { IpcRenderer, IpcRendererEvent } from "electron";

import * as Protocol from "./PanePictureProtocol.ts";

export function createPanePictureRasterClient(
  ipc: Pick<IpcRenderer, "invoke" | "on" | "removeListener">,
  documentId?: string,
) {
  let port: MessagePort | null = null;
  let disabled = false;
  let busy = false;
  let nextId = 0;
  let connection: Promise<boolean> | undefined;
  let receivePort: (() => void) | undefined;
  let pending: {
    id: number;
    input: DesktopPanePictureRasterInput;
    timer: ReturnType<typeof setTimeout>;
    resolve: (value: Uint8Array<ArrayBuffer> | null) => void;
  } | null = null;

  const stop = () => {
    if (disabled) return;
    disabled = true;
    const closedPort = port;
    port = null;
    closedPort?.close();
    const current = pending;
    pending = null;
    if (current) clearTimeout(current.timer);
    current?.resolve(null);
    receivePort?.();
    void Promise.resolve()
      .then(() => ipc.invoke(Protocol.STOP, documentId))
      .catch(() => {});
  };
  const onUnavailable = (_event: IpcRendererEvent, id: unknown) => {
    if (id === documentId) void stop();
  };
  const onPort = (event: IpcRendererEvent, id: unknown) => {
    const received = event.ports[0];
    if (!received) return;
    if (id !== documentId || disabled || port) {
      received.close();
      return;
    }
    port = received;
    port.addEventListener("close", () => void stop());
    port.addEventListener("messageerror", () => void stop());
    port.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
      if (typeof data !== "object" || data === null || !("id" in data)) {
        void stop();
        return;
      }
      const current = pending;
      if (!current || data.id !== current.id) return;
      if (
        !("buffer" in data) ||
        (data.buffer !== null &&
          (!(data.buffer instanceof ArrayBuffer) ||
            !Protocol.isPicturePng(data.buffer, current.input)))
      ) {
        void stop();
        return;
      }
      pending = null;
      clearTimeout(current.timer);
      current.resolve(data.buffer === null ? null : new Uint8Array(data.buffer));
    });
    port.start();
    receivePort?.();
  };
  ipc.on(Protocol.PORT, onPort);
  ipc.on(Protocol.UNAVAILABLE, onUnavailable);

  const connect = () => {
    documentId ??= crypto.getRandomValues(new Uint32Array(4)).join("-");
    connection ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ready = new Promise<void>((resolve) => {
        receivePort = resolve;
      });
      try {
        const connected = await Promise.race([
          ipc.invoke(Protocol.CONNECT, documentId).then(async (enabled: unknown) => {
            if (enabled !== true) return false;
            await ready;
            return !disabled;
          }),
          new Promise<boolean>((resolve) => {
            timer = setTimeout(() => resolve(false), Protocol.CONNECT_TIMEOUT_MS);
          }),
        ]);
        if (!connected) stop();
        return connected && !disabled;
      } catch {
        stop();
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
    return connection;
  };

  return async (input: DesktopPanePictureRasterInput): Promise<Uint8Array<ArrayBuffer> | null> => {
    if (busy) {
      stop();
      return null;
    }
    if (!Protocol.isRasterInput(input)) return null;
    if (disabled) return null;
    busy = true;
    try {
      if (!(await connect()) || !port) return null;
      const id = ++nextId;
      return await new Promise<Uint8Array<ArrayBuffer> | null>((resolve) => {
        pending = {
          id,
          input,
          resolve,
          timer: setTimeout(() => void stop(), Protocol.JOB_TIMEOUT_MS),
        };
        try {
          port!.postMessage({ id, input }, []);
        } catch {
          void stop();
        }
      });
    } finally {
      busy = false;
    }
  };
}
