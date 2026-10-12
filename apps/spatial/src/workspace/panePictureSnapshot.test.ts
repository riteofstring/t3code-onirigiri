// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { snapshotPanePicture } from "./panePictureSnapshot";
import { createSnapshotQueue } from "./useSavedPanePictures";

vi.mock("@t3tools/web/src/hooks/useTheme", () => ({ useTheme: vi.fn() }));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({ useClientSettings: vi.fn() }));
vi.mock("@t3tools/web/src/state/entities", () => ({ useThreadShells: vi.fn() }));
vi.mock("./useWorkspacePanes", () => ({ threadPaneId: vi.fn() }));

const images: HTMLImageElement[] = [];
const drawImage = vi.fn();
const scale = vi.fn();
const picture = new Blob(["saved pixels"]);
let idleBudget = 50;
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => idleBudget }), 1),
  );
  vi.stubGlobal("cancelIdleCallback", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal("Image", function () {
    const image = document.createElement("img");
    images.push(image);
    return image;
  });
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      cssRules = [];
      replaceSync() {}
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage,
    scale,
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) =>
    callback(picture),
  );
});

afterEach(async () => {
  dispose?.();
  await vi.advanceTimersByTimeAsync(0);
  dispose = undefined;
  document.body.replaceChildren();
  images.length = 0;
  idleBudget = 50;
  drawImage.mockClear();
  scale.mockClear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function createPane() {
  const element = document.createElement("div");
  element.textContent = "Retained snapshot content";
  Object.defineProperties(element, {
    offsetWidth: { value: 400 },
    offsetHeight: { value: 600 },
  });
  document.body.append(element);
  return element;
}

async function beginPicture() {
  const element = createPane();
  const clone = vi.spyOn(element, "cloneNode");
  const completed: (Blob | null)[] = [];
  const queue = createSnapshotQueue();
  const draw = vi.fn<Parameters<typeof queue.setDraw>[0]>(
    async (_id, source, canStart, waitToDraw) => {
      completed.push(
        await snapshotPanePicture(source, () => source.isConnected && canStart(), waitToDraw),
      );
    },
  );
  dispose = queue.setDraw(
    draw,
    () => false,
    () => false,
  );
  queue.request("first", element, false);
  await vi.advanceTimersByTimeAsync(450);
  expect(images).toHaveLength(1);
  expect(clone).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
  return { element, image: images[0]!, clone, completed, queue, draw };
}

it.each([false, true])(
  "retains the loaded SVG through motion and waits for idle before drawing; detached: %s",
  async (detached) => {
    const f = await beginPicture();
    window.dispatchEvent(new Event("keydown"));
    f.queue.setActivity(true, true);
    if (detached) f.element.remove();
    f.image.dispatchEvent(new Event("load"));
    f.queue.request("second", f.element, false);
    await vi.advanceTimersByTimeAsync(500);
    expect(drawImage).not.toHaveBeenCalled();
    expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
    expect(f.completed).toEqual([]);
    expect(f.image.getAttribute("src")).toContain("data:image/svg+xml");
    expect(f.draw).toHaveBeenCalledOnce();

    idleBudget = 0;
    f.queue.setActivity(true, false);
    await vi.advanceTimersByTimeAsync(50);
    expect(drawImage).not.toHaveBeenCalled();
    idleBudget = 50;
    await vi.advanceTimersByTimeAsync(1);
    expect(f.completed).toEqual([picture]);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
    expect(f.clone).toHaveBeenCalledOnce();
    expect(f.draw).toHaveBeenCalledOnce();
    expect(f.image.hasAttribute("src")).toBe(false);
  },
);

it("resumes a loaded SVG after the workspace is enabled and recent input becomes quiet", async () => {
  const f = await beginPicture();
  f.queue.setActivity(false, false);
  f.image.dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(drawImage).not.toHaveBeenCalled();

  window.dispatchEvent(new Event("pointerdown"));
  f.queue.setActivity(true, false);
  await vi.advanceTimersByTimeAsync(399);
  expect(drawImage).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(f.completed).toEqual([picture]);
  expect(f.clone).toHaveBeenCalledOnce();
});

it("waits for admission before rasterizing the serialized pane on desktop", async () => {
  const pixels = new Uint8Array([137, 80, 78, 71]);
  const rasterize = vi.fn().mockResolvedValue(pixels);
  vi.stubGlobal("desktopBridge", { rasterizePanePicture: rasterize });
  vi.stubGlobal("devicePixelRatio", 2);
  const element = createPane();
  const editor = document.createElement("div");
  editor.dataset.testid = "composer-editor";
  editor.textContent = "Unsent private draft";
  element.append(editor);
  let admit!: (value: boolean) => void;
  const admission = new Promise<boolean>((resolve) => {
    admit = resolve;
  });
  const result = snapshotPanePicture(
    element,
    () => element.isConnected,
    () => admission,
  );
  await vi.advanceTimersByTimeAsync(40);
  expect(rasterize).not.toHaveBeenCalled();
  expect(images).toEqual([]);

  element.remove();
  admit(true);
  const image = await result;
  expect(image?.type).toBe("image/png");
  expect(image?.size).toBe(pixels.byteLength);
  expect(rasterize).toHaveBeenCalledOnce();
  const input = rasterize.mock.calls[0]![0];
  const svg = new DOMParser().parseFromString(
    input.open + decodeURIComponent(input.styles) + input.content,
    "image/svg+xml",
  );
  expect(svg.querySelector("parsererror")).toBeNull();
  expect(svg.documentElement.getAttribute("width")).toBe("400");
  expect(svg.documentElement.getAttribute("height")).toBe("600");
  expect(svg.documentElement.textContent).toContain("Retained snapshot content");
  expect(svg.documentElement.textContent).not.toContain("Unsent private draft");
  expect(input).toMatchObject({ width: 400, height: 600, scale: 2 });
  expect(images).toEqual([]);
  expect(drawImage).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
});

it("does not dispatch or draw when desktop capture admission is revoked", async () => {
  const rasterize = vi.fn();
  vi.stubGlobal("desktopBridge", { rasterizePanePicture: rasterize });
  const result = snapshotPanePicture(
    createPane(),
    () => true,
    async () => false,
  );
  await vi.advanceTimersByTimeAsync(40);
  expect(await result).toBeNull();
  expect(rasterize).not.toHaveBeenCalled();
  expect(images).toEqual([]);
  expect(drawImage).not.toHaveBeenCalled();
});

it.each(["unavailable", "empty", "rejected", "thrown"])(
  "keeps the original foreground raster when desktop is %s",
  async (failure) => {
    const rasterize = vi.fn(() => {
      if (failure === "thrown") throw new Error("raster service unavailable");
      if (failure === "rejected") return Promise.reject(new Error("raster service stopped"));
      return Promise.resolve(failure === "empty" ? new Uint8Array() : null);
    });
    vi.stubGlobal("desktopBridge", { rasterizePanePicture: rasterize });
    const element = createPane();
    const clone = vi.spyOn(element, "cloneNode");
    const result = snapshotPanePicture(
      element,
      () => true,
      async () => true,
    );
    await vi.advanceTimersByTimeAsync(40);
    expect(images).toHaveLength(1);
    expect(drawImage).not.toHaveBeenCalled();
    vi.stubGlobal("devicePixelRatio", 2);
    images[0]!.dispatchEvent(new Event("load"));
    expect(await result).toBe(picture);
    expect(rasterize).toHaveBeenCalledOnce();
    expect(clone).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(images[0], 0, 0, 400, 600);
    expect(scale).toHaveBeenCalledWith(2, 2);
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledOnce();
    expect(images[0]!.hasAttribute("src")).toBe(false);
  },
);

it("checks admission again before drawing a failed desktop raster locally", async () => {
  const rasterize = vi.fn().mockResolvedValue(null);
  vi.stubGlobal("desktopBridge", { rasterizePanePicture: rasterize });
  let admitted = true;
  const result = snapshotPanePicture(
    createPane(),
    () => true,
    async () => admitted,
  );
  await vi.advanceTimersByTimeAsync(40);
  expect(images).toHaveLength(1);
  admitted = false;
  images[0]!.dispatchEvent(new Event("load"));
  expect(await result).toBeNull();
  expect(rasterize).toHaveBeenCalledOnce();
  expect(drawImage).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(images[0]!.hasAttribute("src")).toBe(false);
});

it("settles and releases a loaded SVG when the queue is disposed while awaiting admission", async () => {
  const f = await beginPicture();
  f.queue.setActivity(true, true);
  f.image.dispatchEvent(new Event("load"));
  await vi.advanceTimersByTimeAsync(1);
  expect(f.completed).toEqual([]);
  expect(f.image.hasAttribute("src")).toBe(true);

  dispose!();
  dispose = undefined;
  await vi.advanceTimersByTimeAsync(0);
  expect(f.completed).toEqual([null]);
  expect(f.image.hasAttribute("src")).toBe(false);
  expect(drawImage).not.toHaveBeenCalled();
  expect(HTMLCanvasElement.prototype.toBlob).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
