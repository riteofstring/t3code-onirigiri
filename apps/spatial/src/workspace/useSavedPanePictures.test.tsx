import { observePaneVisualChanges } from "./paneVisualChanges";
// @vitest-environment jsdom

import type {
  OnirigiriLayout,
  PaneDefaultsConfiguration,
  PanePresentationContext,
  WorkspacePane,
} from "@riteofstring/onirigiri";
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import { useEffect, useMemo } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { PanePictureSnapshot } from "./panePictureSnapshot";
import { pictureRecordKey, type SavedPanePicture } from "./panePictureStore";
import { createPaneLifecycleStore } from "./paneLifecycle";
import { markPaneSynced, usePanePictureTheme, useSavedPanePictures } from "./useSavedPanePictures";
import { simulatePicturePressure } from "./picturePressure.test-support";

const defaultFontSettings = {
  fontFamilySans: "",
  fontFamilyCode: "",
  fontFamilyComposer: "",
  fontSizeInterface: 16,
  fontSizePrompt: 14,
  fontSizeCode: 13,
  fontSmoothing: true,
  panelAnimationDurationMs: 200,
};
const fontRevision = '["","","",16,14,13,true]';

const store = {
  saved: new Map<string, SavedPanePicture>(),
  loading: null as Promise<Map<string, SavedPanePicture>> | null,
  writes: [] as SavedPanePicture[],
  threadIds: ["t1"],
  updatedAt: "u1",
  runtimeStatus: null as ThreadRuntimeSummary["status"] | null,
  theme: "dark",
  themeHalves: null as { dark?: string; light?: string } | null,
  fontSettings: { ...defaultFontSettings },
};
const decodedUrls: string[] = [];
const revokedUrls: string[] = [];
const resolutionQueries: (EventTarget & { media: string })[] = [];

const snapshot = vi.hoisted(() =>
  vi.fn(
    async (
      _element: HTMLElement,
      canSnapshot: () => boolean,
      _waitToDraw?: () => Promise<boolean>,
    ): Promise<PanePictureSnapshot | null> =>
      canSnapshot()
        ? { image: new Blob(["snapshot"]), cssSize: { width: 400, height: 580 } }
        : null,
  ),
);
vi.mock("./panePictureSnapshot", () => ({
  snapshotPanePicture: snapshot,
}));
vi.mock("./panePictureStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./panePictureStore")>()),
  loadPanePictures: async () => {
    const pictures = await (store.loading ?? store.saved);
    return new Map([...pictures.values()].map((picture) => [picture.recordKey, picture]));
  },
  savePanePicture: async (picture: SavedPanePicture) => {
    store.writes.push(picture);
  },
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark", theme: store.theme, themeHalves: store.themeHalves }),
}));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof defaultFontSettings) => unknown) =>
    select(store.fontSettings),
}));
let shells: { key: string; value: unknown[] } | null = null;
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShells: () => {
    const key = JSON.stringify([store.threadIds, store.updatedAt, store.runtimeStatus]);
    if (shells?.key !== key)
      shells = {
        key,
        value: store.threadIds.map((id) => ({
          environmentId: "e",
          id,
          updatedAt: store.updatedAt,
          runtime: store.runtimeStatus ? { status: store.runtimeStatus } : null,
        })),
      };
    return shells.value;
  },
}));
vi.mock("./useWorkspacePanes", () => ({
  threadPaneId: (environmentId: string, threadId: string) => `thread:${environmentId}:${threadId}`,
}));

const paneId = "thread:e:t1";
const pane = { paneId } as WorkspacePane;
const threadPane = { ...pane, surfaceKind: "thread" };
const presentationAt = (
  phase: PanePresentationContext["phase"],
  visible = true,
  focused = visible,
) =>
  hook.getPanePresentation(threadPane, {
    phase,
    focused,
    maximized: false,
    visible,
    capabilities: { canCapture: true, hasVideo: false },
  });
const layout = (width: number) =>
  ({
    panes: store.threadIds.map((id) => ({ paneId: `thread:e:${id}` })),
    columns: store.threadIds.map((id) => ({
      cells: [{ paneId: `thread:e:${id}`, weight: 1 }],
      widthSpec: { unit: "px", value: width },
    })),
  }) as unknown as OnirigiriLayout;
const geometry = (width: number) =>
  `stage:800x600@1|light:|[null,{"unit":"px","value":${width}},[[null,1,[null,null]]]]|0|tiled`;

type ResizeEntry = { contentRect: { width: number; height: number } };
const resizeObservers = new Map<Element, (entries: ResizeEntry[]) => void>();
let workspace: HTMLDivElement;
let stage: HTMLDivElement;
const resizeElement = (element: Element, width: number, height: number) => {
  resizeObservers.get(element)?.([{ contentRect: { width, height } }]);
};
const resize = (width: number, height: number) => {
  resizeElement(workspace, width, height);
  resizeElement(stage, width, height);
};
let hook: ReturnType<typeof useSavedPanePictures>;
let appearance: string;
let shownPicture: Blob | null = null;
let renderer: ReactTestRenderer | undefined;
let currentLayout = layout(400);
let picturesEnabled = true;
let motionDecision: string | null | undefined;
let appliedDefaults: PaneDefaultsConfiguration = {};
const getScene = () => ({ ...currentLayout, ...appliedDefaults });
const publishLayout = (layout: OnirigiriLayout) => {
  currentLayout = layout;
  hook.onLayoutChange();
};
const snapshotFailures = vi.fn<(paneId: string, startedAt: number) => void>();
const backgroundPanes = new Set<string>();
let backgroundLifecycle: ReturnType<typeof createPaneLifecycleStore> | null = null;
const pictureMount = (id: string) =>
  backgroundLifecycle
    ? backgroundLifecycle.pictureMount(id)
    : backgroundPanes.has(id)
      ? "background"
      : "ordinary";

function Probe() {
  const pictureAppearance = usePanePictureTheme();
  const value = useSavedPanePictures(
    getScene,
    snapshotFailures,
    pictureMount,
    picturesEnabled,
    () => motionDecision,
  );
  const { pictureFor } = value;
  const shown = useMemo(() => pictureFor(paneId)?.image ?? null, [pictureFor]);
  useEffect(() => {
    hook = value;
    appearance = pictureAppearance;
    shownPicture = shown;
  });
  return null;
}

async function mount({ compact = false, resizeStage = true } = {}) {
  workspace?.remove();
  workspace = document.createElement("div");
  const engine = document.createElement("div");
  engine.dataset.onirigiriSlot = "workspace";
  engine.dataset.compactLayout = String(compact);
  stage = document.createElement("div");
  stage.dataset.onirigiriSlot = "stage";
  engine.append(stage);
  workspace.append(engine);
  document.body.append(workspace);
  await act(async () => {
    renderer = create(<Probe />);
  });
  await act(() => {
    hook.stageRef(workspace);
    if (resizeStage) resize(800, 600);
  });
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const contentRevision = `u1|dark|dark|${fontRevision}|chat-chrome-2`;

const savedPicture = (picture: Partial<SavedPanePicture> = {}): SavedPanePicture => {
  const id = picture.paneId ?? paneId;
  const geometryRevision = picture.geometryRevision ?? geometry(400);
  return {
    recordKey: pictureRecordKey(id, geometryRevision),
    paneId: id,
    geometryRevision,
    revision: `${contentRevision}|native-worker-9`,
    image: new Blob(["png"]),
    cssSize: { width: 400, height: 580 },
    savedAt: 1,
    ...picture,
  };
};

function pictureImageFor(id: string): Blob | null {
  return hook.pictureFor(id)?.image ?? null;
}

async function drawPicture(
  target: WorkspacePane,
  image: Blob,
  cssSize = { width: 400, height: 580 },
) {
  const implementation = snapshot.getMockImplementation()!;
  snapshot.mockImplementation(async (_element, canSnapshot) =>
    canSnapshot() ? { image, cssSize } : null,
  );
  hook.paneSnapshots.request(target.paneId, { isConnected: true } as HTMLElement);
  await vi.advanceTimersByTimeAsync(3500);
  snapshot.mockImplementation(implementation);
  snapshot.mockClear();
}

function pendingPicture() {
  let resolve!: (image: Blob | null) => void;
  const promise = new Promise<PanePictureSnapshot | null>((done) => {
    resolve = (image) => done(image ? { image, cssSize: { width: 400, height: 580 } } : null);
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  let nextUrl = 0;
  vi.stubGlobal("URL", {
    createObjectURL: () => `blob:picture-${++nextUrl}`,
    revokeObjectURL: (url: string) => revokedUrls.push(url),
  });
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode() {
        decodedUrls.push(this.src);
        return Promise.resolve();
      }
    },
  );
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      devicePixelRatio: 1,
      matchMedia: (media: string) => {
        const query = Object.assign(new EventTarget(), { media });
        resolutionQueries.push(query);
        return query;
      },
    }),
  );
  vi.stubGlobal("requestIdleCallback", (callback: (deadline: IdleDeadline) => void) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
  );
  vi.stubGlobal("cancelIdleCallback", (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      private readonly elements = new Set<Element>();
      constructor(private readonly callback: (entries: ResizeEntry[]) => void) {}
      observe(element: Element) {
        this.elements.add(element);
        resizeObservers.set(element, this.callback);
      }
      disconnect() {
        for (const element of this.elements) resizeObservers.delete(element);
        this.elements.clear();
      }
    },
  );
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  hook.stageRef(null);
  workspace?.remove();
  resizeObservers.clear();
  resolutionQueries.length = 0;
  decodedUrls.length = 0;
  revokedUrls.length = 0;
  store.saved.clear();
  store.loading = null;
  store.writes.length = 0;
  for (const id of store.threadIds) markPaneSynced(`thread:e:${id}`, null);
  store.threadIds = ["t1"];
  store.updatedAt = "u1";
  store.runtimeStatus = null;
  store.theme = "dark";
  store.themeHalves = null;
  store.fontSettings = { ...defaultFontSettings };
  currentLayout = layout(400);
  appliedDefaults = {};
  picturesEnabled = true;
  motionDecision = undefined;
  markPaneSynced(paneId, null);
  backgroundPanes.clear();
  backgroundLifecycle?.dispose();
  backgroundLifecycle = null;
  snapshot.mockReset();
  snapshotFailures.mockReset();
  snapshot.mockImplementation(async (_element, canSnapshot) =>
    canSnapshot() ? { image: new Blob(["snapshot"]), cssSize: { width: 400, height: 580 } } : null,
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("keeps live presentation without restoring or capturing pictures when disabled", async () => {
  picturesEnabled = false;
  store.saved.set(paneId, savedPicture());
  await mount();
  expect(hook.stageViewport).toEqual({ width: 800, height: 600, compact: false });
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(decodedUrls).toEqual([]);
  for (const phase of ["rest", "motion", "overview", "overview-motion", "resize"] as const) {
    expect(presentationAt(phase)).toBe("dom");
    expect(presentationAt(phase, false)).toBe("dom");
  }
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.setCaptureActivity(true, false);
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(4000);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toEqual([]);
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
});

it("excludes a previous geometry until matching replacement pixels arrive", async () => {
  const image = new Blob(["png"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, image));
  expect(hook.pictureFor(paneId)).toMatchObject({
    image,
    cssSize: { width: 400, height: 580 },
  });

  await act(() => publishLayout(layout(500)));
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  await act(() => {
    publishLayout(layout(400));
    resize(900, 600);
  });
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
});

it("refreshes pictures when the engine stage grows inside an unchanged workspace", async () => {
  await mount();
  expect(hook.stageViewport).toEqual({ width: 800, height: 600, compact: false });
  await act(() => resizeElement(stage, 800, 562));
  expect(hook.stageViewport.height).toBe(562);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const oldImage = new Blob(["shorter stage"]);
  await act(() => drawPicture(pane, oldImage));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  const oldGeometry = store.writes[0]!.geometryRevision;

  await act(() => resizeElement(stage, 800, 600));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(pictureImageFor(paneId)).toBeNull();

  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)?.image).not.toBe(oldImage);
  expect(store.writes[1]!.geometryRevision).not.toBe(oldGeometry);
});

