// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SavedPanePicture } from "./SavedPanePicture";

const pending: { resolve: () => void; reject: () => void }[] = [];
const originalDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "decode");
const revoked: string[] = [];
const ownedUrls = new Map<Blob, string>();
const pictureUrl = vi.fn((image: Blob) => {
  let url = ownedUrls.get(image);
  if (!url) ownedUrls.set(image, (url = URL.createObjectURL(image)));
  return url;
});
const captureSize = { width: 520, height: 923 };
let container: HTMLDivElement;
let root: Root | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let sequence = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${++sequence}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  Object.defineProperty(HTMLImageElement.prototype, "decode", {
    configurable: true,
    value: () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(() => root!.unmount());
  root = undefined;
  container.remove();
  if (originalDecode) Object.defineProperty(HTMLImageElement.prototype, "decode", originalDecode);
  else delete (HTMLImageElement.prototype as Partial<HTMLImageElement>).decode;
  pending.length = 0;
  ownedUrls.clear();
  revoked.length = 0;
  pictureUrl.mockClear();
  vi.unstubAllGlobals();
});

async function replace(
  preparedUrl: string | null = null,
  cssSize = captureSize,
  image = new Blob(["png"]),
  paneSize = { width: 800, height: 1000 },
) {
  await act(() => {
    root!.render(
      <div style={{ ...paneSize, overflow: "hidden", position: "relative" }}>
        <SavedPanePicture
          image={image}
          cssSize={cssSize}
          preparedUrl={preparedUrl}
          pictureUrl={pictureUrl}
          summary="Thread"
        />
      </div>,
    );
  });
}

const shown = () => {
  const image = container.querySelector("img")!;
  return {
    source: image.getAttribute("src"),
    width: image.style.width,
    height: image.style.height,
  };
};

it("keeps captured dimensions when the surrounding pane shrinks or grows", async () => {
  const image = new Blob(["png"]);
  await replace("blob:prepared", captureSize, image);
  const expected = { source: "blob:prepared", width: "520px", height: "923px" };
  expect(shown()).toEqual(expected);
  await replace("blob:prepared", captureSize, image, { width: 320, height: 400 });
  expect(shown()).toEqual(expected);
  await replace("blob:prepared", captureSize, image, { width: 1400, height: 1200 });
  expect(shown()).toEqual(expected);
  expect(container.querySelector("img")!.style.maxWidth).toBe("none");
  expect(container.querySelector("img")!.style.maxHeight).toBe("none");
  expect(pending).toHaveLength(0);
  expect(pictureUrl).not.toHaveBeenCalled();
});

it("shows the summary, not an empty image frame, until the first picture decodes", async () => {
  await replace();
  expect(shown().source).toBeNull();
  expect(container.querySelector("img")!.style.visibility).toBe("hidden");
  expect(container.querySelector(".sr-only")).toBeNull();
  expect(container.textContent).toBe("Thread");
  await act(() => pending[0]!.resolve());
  expect(shown().source).toBe("blob:1");
  expect(container.querySelector("img")!.style.visibility).toBe("");
  expect(container.querySelector(".sr-only")?.textContent).toBe("Thread");
});

it("keeps the decoded picture while a replacement loads, and through a failed same-size refresh", async () => {
  await replace();
  await act(() => pending[0]!.resolve());
  const previous = { source: "blob:1", width: "520px", height: "923px" };
  expect(shown()).toEqual(previous);
  await replace(null, captureSize, new Blob(["refresh"]));
  expect(shown()).toEqual(previous);
  await act(() => pending[1]!.reject());
  expect(shown()).toEqual(previous);
  await replace(null, { width: 480, height: 640 });
  expect(shown()).toEqual(previous);
  await act(() => pending[2]!.resolve());
  expect(shown()).toEqual({ source: "blob:3", width: "480px", height: "640px" });
  expect(revoked).toEqual([]);
});

it("ignores an older decode and its dimensions after the current picture", async () => {
  await replace(null, { width: 400, height: 500 });
  await replace(null, { width: 720, height: 961 });
  await act(() => pending[1]!.resolve());
  await act(() => pending[0]!.resolve());
  expect(shown()).toEqual({ source: "blob:2", width: "720px", height: "961px" });
});

it("keeps both the visible cover and size while a prepared replacement decodes again", async () => {
  await replace("blob:previous");
  await replace("blob:prepared", { width: 720, height: 961 });
  const previous = { source: "blob:previous", width: "520px", height: "923px" };
  expect(shown()).toEqual(previous);
  await replace("blob:replacement", { width: 480, height: 640 });
  expect(shown()).toEqual(previous);
  await act(() => pending[1]!.resolve());
  expect(shown()).toEqual({ source: "blob:replacement", width: "480px", height: "640px" });
});

it("shows the summary instead of an old size when a resized replacement fails", async () => {
  await replace("blob:previous");
  await replace("blob:resized", { width: 720, height: 961 });
  expect(shown().source).toBe("blob:previous");
  await act(() => pending[0]!.reject());
  expect(shown().source).toBeNull();
  expect(container.textContent).toBe("Thread");
});

it("ignores a successful decode after unmount and leaves URL release to its owner", async () => {
  await replace();
  const image = container.querySelector("img")!;
  await act(() => root!.unmount());
  root = undefined;
  await act(() => pending[0]!.resolve());
  expect(image.getAttribute("src")).toBeNull();
  expect(revoked).toEqual([]);
});

it("fades a late picture in over the card once, and keeps the card until the fade ends", async () => {
  const onFadeIn = vi.fn();
  await act(() => {
    root!.render(
      <SavedPanePicture
        image={new Blob(["png"])}
        cssSize={captureSize}
        preparedUrl={null}
        pictureUrl={pictureUrl}
        summary="Thread"
        fadeIn
        onFadeIn={onFadeIn}
      />,
    );
  });
  const image = container.querySelector("img")!;
  expect(image.classList.contains("spatial-pane-picture-in")).toBe(false);
  expect(onFadeIn).not.toHaveBeenCalled();
  await act(() => pending[0]!.resolve());
  expect(image.classList.contains("spatial-pane-picture-in")).toBe(true);
  expect(container.querySelector(".sr-only")).toBeNull();
  expect(onFadeIn).toHaveBeenCalled();
  await act(() => image.dispatchEvent(new Event("animationend", { bubbles: true })));
  expect(image.classList.contains("spatial-pane-picture-in")).toBe(false);
  expect(container.querySelector(".sr-only")?.textContent).toBe("Thread");
});
