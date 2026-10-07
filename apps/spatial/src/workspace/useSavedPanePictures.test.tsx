import type { OnirigiriLayout, WorkspacePane } from "@riteofstring/onirigiri";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { SavedPanePicture } from "./panePictureStore";
import { markPaneSynced, useSavedPanePictures } from "./useSavedPanePictures";

const store = {
  saved: new Map<string, SavedPanePicture>(),
  writes: [] as SavedPanePicture[],
};
vi.mock("./panePictureStore", () => ({
  loadPanePictures: async () => store.saved,
  savePanePicture: async (picture: SavedPanePicture) => {
    store.writes.push(picture);
  },
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShells: () => [{ environmentId: "e", id: "t1", updatedAt: "u1" }],
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

function Probe() {
  const value = useSavedPanePictures(() => currentLayout);
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
  vi.stubGlobal("window", { devicePixelRatio: 1, addEventListener() {} });
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
  currentLayout = layout(400);
  markPaneSynced(paneId, false);
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