it("follows committed compact layout after a same-size resize without resizing again", async () => {
  await mount();
  const engine = stage.parentElement!;
  const geometryVersion = hook.paneSnapshots.geometryVersion;
  await act(() => resize(800, 600));
  expect(hook.paneSnapshots.geometryVersion).toBe(geometryVersion);
  await act(async () => {
    engine.dataset.compactLayout = "true";
  });
  expect(workspace.dataset.spatialCompact).toBe("true");
  expect(hook.stageViewport).toEqual({ width: 800, height: 600, compact: true });
  await act(() => resize(0, 0));
  const compactVersion = hook.paneSnapshots.geometryVersion;
  expect(compactVersion).not.toBe(geometryVersion);
  await act(async () => {
    engine.dataset.compactLayout = "false";
  });
  expect(workspace.dataset.spatialCompact).toBe("false");
  expect(hook.stageViewport).toEqual({ width: 800, height: 600, compact: false });
  expect(hook.paneSnapshots.geometryVersion).not.toBe(compactVersion);
});

it("initializes compact controls before any positive stage measurement", async () => {
  await mount({ compact: true, resizeStage: false });
  expect(workspace.dataset.spatialCompact).toBe("true");
  expect(hook.stageViewport).toEqual({ width: 0, height: 0, compact: true });
});

it("releases compact ownership and ignores callbacks from replaced stages", async () => {
  const NativeMutationObserver = MutationObserver;
  const observed: { callback: MutationCallback; observer: MutationObserver }[] = [];
  vi.stubGlobal(
    "MutationObserver",
    class extends NativeMutationObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observed.push({ callback, observer: this });
      }
    },
  );
  await mount({ compact: true });
  const oldEngine = stage.parentElement!;
  const oldResize = resizeObservers.get(stage)!;
  const oldCompact = observed[0]!;
  const replacement = document.createElement("div");
  replacement.dataset.onirigiriSlot = "workspace";
  replacement.dataset.compactLayout = "false";
  const nextStage = document.createElement("div");
  nextStage.dataset.onirigiriSlot = "stage";
  replacement.append(nextStage);
  await act(() => {
    oldEngine.replaceWith(replacement);
    stage = nextStage;
    publishLayout(currentLayout);
    resizeElement(stage, 700, 500);
  });
  expect(workspace.dataset.spatialCompact).toBe("false");
  await act(async () => {
    oldEngine.dataset.compactLayout = "false";
    oldEngine.dataset.compactLayout = "true";
    oldCompact.callback([], oldCompact.observer);
    oldResize([{ contentRect: { width: 100, height: 100 } }]);
  });
  expect(workspace.dataset.spatialCompact).toBe("false");
  expect(hook.stageViewport).toEqual({ width: 700, height: 500, compact: false });
  const currentCompact = observed.at(-1)!;
  await act(() => hook.stageRef(null));
  expect(workspace.hasAttribute("data-spatial-compact")).toBe(false);
  await act(async () => {
    replacement.dataset.compactLayout = "true";
    currentCompact.callback([], currentCompact.observer);
  });
  expect(workspace.hasAttribute("data-spatial-compact")).toBe(false);
  expect(hook.stageViewport.compact).toBe(false);
});

it("binds a stage that appears after its outer workspace", async () => {
  await act(async () => {
    renderer = create(<Probe />);
  });
  workspace = document.createElement("div");
  await act(() => {
    hook.stageRef(workspace);
    resizeElement(workspace, 800, 600);
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, new Blob(["before stage"])));
  expect(store.writes).toHaveLength(0);

  const engine = document.createElement("div");
  engine.dataset.onirigiriSlot = "workspace";
  stage = document.createElement("div");
  stage.dataset.onirigiriSlot = "stage";
  engine.append(stage);
  workspace.append(engine);
  await act(() => {
    publishLayout(currentLayout);
    resizeElement(stage, 800, 600);
  });
  await act(() => drawPicture(pane, new Blob(["ready stage"])));
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

function fillPictureCache() {
  store.threadIds = Array.from({ length: 201 }, (_, i) => `t${i + 1}`);
  currentLayout = layout(400);
  for (let i = 0; i < 200; i++) {
    const id = `thread:e:${store.threadIds[i]}`;
    store.saved.set(id, savedPicture({ paneId: id, image: new Blob([String(i)]), savedAt: i + 1 }));
  }
}

it("keeps the in-memory set under the byte cap and stops background filling near it", async () => {
  const heavy = (name: string) => ({ size: 70 * 1024 * 1024, name }) as unknown as Blob;
  store.threadIds = ["t1", "t2", "t3"];
  currentLayout = layout(400);
  const second = "thread:e:t2";
  const third = "thread:e:t3";
  store.saved.set(paneId, savedPicture({ image: heavy("older"), savedAt: 1 }));
  store.saved.set(second, savedPicture({ paneId: second, image: heavy("newer"), savedAt: 2 }));
  await mount();
  expect(pictureImageFor(second)).toBe(store.saved.get(second)!.image);
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.displayedPictureFor(paneId)).toBeNull();
  expect(hook.canBackgroundPicture(second)).toBe(true);
  expect(hook.canBackgroundPicture(third)).toBe(false);
  expect(hook.canBackgroundPicture(third, true)).toBe(true);
});

it("does not admit background pictures before the stage geometry is known", async () => {
  await mount({ resizeStage: false });
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
  expect(hook.canBackgroundPicture(paneId, true)).toBe(false);
  await act(() => resize(800, 600));
  expect(hook.canBackgroundPicture(paneId)).toBe(true);
});

it("prepares this workspace even when other workspaces fill the persistent cache", async () => {
  fillPictureCache();
  store.threadIds = ["t201"];
  currentLayout = layout(400);
  await mount();
  const nextId = "thread:e:t201";
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
  markPaneSynced(nextId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(nextId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(hook.hasFreshPicture(nextId)).toBe(true);
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
});

it("prepares the current geometry even when older display variants fill the cache", async () => {
  fillPictureCache();
  await mount();
  const nextId = "thread:e:t201";
  expect(hook.canBackgroundPicture(nextId)).toBe(false);
  await act(() => resize(900, 600));
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
  markPaneSynced(nextId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(nextId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.hasFreshPicture(nextId)).toBe(true);
});

it("does not refill its own evictions but still snapshots visited panes", async () => {
  fillPictureCache();
  await mount();
  const nextId = "thread:e:t201";
  expect(hook.canBackgroundPicture(nextId)).toBe(false);
  expect(hook.canBackgroundPicture(nextId, true)).toBe(true);
  expect(hook.canBackgroundPicture(paneId)).toBe(true);
  markPaneSynced(nextId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(nextId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.hasFreshPicture(nextId)).toBe(true);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.canBackgroundPicture(paneId)).toBe(false);

  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(nextId)).toBe(false);
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
});

it("reuses a picture saved before the workspace was recreated without a new capture", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(store.writes).toHaveLength(1);
  const accepted = store.writes[0]!;
  const previousUrl = hook.pictureUrl(accepted.image);
  const draws = snapshot.mock.calls.length;
  await act(() => renderer!.unmount());
  renderer = undefined;
  markPaneSynced(paneId, null);
  store.saved.set(paneId, accepted);

  await mount();
  expect(hook.pictureFor(paneId)?.image).toBe(accepted.image);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.pictureUrl(accepted.image)).not.toBe(previousUrl);
  expect(revokedUrls).toContain(previousUrl);
  expect(snapshot).toHaveBeenCalledTimes(draws);
  expect(store.writes).toHaveLength(1);
});

it("keeps the last completed picture through streaming and saves the completed turn", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const previous = new Blob(["previous"]);
  await act(() => drawPicture(pane, previous));

  store.runtimeStatus = "running";
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(hook.canBackgroundPicture(paneId, true)).toBe(false);
  await act(() => drawPicture(pane, new Blob(["partial"])));
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.image).toBe(previous);

  store.runtimeStatus = null;
  await act(() => renderer!.update(<Probe />));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const completed = new Blob(["completed"]);
  await act(() => drawPicture(pane, completed));
  expect(store.writes).toHaveLength(2);
  expect(store.writes[1]).toMatchObject({
    revision: `u2|dark|dark|${fontRevision}|chat-chrome-2|native-worker-9`,
    image: completed,
  });
});

