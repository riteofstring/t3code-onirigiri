import type {
  OnirigiriCaptureStatus,
  OnirigiriLayout,
  WorkspacePane,
} from "@riteofstring/onirigiri";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { SavedPanePicture } from "./panePictureStore";
import { markPaneSynced, useSavedPanePictures } from "./useSavedPanePictures";

const store = {
  saved: new Map<string, SavedPanePicture>(),
  writes: [] as SavedPanePicture[],
  updatedAt: "u1",
};
const snapshot = vi.hoisted(() => vi.fn(async () => new Blob(["snapshot"])));
const nativeCapture = vi.hoisted(() => ({ available: false }));
vi.mock("./panePictureSnapshot", () => ({
  snapshotPanePicture: snapshot,
  canCapturePanes: () => nativeCapture.available,
}));
vi.mock("./panePictureStore", () => ({
  MAX_SAVED: 200,
  loadPanePictures: async () => store.saved,
  savePanePicture: async (picture: SavedPanePicture) => {
    store.writes.push(picture);
  },
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShells: () => [{ environmentId: "e", id: "t1", updatedAt: store.updatedAt }],
}));
vi.mock("./useWorkspacePanes", () => ({
  threadPaneId: (environmentId: string, threadId: string) => `thread:${environmentId}:${threadId}`,
}));

const paneId = "thread:e:t1";
const pane = { paneId } as WorkspacePane;
const layout = (width: number) =>
  ({
    columns: [{ cells: [{ paneId }], widthSpec: { unit: "px", value: width } }],
  }) as unknown as OnirigiriLayout;
const geometry = (width: number) => `800x600@1|{"unit":"px","value":${width}}`;

let resize: (width: number, height: number) => void = () => {};
let hook: ReturnType<typeof useSavedPanePictures>;
let renderer: ReactTestRenderer | undefined;
let currentLayout = layout(400);
let captureStatus = { state: "unavailable" } as OnirigiriCaptureStatus;
const getLayout = () => currentLayout;
const getCaptureStatus = () => captureStatus;

function Probe() {
  const value = useSavedPanePictures(getLayout, getCaptureStatus);
  useEffect(() => {
    hook = value;
  });
  return null;
}

async function mount() {
  await act(async () => {
    renderer = create(<Probe />);
  });
  hook.stageRef({} as HTMLElement);
  resize(800, 600);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} });
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 1));
  vi.stubGlobal("cancelIdleCallback", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(
        callback: (entries: { contentRect: { width: number; height: number } }[]) => void,
      ) {
        resize = (width, height) => callback([{ contentRect: { width, height } }]);
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  store.saved.clear();
  store.writes.length = 0;
  store.updatedAt = "u1";
  currentLayout = layout(400);
  markPaneSynced(paneId, false);
  snapshot.mockClear();
  nativeCapture.available = false;
  captureStatus = { state: "unavailable" } as OnirigiriCaptureStatus;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("seeds a pane only with a picture of the same content and geometry", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, { paneId, revision: `u1|dark|${geometry(400)}`, image, savedAt: 1 });
  await mount();
  expect(hook.getPanePicture(pane)).toEqual({ image, fit: "fill", replaceable: true });

  hook.onLayoutChange(layout(500));
  expect(hook.getPanePicture(pane)).toBeNull();
  hook.onLayoutChange(layout(400));
  resize(900, 600);
  expect(hook.getPanePicture(pane)).toBeNull();
});

it("saves captures only from panes showing a synchronized thread", async () => {
  await mount();
  const image = new Blob(["png"]);
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(0);

  markPaneSynced(paneId, true);
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toMatchObject({ paneId, revision: `u1|dark|${geometry(400)}`, image });
});

it("keeps previously valid cover pixels while treating updated content as needing a fresh picture", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, { paneId, revision: `u1|dark|${geometry(400)}`, image, savedAt: 1 });
  await mount();
  const resolver = hook.getPanePicture;
  expect(hook.pictureFor(paneId)).toBe(image);
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(hook.pictureFor(paneId)).toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.getPanePicture).toBe(resolver);
  expect(resolver(pane)).toBeNull();
});

it("does not display an old persisted picture that was never valid in this session", async () => {
  store.saved.set(paneId, {
    paneId,
    revision: `old|dark|${geometry(400)}`,
    image: new Blob(["png"]),
    savedAt: 1,
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBeNull();
});

it("lets an accepted native capture suppress the pending fallback drawing", async () => {
  await mount();
  markPaneSynced(paneId, true);
  hook.requestSnapshot(paneId, { isConnected: true } as HTMLElement, true);
  await act(async () => {
    hook.onPanePictureCaptured(pane, new Blob(["native"]));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.source).toBe("capture");
});

it("draws a fallback when the browser exposes native capture but the engine cannot use it", async () => {
  await mount();
  nativeCapture.available = true;
  markPaneSynced(paneId, true);
  hook.requestSnapshot(
    paneId,
    {
      isConnected: true,
      closest: () => ({ dataset: { visible: "true" } }),
    } as unknown as HTMLElement,
    true,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes[0]?.source).toBe("snapshot");
});

it("does not draw pending pictures after the workspace unmounts", async () => {
  await mount();
  markPaneSynced(paneId, true);
  hook.requestSnapshot(paneId, { isConnected: true } as HTMLElement, true);
  await act(() => renderer!.unmount());
  renderer = undefined;
  await vi.advanceTimersByTimeAsync(3000);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});
