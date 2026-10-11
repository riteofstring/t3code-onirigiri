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
    scale: vi.fn(),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function beginPicture() {
  const element = document.createElement("div");
  element.textContent = "Retained snapshot content";
  Object.defineProperties(element, {
    offsetWidth: { value: 400 },
    offsetHeight: { value: 600 },
  });
  document.body.append(element);
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