it("refreshes pictures when the palette changes within the same appearance", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const previous = new Blob(["previous palette"]);
  await act(() => drawPicture(pane, previous));
  expect(pictureImageFor(paneId)).toBe(previous);

  store.theme = "ocean";
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(pictureImageFor(paneId)).toBeNull();
  await act(() => drawPicture(pane, new Blob(["old palette"])));
  expect(store.writes).toHaveLength(1);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `ocean|dark|${fontRevision}` });
  await act(() => drawPicture(pane, new Blob(["ocean"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);

  store.themeHalves = { dark: "iris" };
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `iris|dark|${fontRevision}` });
  await act(() => drawPicture(pane, new Blob(["iris"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(store.writes[2]?.revision).toBe(
    `u1|iris|dark|${fontRevision}|chat-chrome-2|native-worker-9`,
  );
});

it("waits for committed detail to catch up with shell metadata before saving a picture", async () => {
  store.updatedAt = "u2";
  await mount();
  markPaneSynced(paneId, { updatedAt: "u1", theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(store.writes).toHaveLength(0);
  expect(snapshot).not.toHaveBeenCalled();

  markPaneSynced(paneId, { updatedAt: "u3", theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.revision).toBe(
    `u2|dark|dark|${fontRevision}|chat-chrome-2|native-worker-9`,
  );

  markPaneSynced(paneId, { updatedAt: "u3", theme: "light" });
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(store.writes).toHaveLength(1);
});

it("excludes previous content while treating updated content as needing a fresh picture", async () => {
  const image = new Blob(["png"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, image));
  store.writes.length = 0;
  const resolver = hook.pictureFor;
  const cover = hook.pictureFor;
  expect(pictureImageFor(paneId)).toBe(image);
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor).toBe(resolver);
  expect(hook.pictureFor).toBe(cover);
  expect(resolver(paneId)?.image).toBeUndefined();
});

it.each([
  ["content", "old", "chat-chrome-2"],
  ["chat rendering", "u1", "chat-chrome-1"],
])("does not display a persisted picture with outdated %s", async (_changed, updatedAt, chrome) => {
  store.saved.set(
    paneId,
    savedPicture({ revision: `${updatedAt}|dark|dark|${fontRevision}|${chrome}` }),
  );
  await mount();
  expect(pictureImageFor(paneId)).toBeNull();
});

it("keeps validated geometry while a workspace is temporarily hidden", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["cover"]);
  await act(() => drawPicture(pane, image));
  const version = hook.paneSnapshots.geometryVersion;
  await act(() => resize(0, 0));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.paneSnapshots.geometryVersion).toBe(version);
  await act(() => resize(800, 600));
  expect(hook.pictureFor(paneId)?.image).toBe(image);
});

it("retries a failed static capture without another interaction", async () => {
  snapshot.mockResolvedValueOnce(null);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes).toHaveLength(0);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  await advance(10_000);
  expect(snapshot).toHaveBeenCalledTimes(2);
});

it.each(["null", "error"])(
  "keeps lifecycle backoff after a %s snapshot failure despite later input and prepares the next pane",
  async (failure) => {
    store.threadIds = ["t0", "t1", "t2", "t3"];
    currentLayout = layout(400);
    for (const id of ["t0", "t1"]) {
      const idToSeed = `thread:e:${id}`;
      store.saved.set(idToSeed, savedPicture({ paneId: idToSeed, image: new Blob(["cover"]) }));
    }
    await mount();
    const panes = store.threadIds.map((id, slot) => ({
      paneId: `thread:e:${id}`,
      plane: 0,
      slot,
    }));
    for (const paneId of ["thread:e:t0", "thread:e:t1"]) {
      markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
      await act(() => drawPicture({ paneId } as WorkspacePane, new Blob(["current"])));
    }
    const lifecycle = createPaneLifecycleStore(panes, "thread:e:t0");
    snapshotFailures.mockImplementation((id, startedAt) => lifecycle.pictureFailed(id, startedAt));
    const nearest = { isConnected: true } as HTMLElement;
    snapshot.mockImplementation(async (element, canSnapshot) => {
      if (!canSnapshot()) return null;
      if (element !== nearest)
        return { image: new Blob(["farther pane"]), cssSize: { width: 400, height: 580 } };
      if (failure === "error") throw new Error("Image encoding failed");
      return null;
    });
    const mounts: string[] = [];
    for (const { paneId: id } of panes) {
      lifecycle.subscribe(id, () => {
        const mounted = lifecycle.isMounted(id);
        markPaneSynced(id, mounted ? { updatedAt: store.updatedAt, theme: appearance } : null);
        if (!mounted || hook.hasFreshPicture(id)) return;
        mounts.push(id);
        hook.paneSnapshots.request(
          id,
          id === "thread:e:t2" ? nearest : ({ isConnected: true } as HTMLElement),
        );
        if (id === "thread:e:t2") {
          setTimeout(() => window.dispatchEvent(new Event("keydown")), 8000);
        }
      });
    }
    lifecycle.setPictures((id) => hook.hasFreshPicture(id));
    lifecycle.setBackgroundPictures(true);
    await advance(60_000);
    expect(mounts.filter((id) => id === "thread:e:t2")).toHaveLength(1);
    expect(mounts.slice(1).every((id) => id === "thread:e:t3")).toBe(true);
    expect(hook.hasFreshPicture("thread:e:t3")).toBe(true);
    expect(snapshotFailures.mock.calls.length).toBeGreaterThan(0);
    expect(snapshotFailures.mock.calls.every(([id]) => id === "thread:e:t2")).toBe(true);
    lifecycle.dispose();
  },
);

it("retries a transient first picture failure at idle without discarding the uncaptured view", async () => {
  store.threadIds = ["t0", "t1", "t2"];
  currentLayout = layout(400);
  store.saved.set("thread:e:t0", savedPicture({ paneId: "thread:e:t0" }));
  await mount();
  const panes = store.threadIds.map((id, slot) => ({ paneId: `thread:e:${id}`, plane: 0, slot }));
  const lifecycle = createPaneLifecycleStore(panes, "thread:e:t0");
  backgroundLifecycle = lifecycle;
  snapshotFailures.mockImplementation((id, startedAt) => lifecycle.pictureFailed(id, startedAt));
  let attempts = 0;
  const failedElement = { isConnected: true } as HTMLElement;
  snapshot.mockImplementation(async (element, canSnapshot) => {
    if (!canSnapshot()) return null;
    if (element === failedElement && ++attempts === 1) return null;
    return { image: new Blob(["recovered"]), cssSize: { width: 400, height: 580 } };
  });
  const owners: string[][] = [];
  for (const { paneId: id } of panes)
    lifecycle.subscribe(id, () => {
      const mounted = lifecycle.isMounted(id);
      owners.push(panes.filter((p) => lifecycle.isMounted(p.paneId)).map((p) => p.paneId));
      markPaneSynced(id, mounted ? { updatedAt: store.updatedAt, theme: appearance } : null);
      if (mounted && !hook.hasFreshPicture(id))
        hook.paneSnapshots.request(
          id,
          id === "thread:e:t1" ? failedElement : ({ isConnected: true } as HTMLElement),
        );
    });
  for (const { paneId: id } of panes) {
    if (!lifecycle.isMounted(id)) continue;
    markPaneSynced(id, { updatedAt: store.updatedAt, theme: appearance });
    hook.paneSnapshots.request(
      id,
      id === "thread:e:t1" ? failedElement : ({ isConnected: true } as HTMLElement),
    );
  }
  lifecycle.setPictures((id) => hook.hasFreshPicture(id));
  lifecycle.setBackgroundPictures(true);
  await advance(20_000);
  expect(attempts).toBe(2);
  expect(hook.hasFreshPicture("thread:e:t1")).toBe(true);
  expect(hook.hasFreshPicture("thread:e:t2")).toBe(true);
  expect(lifecycle.isMounted("thread:e:t1")).toBe(true);
  expect(owners.every((ids) => ids.includes("thread:e:t0"))).toBe(true);
  lifecycle.dispose();
});

it("reports the capture start time when a pending snapshot later fails", async () => {
  const pending = pendingPicture();
  let startedAt = -1;
  snapshot.mockImplementationOnce(() => {
    startedAt = performance.now();
    return pending.promise;
  });
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(snapshotFailures).not.toHaveBeenCalled();
  await advance(5000);
  expect(performance.now() - startedAt).toBeGreaterThanOrEqual(5000);
  await act(() => pending.resolve(null));
  expect(snapshotFailures).toHaveBeenCalledExactlyOnceWith(paneId, startedAt);
});

it.each(["motion", "input", "content", "readiness", "disconnect"])(
  "does not report a failed reservation when %s invalidates an unfinished capture",
  async (change) => {
    const pending = pendingPicture();
    let canSnapshot = () => true;
    snapshot.mockImplementationOnce((_element, allowed) => {
      canSnapshot = allowed;
      return pending.promise;
    });
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const element = { isConnected: true };
    hook.paneSnapshots.request(paneId, element as HTMLElement);
    await advance(500);
    expect(snapshot).toHaveBeenCalledOnce();

    if (change === "motion") hook.setCaptureActivity(true, true);
    else if (change === "input") window.dispatchEvent(new Event("keydown"));
    else if (change === "content") {
      store.updatedAt = "u2";
      await act(() => renderer!.update(<Probe />));
    } else if (change === "readiness") markPaneSynced(paneId, null);
    else if (change === "disconnect") element.isConnected = false;

    if (change === "motion" || change === "input") {
      expect(canSnapshot()).toBe(false);
      hook.setCaptureActivity(true, false);
      await advance(500);
    }
    await act(() => pending.resolve(null));
    expect(snapshotFailures).not.toHaveBeenCalled();
  },
);

it("does not show a picture from an old drawing style, refreshes it and keeps the replacement current after a reload", async () => {
  const image = new Blob(["previous picture"]);
  store.saved.set(paneId, savedPicture({ image, revision: contentRevision }));
  await mount();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.displayedPictureFor(paneId)).toBeNull();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);

  expect(snapshot).toHaveBeenCalledOnce();
  const replacement = store.writes[0]!;
  expect(replacement.image).not.toBe(image);
  expect(hook.pictureFor(paneId)?.image).toBe(replacement.image);
  await act(() => renderer!.unmount());
  store.saved.set(paneId, replacement);
  await mount();
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(pictureImageFor(paneId)).toBe(replacement.image);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
});

