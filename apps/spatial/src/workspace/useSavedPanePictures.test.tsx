import type { OnirigiriLayout, WorkspacePane } from "@riteofstring/onirigiri";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { SavedPanePicture } from "./panePictureStore";
import { markPaneSynced, useSavedPanePictures } from "./useSavedPanePictures";

const store = {
  saved: new Map<string, SavedPanePicture>(),
  writes: [] as SavedPanePicture[],
  updatedAt: "u1",
  running: false,
  theme: "dark",
  themeHalves: null as { dark?: string; light?: string } | null,
};
const snapshot = vi.hoisted(() => vi.fn(async () => new Blob(["snapshot"])));
vi.mock("./panePictureSnapshot", () => ({
  snapshotPanePicture: snapshot,
}));
vi.mock("./panePictureStore", () => ({
  MAX_SAVED: 200,
  loadPanePictures: async () => store.saved,
  savePanePicture: async (picture: SavedPanePicture) => {
    store.writes.push(picture);
  },
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark", theme: store.theme, themeHalves: store.themeHalves }),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShells: () => [
    {
      environmentId: "e",
      id: "t1",
      updatedAt: store.updatedAt,
      latestTurn: { state: store.running ? "running" : "completed" },
    },
  ],
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
const getLayout = () => currentLayout;

function Probe() {
  const value = useSavedPanePictures(getLayout);
  useEffect(() => {
    hook = value;
  });
  return null;
}

async function mount() {
  await act(async () => {
    renderer = create(<Probe />);
  });
  await act(() => {
    hook.stageRef({} as HTMLElement);
    resize(800, 600);
  });
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
  store.running = false;
  store.theme = "dark";
  store.themeHalves = null;
  currentLayout = layout(400);
  markPaneSynced(paneId, null);
  snapshot.mockClear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("seeds a pane only with a picture of the same content and geometry", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, { paneId, revision: `u1|dark|dark|${geometry(400)}`, image, savedAt: 1 });
  await mount();
  expect(hook.getPanePicture(pane)).toEqual({ image, fit: "fill", replaceable: true });

  await act(() => hook.onLayoutChange(layout(500)));
  expect(hook.getPanePicture(pane)).toBeNull();
  await act(() => {
    hook.onLayoutChange(layout(400));
    resize(900, 600);
  });
  expect(hook.getPanePicture(pane)).toBeNull();
});

it("saves captures only from panes showing a synchronized thread", async () => {
  await mount();
  const image = new Blob(["png"]);
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(0);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toMatchObject({
    paneId,
    revision: `u1|dark|dark|${geometry(400)}`,
    image,
  });
});

it("keeps the last completed picture through streaming and saves the completed turn", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  const previous = new Blob(["previous"]);
  await act(() => hook.onPanePictureCaptured(pane, previous));

  store.running = true;
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["partial"])));
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.image).toBe(previous);

  store.running = false;
  await act(() => renderer!.update(<Probe />));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  const completed = new Blob(["completed"]);
  await act(() => hook.onPanePictureCaptured(pane, completed));
  expect(store.writes).toHaveLength(2);
  expect(store.writes[1]).toMatchObject({
    revision: `u2|dark|dark|${geometry(400)}`,
    image: completed,
  });
});

it("refreshes pictures when the palette changes within the same appearance", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  const previous = new Blob(["previous palette"]);
  await act(() => hook.onPanePictureCaptured(pane, previous));
  expect(hook.pictureFor(paneId)).toBe(previous);

  store.theme = "ocean";
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)).toBe(previous);
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["old palette"])));
  expect(store.writes).toHaveLength(1);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "ocean|dark" });
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["ocean"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);

  store.themeHalves = { dark: "iris" };
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "iris|dark" });
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["iris"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(store.writes[2]?.revision).toBe(`u1|iris|dark|${geometry(400)}`);
});

it("waits for committed detail to catch up with shell metadata before saving either picture path", async () => {
  store.updatedAt = "u2";
  await mount();
  markPaneSynced(paneId, { updatedAt: "u1", theme: "dark|dark" });
  const element = { isConnected: true } as HTMLElement;
  hook.onPanePictureCaptured(pane, new Blob(["old detail"]));
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(store.writes).toHaveLength(0);
  expect(snapshot).not.toHaveBeenCalled();

  markPaneSynced(paneId, { updatedAt: "u3", theme: "dark|dark" });
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.revision).toBe(`u2|dark|dark|${geometry(400)}`);

  markPaneSynced(paneId, { updatedAt: "u3", theme: "light" });
  hook.onPanePictureCaptured(pane, new Blob(["wrong theme"]));
  expect(store.writes).toHaveLength(1);
});

it("keeps previously valid cover pixels while treating updated content as needing a fresh picture", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, { paneId, revision: `u1|dark|dark|${geometry(400)}`, image, savedAt: 1 });
  await mount();
  const resolver = hook.getPanePicture;
  const cover = hook.pictureFor;
  expect(hook.pictureFor(paneId)).toBe(image);
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(hook.pictureFor(paneId)).toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.getPanePicture).toBe(resolver);
  expect(hook.pictureFor).toBe(cover);
  expect(resolver(pane)).toBeNull();
});

it("does not display an old persisted picture that was never valid in this session", async () => {
  store.saved.set(paneId, {
    paneId,
    revision: `old|dark|dark|${geometry(400)}`,
    image: new Blob(["png"]),
    savedAt: 1,
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBeNull();
});

it("lets an accepted native capture suppress the pending fallback drawing", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  hook.requestSnapshot(paneId, { isConnected: true } as HTMLElement, { preferNative: true });
  await act(async () => {
    hook.onPanePictureCaptured(pane, new Blob(["native"]));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.source).toBe("capture");
});

it("draws a fallback after the native grace period when no capture arrives", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  hook.requestSnapshot(
    paneId,
    {
      isConnected: true,
      closest: () => ({ dataset: { visible: "true" } }),
    } as unknown as HTMLElement,
    { preferNative: true },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes[0]?.source).toBe("snapshot");
});

it("replaces retained cover pixels when a fresh capture arrives", async () => {
  const previous = new Blob(["previous"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${geometry(400)}`,
    image: previous,
    savedAt: 1,
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBe(previous);
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  const replacement = new Blob(["replacement"]);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  await act(() => hook.onPanePictureCaptured(pane, replacement));
  expect(hook.pictureFor(paneId)).toBe(replacement);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("does not draw pending pictures after the workspace unmounts", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  hook.requestSnapshot(paneId, { isConnected: true } as HTMLElement, { preferNative: true });
  await act(() => renderer!.unmount());
  renderer = undefined;
  await vi.advanceTimersByTimeAsync(3000);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});

it("reuses a matching snapshot until a departed pane needs its scroll position refreshed", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  const element = { isConnected: true } as HTMLElement;
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  hook.requestSnapshot(paneId, element, { refresh: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
});

it("waits until a running turn completes before drawing its fallback picture", async () => {
  store.running = true;
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  const element = { isConnected: true } as HTMLElement;
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
  store.running = false;
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: "dark|dark" });
  hook.requestSnapshot(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.canBackgroundPicture(paneId)).toBe(true);
});
