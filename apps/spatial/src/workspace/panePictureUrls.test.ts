import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { createPanePictureUrls } from "./panePictureUrls";

const pending: { url: string; resolve: () => void; reject: () => void }[] = [];
const revoked: string[] = [];
let urls: ReturnType<typeof createPanePictureUrls>;

beforeEach(() => {
  vi.useFakeTimers();
  let sequence = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${++sequence}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        return new Promise<void>((resolve, reject) =>
          pending.push({ url: this.src, resolve, reject }),
        );
      }
    },
  );
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 1));
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
  urls = createPanePictureUrls();
});

afterEach(() => {
  urls.dispose();
  pending.length = 0;
  revoked.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("warms pictures serially and only offers a URL after decoding succeeds", async () => {
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  urls.retain(new Set([first, second]));
  await vi.advanceTimersByTimeAsync(1);
  expect(pending).toHaveLength(1);
  expect(urls.preparedUrl(first)).toBeNull();
  pending[0]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(first)).toBe("blob:1");
  expect(pending).toHaveLength(2);
  expect(urls.preparedUrl(second)).toBeNull();
  pending[1]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(second)).toBe("blob:2");
  urls.retain(new Set([first, second]));
  await vi.advanceTimersByTimeAsync(10);
  expect(pending).toHaveLength(2);
});

it("forgets a removed picture even if its decode completes late", async () => {
  const first = new Blob(["first"]);
  const replacement = new Blob(["replacement"]);
  urls.retain(new Set([first]));
  await vi.advanceTimersByTimeAsync(1);
  urls.retain(new Set([replacement]));
  expect(revoked).toEqual(["blob:1"]);
  pending[0]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(first)).toBeNull();
  pending[1]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(replacement)).toBe("blob:2");
});

it("leaves a failed decode to the normal picture path and continues warming other pictures", async () => {
  const failed = new Blob(["failed"]);
  const next = new Blob(["next"]);
  urls.retain(new Set([failed, next]));
  await vi.advanceTimersByTimeAsync(1);
  pending[0]!.reject();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(failed)).toBeNull();
  expect(revoked).toEqual(["blob:1"]);
  pending[1]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(next)).toBe("blob:2");
});

it("releases its URLs on cleanup and can restart after an effect reconnects", async () => {
  const image = new Blob(["image"]);
  urls.retain(new Set([image]));
  await vi.advanceTimersByTimeAsync(1);
  urls.dispose();
  expect(revoked).toEqual(["blob:1"]);
  urls.retain(new Set([image]));
  pending[0]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(image)).toBeNull();
  pending[1]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(image)).toBe("blob:2");
  urls.dispose();
  expect(revoked).toEqual(["blob:1", "blob:2"]);
});

it("shares one URL with an arriving view while retaining new queued pictures", async () => {
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  const url = urls.urlFor(first);
  urls.retain(new Set([first]));
  await vi.advanceTimersByTimeAsync(1);
  urls.retain(new Set([first, second]));
  expect(urls.urlFor(first)).toBe(url);
  expect(pending).toHaveLength(1);
  pending[0]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(first)).toBe(url);
  expect(pending).toHaveLength(2);
  expect(pending[1]!.url).toBe("blob:2");
});

it("lets an arriving view retry a failed warm with a new URL", async () => {
  const image = new Blob(["image"]);
  urls.retain(new Set([image]));
  await vi.advanceTimersByTimeAsync(1);
  pending[0]!.reject();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(image)).toBeNull();
  expect(urls.urlFor(image)).toBe("blob:2");
  await vi.advanceTimersByTimeAsync(1);
  pending[1]!.resolve();
  await vi.advanceTimersByTimeAsync(1);
  expect(urls.preparedUrl(image)).toBe("blob:2");
});