it("replaces pictures drawn under the old raster cap with full-density pixels", async () => {
  store.saved.set(
    paneId,
    savedPicture({
      revision: `${contentRevision}|responsive-css-4`,
      image: new Blob(["capped raster"]),
    }),
  );
  await mount();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("preserves an already idle pane before its view is released", async () => {
  await mount();
  await advance(5000);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(1000);
  markPaneSynced(paneId, null);
  Object.defineProperty(element, "isConnected", { value: false });
  await advance(3000);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it.each(["pointerup", "pointercancel", "lostpointercapture", "blur"])(
  "waits for a held resize to end with %s, then saves only its final geometry",
  async (end) => {
    store.threadIds = ["t1", "t2"];
    currentLayout = layout(400);
    const old = new Blob(["old size"]);
    store.saved.set(paneId, savedPicture({ image: old }));
    store.saved.set("thread:e:t2", savedPicture({ paneId: "thread:e:t2" }));
    await mount();
    for (const id of [paneId, "thread:e:t2"])
      markPaneSynced(id, { updatedAt: store.updatedAt, theme: appearance });
    window.dispatchEvent(new MouseEvent("pointerdown"));
    stage.dispatchEvent(new FocusEvent("blur"));
    for (const width of [450, 500]) {
      const resized = structuredClone(currentLayout);
      resized.columns[0]!.widthSpec = { unit: "px", value: width };
      await act(() => publishLayout(resized));
      hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
      hook.paneSnapshots.request("thread:e:t2", { isConnected: true } as HTMLElement);
      await advance(4000);
      expect(snapshot).not.toHaveBeenCalled();
      expect(hook.pictureFor(paneId)?.image).toBeUndefined();
    }
    window.dispatchEvent(new Event(end));
    await advance(249);
    expect(snapshot).not.toHaveBeenCalled();
    await advance(10);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(store.writes).toHaveLength(1);
    expect(store.writes[0]).toMatchObject({ paneId, geometryRevision: geometry(500) });
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(hook.hasFreshPicture("thread:e:t2")).toBe(true);
  },
);

it("lets a newly opened workspace settle even when the page has been open a while", async () => {
  await vi.advanceTimersByTimeAsync(5000);
  window.dispatchEvent(new Event("pointerdown"));
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(249);
  expect(snapshot).not.toHaveBeenCalled();
  await advance(2);
  expect(store.writes).toHaveLength(1);
});

it("captures first pixels between ordinary navigation inputs, once motion has stayed stopped", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.setCaptureActivity(true, true);
  window.dispatchEvent(new Event("keydown"));
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(550);
  expect(snapshot).not.toHaveBeenCalled();
  hook.setCaptureActivity(true, false);
  await advance(20);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  window.dispatchEvent(new Event("keydown"));
  expect(store.writes).toHaveLength(1);
});

it("refreshes a covered background pane after resize with limited idle headroom", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const old = new Blob(["old pixels"]);
  await act(() => drawPicture(pane, old, { width: 400, height: 580 }));
  backgroundPanes.add(paneId);
  await act(() => publishLayout(layout(500)));
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
  );
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(5000);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)?.image).not.toBe(old);
  expect(store.writes.at(-1)?.geometryRevision).toBe(geometry(500));
});

it.each(["longtask", "long-animation-frame"])(
  "fills visible missing pictures before neighbours and refreshes despite %s pressure",
  async (type) => {
    const busy = simulatePicturePressure();
    store.threadIds = ["t1", "t2", "t3"];
    currentLayout = layout(400);
    store.saved.set(paneId, savedPicture());
    await mount();
    const visible = "thread:e:t2",
      neighbour = "thread:e:t3";
    backgroundPanes.add(neighbour);
    hook.paneSnapshots.invalidate(paneId, true);
    const drawn: string[] = [];
    snapshot.mockImplementation(async (element, canSnapshot) => {
      if (!canSnapshot()) return null;
      drawn.push(element.id);
      return { image: new Blob([element.id]), cssSize: { width: 400, height: 580 } };
    });
    for (const id of [paneId, neighbour, visible]) {
      const revision = hook.paneSnapshots.request(id, { id, isConnected: true } as HTMLElement);
      markPaneSynced(id, { updatedAt: store.updatedAt, theme: appearance }, revision);
    }
    busy(type);
    await advance(240);
    expect(drawn).toEqual([]);
    await advance(30);
    expect(drawn).toEqual([visible, paneId, neighbour]);
    for (const id of [paneId, neighbour, visible]) expect(hook.hasFreshPicture(id)).toBe(true);
  },
);

it("releases an abandoned drawing even when idle headroom is exhausted", async () => {
  await mount();
  const lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  backgroundLifecycle = lifecycle;
  let available = 50;
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => available }), 1),
  );
  const admissions: boolean[] = [];
  snapshot.mockImplementationOnce(async (_element, _canSnapshot, waitToDraw) => {
    available = 0;
    const admitted = await waitToDraw!();
    admissions.push(admitted);
    return null;
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(admissions).toEqual([]);
  lifecycle.setPanes([]);
  await advance(10);
  expect(admissions).toEqual([false]);
  expect(snapshotFailures).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});

it.each([false, true])(
  "captures promptly after uncover with previous pixels: %s",
  async (covered) => {
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    if (covered) await act(() => drawPicture(pane, new Blob(["previous"])));
    await advance(5000);
    hook.setCaptureActivity(true, true);
    hook.paneSnapshots.invalidate(paneId, true);
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true }));
    await advance(100);
    expect(snapshot).not.toHaveBeenCalled();
    hook.setCaptureActivity(true, false);
    await advance(10);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(hook.hasFreshPicture(paneId)).toBe(true);
  },
);

it("refreshes a usable cover between navigation inputs with 250 ms quiet", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const cover = new Blob(["cover"]);
  await act(() => drawPicture(pane, cover));
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  for (let step = 0; step < 5; step++) {
    window.dispatchEvent(new Event("keydown"));
    await advance(900);
  }
  expect(snapshot).toHaveBeenCalledOnce();
  expect(pictureImageFor(paneId)).not.toBe(cover);
  expect(presentationAt("rest", false)).toEqual({ kind: "placeholder" });
  await advance(3000);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(pictureImageFor(paneId)).not.toBe(cover);
  expect(presentationAt("rest", false)).toEqual({ kind: "placeholder" });
  expect(presentationAt("rest")).toBe("dom");
});

it("requeues a first picture interrupted by camera motion before cloning", async () => {
  const layout = pendingPicture();
  snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
    await layout.promise;
    return canSnapshot()
      ? { image: new Blob(["interrupted"]), cssSize: { width: 400, height: 580 } }
      : null;
  });
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(500);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.setCaptureActivity(true, true);
  await act(() => layout.resolve(null));
  await advance(5000);
  expect(store.writes).toHaveLength(0);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.setCaptureActivity(true, false);
  await advance(20);
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("does not draw pending pictures after the workspace unmounts", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(() => renderer!.unmount());
  renderer = undefined;
  await vi.advanceTimersByTimeAsync(3000);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});

