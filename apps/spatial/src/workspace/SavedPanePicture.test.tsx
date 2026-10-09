import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SavedPanePicture } from "./SavedPanePicture";

const pending: { resolve: () => void; reject: () => void }[] = [];
const writes: string[] = [];
let source = "";
const image = {
  get src() {
    return source;
  },
  set src(next: string) {
    source = next;
    writes.push(next);
  },
  ownerDocument: {
    createElement: () => ({
      src: "",
      decode: () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
    }),
  },
};
let renderer: ReactTestRenderer | undefined;
const revoked: string[] = [];
const ownedUrls = new Map<Blob, string>();
const pictureUrl = (image: Blob) => {
  let url = ownedUrls.get(image);
  if (!url) ownedUrls.set(image, (url = URL.createObjectURL(image)));
  return url;
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let sequence = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:${++sequence}`,
    revokeObjectURL: (url: string) => revoked.push(url),
  });
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  source = "";
  writes.length = 0;
  pending.length = 0;
  ownedUrls.clear();
  revoked.length = 0;
  vi.unstubAllGlobals();
});

async function replace(preparedUrl: string | null = null) {
  const content = (
    <SavedPanePicture
      image={new Blob(["png"])}
      preparedUrl={preparedUrl}
      pictureUrl={pictureUrl}
      summary="Thread"
    />
  );
  await act(() => {
    if (renderer) renderer.update(content);
    else
      renderer = create(content, {
        createNodeMock: (node) => {
          image.src = (node.props as { src?: string }).src ?? "";
          return image;
        },
      });
  });
}

it("keeps the decoded picture while a replacement loads or fails", async () => {
  await replace();
  await act(() => pending[0]!.resolve());
  expect(image.src).toBe("blob:1");
  await replace();
  expect(image.src).toBe("blob:1");
  await act(() => pending[1]!.reject());
  expect(image.src).toBe("blob:1");
  await replace();
  await act(() => pending[2]!.resolve());
  expect(image.src).toBe("blob:3");
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(revoked).toEqual([]);
});

it("ignores an older decode that finishes after the current picture", async () => {
  await replace();
  await replace();
  await act(() => pending[1]!.resolve());
  await act(() => pending[0]!.resolve());
  expect(image.src).toBe("blob:2");
});

it("uses a prepared picture without decoding or assigning its source again", async () => {
  await replace("blob:prepared");
  expect(image.src).toBe("blob:prepared");
  expect(pending).toHaveLength(0);
  expect(writes).toEqual(["blob:prepared"]);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(revoked).toEqual([]);
});

it("keeps a prepared cover while an unprepared replacement fails", async () => {
  await replace("blob:prepared");
  await replace();
  expect(image.src).toBe("blob:prepared");
  await act(() => pending[0]!.reject());
  expect(image.src).toBe("blob:prepared");
  expect(revoked).toEqual([]);
});

it("does not replace a prepared picture with an earlier pending decode", async () => {
  await replace();
  await replace("blob:prepared");
  await act(() => pending[1]!.resolve());
  expect(image.src).toBe("blob:prepared");
  await act(() => pending[0]!.resolve());
  expect(image.src).toBe("blob:prepared");
});

it("keeps the visible cover while a previously prepared replacement decodes again", async () => {
  await replace("blob:previous");
  await replace("blob:prepared");
  expect(image.src).toBe("blob:previous");
  await act(() => pending[0]!.reject());
  expect(image.src).toBe("blob:previous");
  await replace("blob:replacement");
  expect(image.src).toBe("blob:previous");
  await act(() => pending[1]!.resolve());
  expect(image.src).toBe("blob:replacement");
});

it("leaves URL release to its owner when unmounted during decoding", async () => {
  await replace();
  await act(() => renderer!.unmount());
  renderer = undefined;
  await act(() => pending[0]!.reject());
  expect(revoked).toEqual([]);
});
