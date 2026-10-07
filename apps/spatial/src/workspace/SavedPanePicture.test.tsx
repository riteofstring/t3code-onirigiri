import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SavedPanePicture } from "./SavedPanePicture";

const pending: { resolve: () => void; reject: () => void }[] = [];
const image = {
  src: "",
  ownerDocument: {
    createElement: () => ({
      src: "",
      decode: () => new Promise<void>((resolve, reject) => pending.push({ resolve, reject })),
    }),
  },
};
let renderer: ReactTestRenderer | undefined;
const revoked: string[] = [];

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
  image.src = "";
  pending.length = 0;
  revoked.length = 0;
  vi.unstubAllGlobals();
});

async function replace() {
  const content = <SavedPanePicture image={new Blob(["png"])} summary="Thread" />;
  await act(() => {
    if (renderer) renderer.update(content);
    else renderer = create(content, { createNodeMock: () => image });
  });
}

it("keeps the decoded picture while a replacement loads or fails", async () => {
  await replace();
  await act(() => pending[0]!.resolve());
  expect(image.src).toBe("blob:1");
  await replace();
  expect(image.src).toBe("blob:1");
  expect(revoked).not.toContain("blob:1");
  await act(() => pending[1]!.reject());
  expect(image.src).toBe("blob:1");
  await replace();
  await act(() => pending[2]!.resolve());
  expect(image.src).toBe("blob:3");
  expect(revoked).toContain("blob:1");
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(revoked).toContain("blob:3");
});

it("ignores an older decode that finishes after the current picture", async () => {
  await replace();
  await replace();
  await act(() => pending[1]!.resolve());
  await act(() => pending[0]!.resolve());
  expect(image.src).toBe("blob:2");
  expect(revoked).toContain("blob:1");
  expect(revoked).not.toContain("blob:2");
});