it("reuses a matching snapshot until a departed pane needs its scroll position refreshed", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, element);
  markPaneSynced(
    paneId,
    { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` },
    revision,
  );
  await advance(3500);
  expect(snapshot).toHaveBeenCalledTimes(2);
});

it.each(["keydown", "pointerdown", "wheel"])(
  "postpones a picture when %s arrives before cloning, then retries after quiet input",
  async (type) => {
    const layout = pendingPicture();
    snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
      await layout.promise;
      return canSnapshot()
        ? { image: new Blob(["interrupted picture"]), cssSize: { width: 400, height: 580 } }
        : null;
    });
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(3500);
    window.dispatchEvent(new Event(type));
    await act(async () => layout.resolve(null));
    expect(store.writes).toHaveLength(0);

    await advance(250);
    window.dispatchEvent(new Event(type));
    if (type === "pointerdown") window.dispatchEvent(new Event("pointerup"));
    await advance(249);
    expect(snapshot).toHaveBeenCalledOnce();
    await advance(2);
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(store.writes).toHaveLength(1);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
  },
);

it("retries an interrupted refresh with the latest pane element", async () => {
  const old = new Blob(["previous scroll position"]);
  store.saved.set(
    paneId,
    savedPicture({
      revision: `${contentRevision}|native-worker-9`,
      image: old,
    }),
  );
  const layout = pendingPicture();
  snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
    await layout.promise;
    return canSnapshot()
      ? { image: new Blob(["interrupted picture"]), cssSize: { width: 400, height: 580 } }
      : null;
  });
  await mount();
  expect(pictureImageFor(paneId)).toBe(old);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(
    paneId,
    { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` },
    revision,
  );
  await advance(3500);
  window.dispatchEvent(new Event("wheel"));
  const replacement = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, replacement);
  await act(async () => layout.resolve(null));
  expect(store.writes).toHaveLength(0);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(snapshot.mock.calls[1]?.[0]).toBe(replacement);
  expect(store.writes).toHaveLength(1);
  expect(pictureImageFor(paneId)).not.toBe(old);
});

it("rejects a picture that finishes encoding after input and pane eviction", async () => {
  const encoding = pendingPicture();
  snapshot.mockReturnValueOnce(encoding.promise);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(snapshot.mock.calls[0]![1]()).toBe(true);

  window.dispatchEvent(new Event("keydown"));
  markPaneSynced(paneId, null);
  Object.defineProperty(element, "isConnected", { value: false });
  const image = new Blob(["completed after eviction"]);
  await act(async () => {
    encoding.resolve(image);
  });
  expect(store.writes).toHaveLength(0);
  expect(pictureImageFor(paneId)).not.toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
});

it.each(["content", "theme", "fonts", "stage", "column", "running"] as const)(
  "rejects a pending picture when its %s changes",
  async (change) => {
    const encoding = pendingPicture();
    snapshot.mockReturnValueOnce(encoding.promise);
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(3500);
    expect(snapshot).toHaveBeenCalledOnce();
    await act(() => {
      if (change === "content") store.updatedAt = "u2";
      if (change === "theme") store.theme = "ocean";
      if (change === "fonts") store.fontSettings.fontSmoothing = false;
      if (change === "running") store.runtimeStatus = "running";
      if (change === "stage") resize(900, 600);
      if (change === "column") publishLayout(layout(500));
      renderer!.update(<Probe />);
    });
    expect(snapshot.mock.calls[0]![1]()).toBe(false);
    await act(async () => {
      encoding.resolve(new Blob(["obsolete picture"]));
    });
    expect(store.writes).toHaveLength(0);
    expect(hook.hasFreshPicture(paneId)).toBe(false);
  },
);

it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
  "retains a %s runtime and waits for completion before drawing its picture",
  async (status) => {
    store.runtimeStatus = status;
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    const element = { isConnected: true } as HTMLElement;
    hook.paneSnapshots.request(paneId, element);
    await advance(3500);
    expect(snapshot).not.toHaveBeenCalled();
    expect(hook.canBackgroundPicture(paneId)).toBe(false);
    expect(hook.runningPanes).toEqual(new Set([paneId]));
    store.runtimeStatus = null;
    store.updatedAt = "u2";
    await act(() => renderer!.update(<Probe />));
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    hook.paneSnapshots.request(paneId, element);
    await advance(3500);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(hook.canBackgroundPicture(paneId)).toBe(true);
    expect(hook.runningPanes.size).toBe(0);
  },
);

it("warms only pictures valid for current panes and releases their URLs on unmount", async () => {
  const valid = new Blob(["valid"]);
  store.saved.set(paneId, savedPicture({ image: valid }));
  store.saved.set(
    "absent-pane",
    savedPicture({ paneId: "absent-pane", image: new Blob(["absent"]) }),
  );
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, valid));
  await advance(5);
  const url = hook.preparedPictureUrl(valid);
  expect(url).toBe("blob:picture-1");
  expect(decodedUrls).toEqual([url]);
  expect(hook.pictureUrl(valid)).toBe(url);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(revokedUrls).toEqual([url]);
});

it("does not display or decode a stored picture from another geometry", async () => {
  const stale = new Blob(["old geometry"]);
  store.saved.set(paneId, savedPicture({ geometryRevision: geometry(600), image: stale }));
  await mount();
  await advance(5);
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.displayedPictureFor(paneId)).toBeNull();
  expect(hook.preparedPictureUrl(stale)).toBeNull();
  expect(decodedUrls).toEqual([]);
});

it("displays a stale stored picture until a fresh capture replaces it", async () => {
  const stale = new Blob(["earlier content"]);
  store.saved.set(
    paneId,
    savedPicture({
      revision: `u0|dark|dark|${fontRevision}|chat-chrome-2|native-worker-9`,
      image: stale,
    }),
  );
  await mount();
  await advance(5);
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.displayedPictureFor(paneId)?.image).toBe(stale);
  const staleUrl = hook.preparedPictureUrl(stale);
  expect(staleUrl).not.toBeNull();

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  const fresh = store.writes.at(-1)!.image;
  expect(fresh).not.toBe(stale);
  expect(hook.pictureFor(paneId)?.image).toBe(fresh);
  expect(hook.displayedPictureFor(paneId)?.image).toBe(fresh);
  expect(revokedUrls).toContain(staleUrl);
});

it("captures a pane requested on screen once a move leaves it off screen", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const element = document.createElement("div");
  document.body.append(element);
  let left = 0;
  element.getBoundingClientRect = () => new DOMRect(left, 0, 400, 580);
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  expect(snapshot).not.toHaveBeenCalled();
  expect(hook.hasFreshPicture(paneId)).toBe(false);

  left = element.ownerDocument.defaultView!.innerWidth + 100;
  act(() => {
    hook.setCaptureActivity(true, true);
    hook.setCaptureActivity(true, false);
  });
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  element.remove();
});

it.each([
  { fontFamilySans: "serif" },
  { fontFamilyCode: "monospace" },
  { fontFamilyComposer: "Arial" },
  { fontSizeInterface: 18 },
  { fontSizePrompt: 18 },
  { fontSizeCode: 16 },
  { fontSmoothing: false },
])("refreshes pictures after font preferences change: %j", async (change) => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const previous = new Blob(["previous font setting"]);
  await act(() => drawPicture(pane, previous));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(pictureImageFor(paneId)).toBe(previous);

  store.fontSettings = { ...store.fontSettings, ...change };
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(pictureImageFor(paneId)).toBeNull();
  await act(() => drawPicture(pane, new Blob(["old font setting"])));
  expect(store.writes).toHaveLength(1);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const current = new Blob(["new font setting"]);
  await act(() => drawPicture(pane, current));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(pictureImageFor(paneId)).toBe(current);
});

it("keeps a picture current when an unrelated setting changes", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const previous = new Blob(["same appearance"]);
  await act(() => drawPicture(pane, previous));
  store.fontSettings.panelAnimationDurationMs = 500;
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)).toMatchObject({
    image: previous,
    cssSize: { width: 400, height: 580 },
  });
  expect(store.writes).toHaveLength(1);
});

