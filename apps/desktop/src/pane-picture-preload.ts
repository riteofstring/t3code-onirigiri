import { ipcRenderer } from "electron";

import * as Protocol from "./panePictures/PanePictureProtocol.ts";

ipcRenderer.once(Protocol.PORT, (event, documentId: string) => {
  const port = event.ports[0];
  if (!port) return;
  let busy = false;
  let closed = false;
  const close = () => {
    closed = true;
    window.close();
  };
  port.addEventListener("close", close);
  port.addEventListener("messageerror", close);
  port.addEventListener(
    "message",
    async ({ data }: MessageEvent<{ id: number; input: unknown }>) => {
      const { id, input } = data;
      let image: HTMLImageElement | undefined;
      let canvas: HTMLCanvasElement | undefined;
      if (busy || !Protocol.isRasterInput(input)) {
        port.postMessage({ id, error: true });
        return;
      }
      busy = true;
      try {
        if (devicePixelRatio !== input.scale) {
          const configured = await ipcRenderer.invoke(Protocol.SCALE, {
            documentId,
            scale: input.scale,
          });
          if (!configured) throw new Error("Pane picture scale unavailable");
          await new Promise(requestAnimationFrame);
        }
        if (devicePixelRatio !== input.scale) throw new Error("Pane picture scale differs");
        image = new Image();
        const loaded = new Promise<boolean>((resolve) => {
          image!.addEventListener("load", () => resolve(true), { once: true });
          image!.addEventListener("error", () => resolve(false), { once: true });
        });
        image.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(input.open) +
          input.styles +
          encodeURIComponent(input.content);
        if (!(await loaded)) {
          if (!closed) port.postMessage({ id, buffer: null });
          return;
        }
        canvas = document.createElement("canvas");
        canvas.width = Math.round(input.width * input.scale);
        canvas.height = Math.round(input.height * input.scale);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Pane picture canvas unavailable");
        context.scale(input.scale, input.scale);
        context.drawImage(image, 0, 0, input.width, input.height);
        const blob = await new Promise<Blob | null>((resolve) => {
          try {
            canvas!.toBlob(resolve, "image/png");
          } catch {
            resolve(null);
          }
        });
        if (!blob || blob.size > Protocol.MAX_PNG_BYTES) {
          if (!closed) port.postMessage({ id, buffer: null });
          return;
        }
        const buffer = await blob.arrayBuffer();
        if (!closed) port.postMessage({ id, buffer }, [buffer]);
      } catch {
        if (!closed) {
          try {
            port.postMessage({ id, error: true });
          } catch {
            close();
          }
        }
      } finally {
        if (canvas) canvas.width = canvas.height = 0;
        image?.removeAttribute("src");
        busy = false;
      }
    },
  );
  port.start();
});