it("excludes a previous picture after local scrolling until committed pixels arrive", async () => {
  const old = new Blob(["previous scroll position"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, old));
  store.writes.length = 0;
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(pictureImageFor(paneId)).toBeNull();
  await advance(3500);
  expect(store.writes).toHaveLength(0);
  markPaneSynced(paneId, content, revision);
  await advance(10_000);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes.at(-1)?.revision).toMatch(/\|native-worker-9$/);
  expect(pictureImageFor(paneId)).not.toBe(old);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("refreshes resized content after active DOM changes without another request", async () => {
  const old = new Blob(["old geometry"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, old));
  store.writes.length = 0;
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => {
    currentLayout = layout(500);
    publishLayout(currentLayout);
  });
  const image = new Blob(["resized and scrolled"]);
  snapshot.mockResolvedValue({ image, cssSize: { width: 500, height: 580 } });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  hook.paneSnapshots.invalidate(paneId, true);
  hook.paneSnapshots.invalidate(paneId, true);
  expect(pictureImageFor(paneId)).toBeNull();
  await advance(3500);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toMatchObject({
    image,
    geometryRevision: geometry(500),
    cssSize: { width: 500, height: 580 },
  });
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("marks active DOM changes stale without scheduling new pictures", async () => {
  const old = new Blob(["old content"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, old));
  store.writes.length = 0;
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.invalidate(paneId, true);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(pictureImageFor(paneId)).toBeNull();
  await advance(65_000);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});

it("does not acknowledge an outstanding content transition through an active DOM change", async () => {
  store.saved.set(paneId, savedPicture());
  await mount();
  const content = { updatedAt: store.updatedAt, theme: appearance };
  markPaneSynced(paneId, content);
  hook.paneSnapshots.invalidate(paneId);
  hook.paneSnapshots.invalidate(paneId, true);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(store.writes).toHaveLength(0);
  markPaneSynced(paneId, content, revision);
  await advance(10_000);
  expect(store.writes).toHaveLength(1);
});

it("retries an encoding invalidated by active DOM changes without another request", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  hook.paneSnapshots.invalidate(paneId, true);
  await act(async () => pending.resolve(new Blob(["old encoding"])));
  expect(store.writes).toHaveLength(0);
  await advance(3500);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("rejects an encoding made stale by another local visual change", async () => {
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await advance(3500);
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, element);
  markPaneSynced(paneId, content, revision);
  await act(async () => pending.resolve(new Blob(["old encoding"])));
  expect(store.writes).toHaveLength(0);
  await advance(3500);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("retains an unpublished refresh across content release and an ordinary remount request", async () => {
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const original = new Blob(["original capture"]);
  await act(() => drawPicture(pane, original));
  hook.paneSnapshots.invalidate(paneId);
  markPaneSynced(paneId, null);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, content, revision);
  await advance(10_000);
  expect(snapshot).toHaveBeenCalledOnce();
  expect(pictureImageFor(paneId)).not.toBe(original);
});

it.each([
  ["threads", "stage"],
  ["stage", "threads"],
])("accepts stored pixels only once both the %s and the %s arrive", async (first, second) => {
  const image = new Blob(["stored"]);
  store.saved.set(paneId, savedPicture({ image }));
  store.threadIds = [];
  await mount({ resizeStage: false });
  expect(hook.picturesLoaded).toBe(true);
  expect(shownPicture).toBeNull();
  const arrive = (prerequisite: string) =>
    act(() => {
      if (prerequisite === "stage") resize(800, 600);
      else {
        store.threadIds = ["t1"];
        renderer!.update(<Probe />);
      }
    });
  await arrive(first);
  expect(shownPicture).toBeNull();
  await arrive(second);
  expect(pictureImageFor(paneId)).toBe(image);
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(0);
});

it("keeps pictures per colour theme so a theme switch never shows the other theme's picture", async () => {
  const image = new Blob(["light"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, image));
  await advance(10);
  expect(shownPicture).toBe(image);
  try {
    await act(() => document.documentElement.classList.add("dark"));
    await advance(10);
    expect(shownPicture).toBeNull();
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    await act(() => document.documentElement.classList.remove("dark"));
    await advance(10);
    expect(shownPicture).toBe(image);
  } finally {
    document.documentElement.classList.remove("dark");
  }
});

it("keeps a picture for each stage size and selects the stored one on return without redrawing", async () => {
  const image = new Blob(["stored"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, image));
  store.writes.length = 0;
  await advance(10);
  expect(shownPicture).toBe(image);
  const url = hook.preparedPictureUrl(image);
  expect(url).not.toBeNull();
  await act(() => resize(900, 600));
  expect(shownPicture).toBeNull();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  const wide = store.writes.at(-1)!;
  expect(wide.geometryRevision).toContain("stage:900x600");
  expect(shownPicture).toBe(wide.image);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  await act(() => resize(800, 600));
  expect(shownPicture).toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.preparedPictureUrl(wide.image)).toBeNull();
  await advance(10);
  expect(hook.preparedPictureUrl(image)).not.toBe(url);
  expect(hook.preparedPictureUrl(image)).not.toBeNull();
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(5000);
  expect(store.writes).toHaveLength(1);
  await act(() => resize(900, 600));
  expect(shownPicture).toBe(wide.image);
  const replacement = new Blob(["replacement"]);
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  await act(() => drawPicture(pane, replacement));
  expect(shownPicture).toBe(replacement);
  expect(store.writes).toHaveLength(2);
});

const setCompact = (compact: boolean) =>
  act(async () => {
    stage.parentElement!.dataset.compactLayout = String(compact);
  });

it("uses fullscreen pixels loaded after a pending request without recapturing them", async () => {
  let loaded!: (pictures: Map<string, SavedPanePicture>) => void;
  store.loading = new Promise((resolve) => {
    loaded = resolve;
  });
  await mount({ compact: true });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => {
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  });
  const picture = savedPicture({
    geometryRevision: geometry(400).replace(/\|tiled$/, "|compact"),
    cssSize: { width: 800, height: 600 },
  });
  await act(() => loaded(new Map([[picture.recordKey, picture]])));
  expect(shownPicture).toBe(picture.image);
  await advance(3500);
  expect(snapshot).not.toHaveBeenCalled();
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("preserves tiled pictures while the first fullscreen picture is pending", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const tiled = new Blob(["tiled"]);
  await act(() => drawPicture(pane, tiled));
  await setCompact(true);
  await act(() => {
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  });
  expect(shownPicture).toBeNull();
  await setCompact(false);
  expect(shownPicture).toBe(tiled);
  await setCompact(true);
  const fullscreen = new Blob(["fullscreen"]);
  await act(() => drawPicture(pane, fullscreen, { width: 800, height: 600 }));
  expect(shownPicture).toBe(fullscreen);
  await setCompact(false);
  expect(shownPicture).toBe(tiled);
  expect(store.writes).toHaveLength(2);
});

it("allows eviction behind a usable picture while newer content needs capturing", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["usable cover"]);
  await act(() => drawPicture(pane, image));
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => {
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  });
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(shownPicture).toBe(image);
});

it("keeps a pane's tiled and compact pictures apart through a layout round trip", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const tiled = new Blob(["tiled"]);
  await act(() => drawPicture(pane, tiled));
  expect(shownPicture).toBe(tiled);

  await setCompact(true);
  expect(shownPicture).toBeNull();
  expect(hook.pictureFor(paneId)).toBeNull();
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  const compact = store.writes.at(-1)!.image;
  expect(compact).not.toBe(tiled);
  expect(shownPicture).toBe(compact);

  await setCompact(false);
  expect(shownPicture).toBe(tiled);
  expect(store.writes.map((picture) => picture.geometryRevision.split("|").at(-1))).toEqual([
    "tiled",
    "compact",
  ]);

  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  await setCompact(true);
  expect(shownPicture).toBeNull();
  expect(hook.displayedPictureFor(paneId)?.image).toBe(compact);
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(store.writes).toHaveLength(2);
});

it("keeps pictures from before a live producer stale when their load finishes later", async () => {
  let loaded!: (value: Map<string, SavedPanePicture>) => void;
  store.loading = new Promise((resolve) => {
    loaded = resolve;
  });
  await mount();
  let revision = 0;
  await act(() => {
    revision = hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  await act(() => {
    revision = hook.paneSnapshots.setLiveProducer(paneId, false);
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  const replacement = new Blob(["replacement"]);
  await act(() => drawPicture(pane, replacement));
  const compact = savedPicture({ geometryRevision: geometry(400).replace(/\|tiled$/, "|compact") });
  await act(async () =>
    loaded(
      new Map([
        [paneId, savedPicture()],
        [compact.recordKey, compact],
      ]),
    ),
  );
  expect(shownPicture).toBe(replacement);
  await setCompact(true);
  expect(shownPicture).toBeNull();
});

it("presents stored compact pixels without recapturing them", async () => {
  const image = new Blob(["compact"]);
  store.saved.set(
    paneId,
    savedPicture({ image, geometryRevision: geometry(400).replace(/\|tiled$/, "|compact") }),
  );
  await mount({ compact: true });
  expect(shownPicture).toBe(image);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, new Blob(["restored compact view"])));
  expect(store.writes).toHaveLength(0);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  await setCompact(false);
  expect(shownPicture).toBeNull();
});

it.each([false, true])(
  "keeps a usable picture through navigation in compact=%s",
  async (compact) => {
    const picture = savedPicture({
      geometryRevision: compact ? geometry(400).replace(/\|tiled$/, "|compact") : geometry(400),
    });
    store.saved.set(paneId, picture);
    await mount({ compact });
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(presentationAt("rest")).toBe("dom");
    for (const phase of ["motion", "overview", "overview-motion"] as const) {
      expect(presentationAt(phase)).toEqual({ kind: "placeholder" });
      expect(pictureImageFor(paneId)).toBe(picture.image);
    }
    expect(presentationAt("resize")).toBe("dom");
    expect(presentationAt("rest")).toBe("dom");
    await setCompact(!compact);
    expect(presentationAt("motion")).toBe("dom");
    await setCompact(compact);
    expect(presentationAt("motion")).toEqual({ kind: "placeholder" });
  },
);

it("shows the latest picture of changed mounted content in motion, flushing pending mutations", async () => {
  await mount();
  expect(presentationAt("motion")).toBe("dom");
  expect(presentationAt("rest", true, false)).toBe("dom");
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, new Blob(["first picture"])));
  expect(presentationAt("motion")).toEqual({ kind: "placeholder" });
  let flushed = false;
  const stop = observePaneVisualChanges(paneId, () => {
    flushed = true;
    hook.paneSnapshots.invalidate(paneId, true);
  });
  await act(() => expect(presentationAt("motion")).toEqual({ kind: "placeholder" }));
  expect(flushed).toBe(true);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  stop();
  expect(presentationAt("rest")).toBe("dom");
  expect(presentationAt("resize", true, false)).toBe("dom");
});

it("does not display a picture saved without its layout mode", async () => {
  store.saved.set(
    paneId,
    savedPicture({ geometryRevision: geometry(400).replace(/\|tiled$/, "") }),
  );
  await mount();
  expect(shownPicture).toBeNull();
});

it("merges pictures loaded from storage with captures already accepted this session", async () => {
  let loaded!: (value: Map<string, SavedPanePicture>) => void;
  store.loading = new Promise((resolve) => {
    loaded = resolve;
  });
  store.threadIds = ["t1", "t2"];
  currentLayout = layout(400);
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const captured = new Blob(["new capture"]);
  await act(() => drawPicture(pane, captured));
  const previous = new Blob(["previous session"]);
  const secondId = "thread:e:t2";
  const record = savedPicture({ image: previous });
  await act(async () =>
    loaded(
      new Map([
        [paneId, record],
        [secondId, savedPicture({ image: previous, paneId: secondId })],
      ]),
    ),
  );
  expect(pictureImageFor(paneId)).toBe(captured);
  expect(pictureImageFor(secondId)).toBe(previous);
  expect(hook.picturesLoaded).toBe(true);
});

it("keeps showing pixels from before a live producer until a valid snapshot replaces them", async () => {
  await mount();
  const old = new Blob(["static before embedded content"]);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, old));
  expect(pictureImageFor(paneId)).toBe(old);
  let revision = 0;
  await act(() => {
    revision = hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
  expect(hook.canBackgroundPicture(paneId, true)).toBe(false);
  expect(hook.displayedPictureFor(paneId)?.image).toBe(old);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  await act(() => drawPicture(pane, new Blob(["empty guest slot"])));
  expect(store.writes).toHaveLength(1);

  await act(() => {
    revision = hook.paneSnapshots.setLiveProducer(paneId, false);
  });
  expect(hook.canBackgroundPicture(paneId)).toBe(true);
  expect(pictureImageFor(paneId)).toBeNull();
  expect(hook.displayedPictureFor(paneId)?.image).toBe(old);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  await act(async () => {
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(pictureImageFor(paneId)).toBe(store.writes.at(-1)!.image);
  expect(pictureImageFor(paneId)).not.toBe(old);
});

it("rejects an encoding across producer appearance and removal", async () => {
  await mount();
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(snapshot).toHaveBeenCalledOnce();
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
    hook.paneSnapshots.setLiveProducer(paneId, false);
    pending.resolve(new Blob(["old static pixels"]));
  });
  expect(store.writes).toHaveLength(0);
  expect(pictureImageFor(paneId)).toBeNull();
});

it.each(["null", "error", "resize"])(
  "recovers a static pane after a %s capture failure without more input",
  async (failure) => {
    await mount();
    let revision = 0;
    await act(() => {
      hook.paneSnapshots.setLiveProducer(paneId, true);
      revision = hook.paneSnapshots.setLiveProducer(paneId, false);
    });
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
    snapshot.mockImplementationOnce(async () => {
      if (failure === "error") throw new Error("Image encoding failed");
      if (failure === "null") return null;
      resize(900, 600);
      return { image: new Blob(["old geometry"]), cssSize: { width: 400, height: 580 } };
    });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(500);
    expect(pictureImageFor(paneId)).toBeNull();
    await advance(3500);
    expect(pictureImageFor(paneId)).toBe(store.writes.at(-1)!.image);
  },
);

it("backs off failed replacements and stops retrying when the producer returns", async () => {
  store.threadIds = ["t1", "t2"];
  currentLayout = layout(400);
  await mount();
  let revision = 0;
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
    revision = hook.paneSnapshots.setLiveProducer(paneId, false);
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  const element = { isConnected: true } as HTMLElement;
  snapshot.mockImplementation(async (candidate, canSnapshot) =>
    candidate !== element && canSnapshot()
      ? { image: new Blob(["other pane"]), cssSize: { width: 400, height: 580 } }
      : null,
  );
  hook.paneSnapshots.request(paneId, element);
  await advance(60_000);
  expect(snapshot.mock.calls.length).toBeLessThanOrEqual(5);
  expect(snapshot.mock.calls.length).toBeGreaterThan(1);
  const other = "thread:e:t2";
  markPaneSynced(other, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(other, { isConnected: true } as HTMLElement);
  await advance(300);
  expect(hook.hasFreshPicture(other)).toBe(true);
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  const attempts = snapshot.mock.calls.length;
  await advance(10 * 60_000);
  expect(snapshot.mock.calls.length).toBe(attempts);
  expect(pictureImageFor(paneId)).toBeNull();
});

it.each(["disconnect", "remove", "unmount", "release-content"])(
  "stops replacement retries after %s",
  async (ending) => {
    await mount();
    let revision = 0;
    await act(() => {
      hook.paneSnapshots.setLiveProducer(paneId, true);
      revision = hook.paneSnapshots.setLiveProducer(paneId, false);
    });
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
    snapshot.mockResolvedValue(null);
    const element = { isConnected: true };
    hook.paneSnapshots.request(paneId, element as HTMLElement);
    await advance(500);
    expect(snapshot).toHaveBeenCalledOnce();
    await act(() => {
      if (ending === "disconnect") element.isConnected = false;
      else if (ending === "release-content") markPaneSynced(paneId, null);
      else if (ending === "remove") {
        store.threadIds = [];
        renderer!.update(<Probe />);
      } else {
        renderer!.unmount();
        renderer = undefined;
      }
    });
    await advance(10 * 60_000);
    expect(snapshot).toHaveBeenCalledOnce();
    expect(store.writes).toHaveLength(0);
  },
);

it("does not resurrect stored pixels after a producer appears and disappears during loading", async () => {
  let loaded!: (pictures: Map<string, SavedPanePicture>) => void;
  store.loading = new Promise((resolve) => {
    loaded = resolve;
  });
  await mount();
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
    hook.paneSnapshots.setLiveProducer(paneId, false);
  });
  await act(() =>
    loaded(new Map([[paneId, savedPicture({ image: new Blob(["incomplete stored picture"]) })]])),
  );
  expect(hook.picturesLoaded).toBe(true);
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(pictureImageFor(paneId)).toBeNull();
});

it("forgets unsupported producers when their panes leave the workspace", async () => {
  await mount();
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  await act(() => publishLayout({ columns: [], panes: [] } as unknown as OnirigiriLayout));
  expect(pictureImageFor(paneId)).toBeNull();
});

it("keeps picture CSS bounds through resize and persists replacement bounds", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["large arbitrary pane"]);
  const cssSize = { width: 713.5, height: 1452.25 };
  await act(() => drawPicture(pane, image, cssSize));
  expect(store.writes[0]?.cssSize).toEqual(cssSize);
  expect(hook.pictureFor(paneId)).toMatchObject({ image, cssSize });
  await act(() => resize(650, 410));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  await act(() => resize(1850, 1400));
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();

  const replacement = new Blob(["smaller replacement"]);
  const replacementSize = { width: 382.75, height: 209.5 };
  await act(() => drawPicture(pane, replacement, replacementSize));
  expect(hook.pictureFor(paneId)).toMatchObject({ image: replacement, cssSize: replacementSize });
  expect(store.writes[1]?.cssSize).toEqual(replacementSize);
});

it.each(["height", "weight", "sibling", "defaults"])(
  "refreshes a picture after 2D %s sizing changes without changing column width",
  async (change) => {
    store.threadIds = ["t1", "t2"];
    currentLayout = layout(400);
    currentLayout.columns[0]!.cells.push(currentLayout.columns[1]!.cells[0]!);
    currentLayout.columns.pop();
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const image = new Blob(["old height"]);
    await act(() => drawPicture(pane, image, { width: 400, height: 290 }));
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    const resized = structuredClone(currentLayout);
    if (change === "height") resized.columns[0]!.cells[0]!.heightPx = 181.5;
    else if (change === "weight") resized.columns[0]!.cells[1]!.weight = 3;
    else if (change === "sibling") resized.columns[0]!.cells.pop();
    else resized.panes[1]!.defaults = { height: 170 };
    await act(() => publishLayout(resized));
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    expect(hook.pictureFor(paneId)?.image).toBeUndefined();
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(3500);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(hook.pictureFor(paneId)?.image).not.toBe(image);
  },
);

it("refreshes pictures when the default row height changes and validates it after reload", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["viewport height"]);
  await act(() => drawPicture(pane, image));
  const version = hook.paneSnapshots.geometryVersion;
  await act(() => {
    appliedDefaults = { paneDefaults: { height: 420 } };
    publishLayout(currentLayout);
  });
  expect(hook.paneSnapshots.geometryVersion).toBe(version + 1);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  const replacement = hook.pictureFor(paneId)!;
  expect(replacement.image).not.toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  store.saved.set(paneId, store.writes.at(-1)!);
  await act(() => renderer!.unmount());
  await mount();
  expect(hook.pictureFor(paneId)?.image).toBe(replacement.image);
  await act(() => renderer!.unmount());
  appliedDefaults = { paneDefaults: { height: 600 } };
  await mount();
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(hook.hasFreshPicture(paneId)).toBe(false);
});

it.each(["height", "maxHeight"] as const)(
  "discards a snapshot completed after applied %s changes",
  async (dimension) => {
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const pending = pendingPicture();
    snapshot.mockReturnValueOnce(pending.promise);
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(500);
    expect(snapshot).toHaveBeenCalledTimes(1);
    await act(() => {
      appliedDefaults = { paneDefaults: { [dimension]: 420 } };
      publishLayout(currentLayout);
    });
    await act(async () => pending.resolve(new Blob(["old row height"])));
    expect(store.writes).toHaveLength(0);
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    await advance(3500);
    expect(store.writes).toHaveLength(1);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
  },
);

it("refreshes and re-arms picture preparation when only display density changes", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["first monitor"]);
  const cssSize = { width: 400, height: 580 };
  await act(() => drawPicture(pane, image, cssSize));
  const version = hook.paneSnapshots.geometryVersion;
  const firstQuery = resolutionQueries.at(-1)!;
  expect(firstQuery.media).toBe("(resolution: 1dppx)");
  await act(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    firstQuery.dispatchEvent(new Event("change"));
  });
  expect(hook.paneSnapshots.geometryVersion).toBe(version + 1);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)?.image).toBeUndefined();
  expect(resolutionQueries.at(-1)?.media).toBe("(resolution: 2dppx)");
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)?.image).not.toBe(image);
  expect(store.writes.at(-1)?.cssSize).toEqual(cssSize);
  const secondQuery = resolutionQueries.at(-1)!;
  await act(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 1.5, configurable: true });
    secondQuery.dispatchEvent(new Event("change"));
  });
  expect(hook.paneSnapshots.geometryVersion).toBe(version + 2);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(resolutionQueries.at(-1)?.media).toBe("(resolution: 1.5dppx)");
  const queries = resolutionQueries.length;
  await act(() => {
    firstQuery.dispatchEvent(new Event("change"));
  });
  expect(resolutionQueries).toHaveLength(queries);
  const lastQuery = resolutionQueries.at(-1)!;
  await act(() => hook.stageRef(null));
  await act(() => {
    lastQuery.dispatchEvent(new Event("change"));
  });
  expect(resolutionQueries).toHaveLength(queries);
});

it("does not persist a snapshot completed after leaving its display density", async () => {
  const image = new Blob(["before changing monitors"]);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  await act(() => drawPicture(pane, image));
  store.writes.length = 0;
  const content = { updatedAt: store.updatedAt, theme: appearance };
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, content, revision);
  const pending = pendingPicture();
  snapshot.mockReturnValueOnce(pending.promise);
  await advance(3500);
  await act(() => {
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    resolutionQueries.at(-1)!.dispatchEvent(new Event("change"));
  });
  await act(() => pending.resolve(new Blob(["old in-flight density"])));
  expect(store.writes).toHaveLength(0);
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(pictureImageFor(paneId)).toBeNull();
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(pictureImageFor(paneId)).not.toBe(image);
});

it.each(["longtask", "long-animation-frame"])(
  "finishes an admitted background picture after its own %s work without restarting the quiet wait",
  async (type) => {
    const busy = simulatePicturePressure();
    backgroundPanes.add(paneId);
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    snapshot.mockImplementationOnce(async (_element, canSnapshot, waitToDraw) => {
      busy(type);
      if (!canSnapshot() || !(await waitToDraw!()) || !canSnapshot()) return null;
      return { image: new Blob(["snapshot"]), cssSize: { width: 400, height: 580 } };
    });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(3100);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(store.writes).toHaveLength(1);
    expect(snapshot).toHaveBeenCalledOnce();
  },
);

it("recaptures committed visible changes without a fixed quiet embargo", async () => {
  await mount();
  const element = { isConnected: true } as HTMLElement;
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, element);
  await advance(260);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.paneSnapshots.invalidate(paneId, true);
  hook.paneSnapshots.request(paneId, element);
  await advance(150);
  hook.paneSnapshots.invalidate(paneId, true);
  hook.paneSnapshots.request(paneId, element);
  await advance(10);
  expect(snapshot).toHaveBeenCalledTimes(3);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it.each(["overview", "overview-motion"] as const)(
  "keeps a latched or unpictured chat on its card during %s",
  async (phase) => {
    await mount();
    expect(presentationAt("motion")).toBe("dom");
    expect(presentationAt(phase)).toEqual({ kind: "placeholder" });
    motionDecision = "in-progress-turn";
    expect(presentationAt(phase)).toEqual({ kind: "placeholder" });
    expect(presentationAt("rest")).toBe("dom");
  },
);

it.each(["motion", "resize"] as const)(
  "honors the latched removal decision during %s, then returns live at rest",
  async (phase) => {
    await mount();
    motionDecision = "local-ui-interaction";
    expect(presentationAt(phase)).toBe("dom");
    motionDecision = null;
    expect(presentationAt(phase)).toEqual({ kind: "placeholder" });
    expect(presentationAt("rest")).toBe("dom");
    expect(
      hook.getPanePresentation(
        { ...threadPane, surfaceKind: "terminal" },
        {
          phase,
          focused: true,
          maximized: false,
          visible: true,
          capabilities: { canCapture: true, hasVideo: false },
        },
      ),
    ).toBe("dom");
  },
);

it.each([880, undefined])(
  "rejects and replaces saved pixels when the applied height cap becomes %s",
  async (maxHeight) => {
    appliedDefaults = { paneDefaults: { height: "viewport", maxHeight: 1200 } };
    await mount({ compact: true });
    await act(() => resize(3840, 2160));
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const oldImage = new Blob(["capped pane"]);
    await act(() => drawPicture(pane, oldImage, { width: 3840, height: 1200 }));
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    const original = hook.pictureFor(paneId)!;

    await act(() => {
      appliedDefaults = {
        paneDefaults: { height: "viewport", ...(maxHeight === undefined ? {} : { maxHeight }) },
      };
      publishLayout(currentLayout);
    });
    expect(hook.displayedPictureFor(paneId)).toBeNull();
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    const replacement = new Blob(["current pane"]);
    await act(() => drawPicture(pane, replacement, { width: 3840, height: maxHeight ?? 2160 }));
    expect(hook.pictureFor(paneId)).toMatchObject({ image: replacement });
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    const resized = hook.pictureFor(paneId)!;
    await act(() => {
      appliedDefaults = { paneDefaults: { height: "viewport", maxHeight: 1200 } };
      publishLayout(currentLayout);
    });
    expect(hook.pictureFor(paneId)?.image).toBe(oldImage);
    store.saved.set(original.recordKey, original);
    store.saved.set(resized.recordKey, resized);
    await act(() => renderer!.unmount());
    appliedDefaults = {
      paneDefaults: { height: "viewport", ...(maxHeight === undefined ? {} : { maxHeight }) },
    };
    await mount({ compact: true });
    await act(() => resize(3840, 2160));
    expect(hook.pictureFor(paneId)?.image).toBe(replacement);
  },
);

it.each(["width", "type-default", "type-selection", "sibling-type"])(
  "refreshes pictures when applied %s changes without a stage resize",
  async (change) => {
    store.threadIds = ["t1", "t2"];
    currentLayout = layout(400);
    currentLayout.panes[0]!.surfaceKind = "thread";
    currentLayout.panes[1]!.surfaceKind = "thread";
    currentLayout.columns[0]!.cells.push(currentLayout.columns[1]!.cells[0]!);
    currentLayout.columns.pop();
    appliedDefaults = {
      paneDefaults: { width: 400 },
      paneTypeDefaults: { thread: { height: 600 }, files: { height: 400 } },
    };
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const image = new Blob(["original sizing"]);
    await act(() => drawPicture(pane, image));
    await act(() => {
      if (change === "width") appliedDefaults.paneDefaults = { width: 500 };
      else if (change === "type-default")
        appliedDefaults.paneTypeDefaults = { thread: { height: 400 } };
      else currentLayout.panes[change === "sibling-type" ? 1 : 0]!.surfaceKind = "files";
      publishLayout(currentLayout);
    });
    expect(hook.displayedPictureFor(paneId)).toBeNull();
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await advance(3500);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(hook.pictureFor(paneId)?.image).not.toBe(image);
  },
);

it("rejects persisted compact pictures whose key omitted the applied defaults", async () => {
  store.saved.set(
    paneId,
    savedPicture({
      geometryRevision:
        'stage:800x600@1|light:|[{"unit":"px","value":400},[[null,1,null]]]|0|compact',
    }),
  );
  await mount({ compact: true });
  expect(hook.displayedPictureFor(paneId)).toBeNull();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await advance(3500);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(store.writes).toHaveLength(1);
});

it.each([
  { width: 3840, height: 1094 },
  { width: 2000, height: 2160 },
  { width: 2000, height: 1094 },
])(
  "regenerates fullscreen pixels after resizing to $width by $height",
  async ({ width, height }) => {
    await mount({ compact: true });
    await act(() => resize(3840, 2160));
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    const original = new Blob(["full screen at 4K"]);
    await act(() => drawPicture(pane, original, { width: 3840, height: 2160 }));
    await act(() => resize(width, height));
    expect(hook.displayedPictureFor(paneId)).toBeNull();
    const replacement = new Blob(["resized full screen"]);
    await act(() => drawPicture(pane, replacement, { width, height }));
    expect(hook.pictureFor(paneId)).toMatchObject({
      image: replacement,
      cssSize: { width, height },
    });
  },
);
