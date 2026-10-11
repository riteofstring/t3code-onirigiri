import type { OnirigiriLayout, WorkspacePane } from "@riteofstring/onirigiri";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { SavedPanePicture } from "./panePictureStore";
import { createPaneLifecycleStore } from "./paneLifecycle";
import { markPaneSynced, usePanePictureTheme, useSavedPanePictures } from "./useSavedPanePictures";

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
  deleted: [] as string[],
  threadIds: ["t1"],
  updatedAt: "u1",
  running: false,
  theme: "dark",
  themeHalves: null as { dark?: string; light?: string } | null,
  fontSettings: { ...defaultFontSettings },
};
const decodedUrls: string[] = [];
const revokedUrls: string[] = [];

const snapshot = vi.hoisted(() =>
  vi.fn(async (_element: HTMLElement, canSnapshot: () => boolean): Promise<Blob | null> =>
    canSnapshot() ? new Blob(["snapshot"]) : null,
  ),
);
vi.mock("./panePictureSnapshot", () => ({
  snapshotPanePicture: snapshot,
}));
vi.mock("./panePictureStore", () => ({
  MAX_SAVED: 200,
  loadPanePictures: async () => store.loading ?? store.saved,
  savePanePicture: async (picture: SavedPanePicture) => {
    store.writes.push(picture);
  },
  deletePanePicture: async (paneId: string) => {
    store.deleted.push(paneId);
    store.saved.delete(paneId);
  },
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: "dark", theme: store.theme, themeHalves: store.themeHalves }),
}));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof defaultFontSettings) => unknown) =>
    select(store.fontSettings),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShells: () =>
    store.threadIds.map((id) => ({
      environmentId: "e",
      id,
      updatedAt: store.updatedAt,
      latestTurn: { state: store.running ? "running" : "completed" },
    })),
}));
vi.mock("./useWorkspacePanes", () => ({
  threadPaneId: (environmentId: string, threadId: string) => `thread:${environmentId}:${threadId}`,
}));

const paneId = "thread:e:t1";
const pane = { paneId } as WorkspacePane;
const layout = (width: number) =>
  ({
    columns: store.threadIds.map((id) => ({
      cells: [{ paneId: `thread:e:${id}` }],
      widthSpec: { unit: "px", value: width },
    })),
  }) as unknown as OnirigiriLayout;
const geometry = (width: number) => `800x600@1|{"unit":"px","value":${width}}`;

let resize: (width: number, height: number) => void = () => {};
let hook: ReturnType<typeof useSavedPanePictures>;
let appearance: string;
let renderer: ReactTestRenderer | undefined;
let currentLayout = layout(400);
const getLayout = () => currentLayout;
const snapshotFailures = vi.fn<(paneId: string, startedAt: number) => void>();

function Probe() {
  const pictureAppearance = usePanePictureTheme();
  const value = useSavedPanePictures(getLayout, snapshotFailures);
  useEffect(() => {
    hook = value;
    appearance = pictureAppearance;
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

function pendingPicture() {
  let resolve!: (image: Blob | null) => void;
  const promise = new Promise<Blob | null>((done) => {
    resolve = done;
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
  vi.stubGlobal("window", Object.assign(new EventTarget(), { devicePixelRatio: 1 }));
  vi.stubGlobal("requestIdleCallback", (callback: (deadline: IdleDeadline) => void) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 1),
  );
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
  decodedUrls.length = 0;
  revokedUrls.length = 0;
  store.saved.clear();
  store.loading = null;
  store.writes.length = 0;
  store.deleted.length = 0;
  for (const id of store.threadIds) markPaneSynced(`thread:e:${id}`, null);
  store.threadIds = ["t1"];
  store.updatedAt = "u1";
  store.running = false;
  store.theme = "dark";
  store.themeHalves = null;
  store.fontSettings = { ...defaultFontSettings };
  currentLayout = layout(400);
  markPaneSynced(paneId, null);
  snapshot.mockReset();
  snapshotFailures.mockReset();
  snapshot.mockImplementation(async (_element, canSnapshot) =>
    canSnapshot() ? new Blob(["snapshot"]) : null,
  );
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("seeds a pane only with a picture of the same content and geometry", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image,
    savedAt: 1,
    source: "capture",
  });
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

function fillPictureCache() {
  store.threadIds = Array.from({ length: 201 }, (_, i) => `t${i + 1}`);
  currentLayout = layout(400);
  for (let i = 0; i < 200; i++) {
    const id = `thread:e:${store.threadIds[i]}`;
    store.saved.set(id, {
      paneId: id,
      revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
      image: new Blob([String(i)]),
      savedAt: i + 1,
      source: "capture",
    });
  }
}

it("prepares this workspace even when other workspaces fill the persistent cache", async () => {
  fillPictureCache();
  store.threadIds = ["t201"];
  currentLayout = layout(400);
  await mount();
  const nextId = "thread:e:t201";
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
  markPaneSynced(nextId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(nextId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(hook.hasFreshPicture(nextId)).toBe(true);
  expect(hook.canBackgroundPicture(nextId)).toBe(true);
});

it.each(["native", "fallback"])(
  "does not refill its own evictions but still captures visited panes through %s",
  async (source) => {
    fillPictureCache();
    await mount();
    const nextId = "thread:e:t201";
    expect(hook.canBackgroundPicture(nextId)).toBe(false);
    expect(hook.canBackgroundPicture(paneId)).toBe(true);
    markPaneSynced(nextId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    if (source === "native") {
      await act(() =>
        hook.onPanePictureCaptured({ paneId: nextId } as WorkspacePane, new Blob(["new"])),
      );
    } else {
      hook.paneSnapshots.request(nextId, { isConnected: true } as HTMLElement);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3500);
      });
    }
    expect(hook.hasFreshPicture(nextId)).toBe(true);
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    expect(hook.canBackgroundPicture(paneId)).toBe(false);

    store.updatedAt = "u2";
    await act(() => renderer!.update(<Probe />));
    expect(hook.hasFreshPicture(nextId)).toBe(false);
    expect(hook.canBackgroundPicture(nextId)).toBe(true);
    expect(hook.canBackgroundPicture(paneId)).toBe(false);
  },
);

it("saves captures only from panes showing a synchronized thread", async () => {
  await mount();
  const image = new Blob(["png"]);
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(0);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.onPanePictureCaptured(pane, image);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]).toMatchObject({
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image,
  });
});

it("keeps the last completed picture through streaming and saves the completed turn", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
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
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const completed = new Blob(["completed"]);
  await act(() => hook.onPanePictureCaptured(pane, completed));
  expect(store.writes).toHaveLength(2);
  expect(store.writes[1]).toMatchObject({
    revision: `u2|dark|dark|${fontRevision}|${geometry(400)}`,
    image: completed,
  });
});

it("refreshes pictures when the palette changes within the same appearance", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const previous = new Blob(["previous palette"]);
  await act(() => hook.onPanePictureCaptured(pane, previous));
  expect(hook.pictureFor(paneId)).toBe(previous);

  store.theme = "ocean";
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)).toBe(previous);
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["old palette"])));
  expect(store.writes).toHaveLength(1);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `ocean|dark|${fontRevision}` });
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["ocean"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);

  store.themeHalves = { dark: "iris" };
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `iris|dark|${fontRevision}` });
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["iris"])));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(store.writes[2]?.revision).toBe(`u1|iris|dark|${fontRevision}|${geometry(400)}`);
});

it("waits for committed detail to catch up with shell metadata before saving either picture path", async () => {
  store.updatedAt = "u2";
  await mount();
  markPaneSynced(paneId, { updatedAt: "u1", theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.onPanePictureCaptured(pane, new Blob(["old detail"]));
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(store.writes).toHaveLength(0);
  expect(snapshot).not.toHaveBeenCalled();

  markPaneSynced(paneId, { updatedAt: "u3", theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.revision).toBe(
    `u2|dark|dark|${fontRevision}|${geometry(400)}|responsive-css-4`,
  );

  markPaneSynced(paneId, { updatedAt: "u3", theme: "light" });
  hook.onPanePictureCaptured(pane, new Blob(["wrong theme"]));
  expect(store.writes).toHaveLength(1);
});

it("keeps previously valid cover pixels while treating updated content as needing a fresh picture", async () => {
  const image = new Blob(["png"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image,
    savedAt: 1,
    source: "capture",
  });
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
    revision: `old|dark|dark|${fontRevision}|${geometry(400)}`,
    image: new Blob(["png"]),
    savedAt: 1,
    source: "capture",
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBeNull();
});

it.each(["stored", "captured"])(
  "retains a validated %s cover through resize without a placeholder render",
  async (source) => {
    const image = new Blob(["cover"]);
    if (source === "stored") {
      store.saved.set(paneId, {
        paneId,
        revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
        image,
        savedAt: 1,
        source: "capture",
      });
    }
    await mount();
    if (source === "captured") {
      markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
      await act(() => hook.onPanePictureCaptured(pane, image));
    }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const url = hook.preparedPictureUrl(image);
    expect(url).not.toBeNull();
    await act(() => resize(900, 600));
    expect(hook.hasFreshPicture(paneId)).toBe(false);
    expect(hook.getPanePicture(pane)).toBeNull();
    expect(hook.pictureFor(paneId)).toBe(image);
    expect(hook.preparedPictureUrl(image)).toBe(url);
    expect(revokedUrls).not.toContain(url);
  },
);

it("keeps validated geometry while a workspace is temporarily hidden", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const image = new Blob(["cover"]);
  await act(() => hook.onPanePictureCaptured(pane, image));
  const version = hook.paneSnapshots.geometryVersion;
  await act(() => resize(0, 0));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.paneSnapshots.geometryVersion).toBe(version);
  await act(() => resize(800, 600));
  expect(hook.getPanePicture(pane)?.image).toBe(image);
});

it("retries a failed static capture without another interaction", async () => {
  snapshot.mockResolvedValueOnce(null);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
});

it.each(["null", "error"])(
  "keeps lifecycle backoff after a %s snapshot failure despite later input and prepares the next pane",
  async (failure) => {
    store.threadIds = ["t0", "t1", "t2", "t3"];
    currentLayout = layout(400);
    for (const id of ["t0", "t1"]) {
      const idToSeed = `thread:e:${id}`;
      store.saved.set(idToSeed, {
        paneId: idToSeed,
        revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
        image: new Blob(["cover"]),
        savedAt: 1,
        source: "capture",
      });
    }
    await mount();
    const panes = store.threadIds.map((id, slot) => ({
      paneId: `thread:e:${id}`,
      plane: 0,
      slot,
    }));
    const lifecycle = createPaneLifecycleStore(panes, "thread:e:t0");
    snapshotFailures.mockImplementation((id, startedAt) => lifecycle.pictureFailed(id, startedAt));
    const nearest = { isConnected: true } as HTMLElement;
    snapshot.mockImplementation(async (element, canSnapshot) => {
      if (!canSnapshot()) return null;
      if (element !== nearest) return new Blob(["farther pane"]);
      if (failure === "error") throw new Error("Image encoding failed");
      return null;
    });
    const mounts: string[] = [];
    for (const { paneId: id } of panes) {
      lifecycle.subscribe(id, () => {
        const mounted = lifecycle.isMounted(id);
        lifecycle.committed(id, mounted);
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mounts).toEqual(["thread:e:t2", "thread:e:t3"]);
    expect(hook.hasFreshPicture("thread:e:t3")).toBe(true);
    expect(snapshotFailures.mock.calls.length).toBeGreaterThan(0);
    expect(snapshotFailures.mock.calls.every(([id]) => id === "thread:e:t2")).toBe(true);
    lifecycle.dispose();
  },
);

it.each(["motion", "input", "content", "readiness", "disconnect", "native"])(
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(snapshot).toHaveBeenCalledOnce();

    if (change === "motion") hook.setCaptureActivity(true, true);
    else if (change === "input") window.dispatchEvent(new Event("keydown"));
    else if (change === "content") {
      store.updatedAt = "u2";
      await act(() => renderer!.update(<Probe />));
    } else if (change === "readiness") markPaneSynced(paneId, null);
    else if (change === "disconnect") element.isConnected = false;
    else await act(() => hook.onPanePictureCaptured(pane, new Blob(["native winner"])));

    if (change === "motion" || change === "input") {
      expect(canSnapshot()).toBe(false);
      hook.setCaptureActivity(true, false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
    }
    await act(() => pending.resolve(null));
    expect(snapshotFailures).not.toHaveBeenCalled();
  },
);

it.each(["capture", "snapshot", undefined] as const)(
  "refreshes old drawing styles while preserving saved %s content",
  async (source) => {
    const image = new Blob(["previous picture"]);
    store.saved.set(paneId, {
      paneId,
      revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
      image,
      savedAt: 1,
      ...(source ? { source } : {}),
    });
    await mount();
    expect(hook.hasFreshPicture(paneId)).toBe(source === "capture");
    expect(hook.pictureFor(paneId)).toBe(source === "capture" ? image : null);
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    const element = { isConnected: true } as HTMLElement;
    hook.paneSnapshots.request(paneId, element);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    if (source === "capture") {
      expect(snapshot).not.toHaveBeenCalled();
      expect(hook.getPanePicture(pane)?.image).toBe(image);
      return;
    }

    expect(snapshot).toHaveBeenCalledOnce();
    const replacement = store.writes[0]!;
    expect(replacement.image).not.toBe(image);
    expect(hook.getPanePicture(pane)?.image).toBe(replacement.image);
    await act(() => renderer!.unmount());
    store.saved.set(paneId, replacement);
    await mount();
    expect(hook.hasFreshPicture(paneId)).toBe(true);
    expect(hook.pictureFor(paneId)).toBe(replacement.image);
    hook.paneSnapshots.request(paneId, element);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(snapshot).toHaveBeenCalledOnce();
  },
);

it("lets an accepted native capture suppress the pending fallback drawing", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement, { preferNative: true });
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
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(
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

it("preserves an already idle pane before its view is released", async () => {
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  markPaneSynced(paneId, null);
  Object.defineProperty(element, "isConnected", { value: false });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("lets a newly opened workspace settle even when the page has been open a while", async () => {
  await vi.advanceTimersByTimeAsync(5000);
  window.dispatchEvent(new Event("pointerdown"));
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(399);
  });
  expect(snapshot).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2);
  });
  expect(store.writes).toHaveLength(1);
});

it("gives native capture its grace period even when input is already quiet", async () => {
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement, { preferNative: true });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1900);
  });
  expect(snapshot).not.toHaveBeenCalled();
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["native"])));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.source).toBe("capture");
});

it("waits for recent input to settle before preserving a newly ready pane", async () => {
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  window.dispatchEvent(new Event("keydown"));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(399);
  });
  expect(snapshot).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2);
  });
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("captures first pixels between ordinary navigation inputs, only after motion stops", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.setCaptureActivity(true, true);
  window.dispatchEvent(new Event("keydown"));
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(550);
  });
  expect(snapshot).not.toHaveBeenCalled();
  hook.setCaptureActivity(true, false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  window.dispatchEvent(new Event("keydown"));
  expect(store.writes).toHaveLength(1);
});

it("keeps refresh work deferred when a usable cover already exists", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const cover = new Blob(["cover"]);
  await act(() => hook.onPanePictureCaptured(pane, cover));
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
  for (let step = 0; step < 5; step++) {
    window.dispatchEvent(new Event("keydown"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
  }
  expect(snapshot).not.toHaveBeenCalled();
  expect(hook.pictureFor(paneId)).toBe(cover);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.pictureFor(paneId)).not.toBe(cover);
});

it("requeues a first picture interrupted by camera motion before cloning", async () => {
  const layout = pendingPicture();
  snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
    await layout.promise;
    return canSnapshot() ? new Blob(["interrupted"]) : null;
  });
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  hook.setCaptureActivity(true, true);
  await act(() => layout.resolve(null));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(store.writes).toHaveLength(0);
  expect(snapshot).toHaveBeenCalledOnce();
  hook.setCaptureActivity(true, false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("replaces retained cover pixels when a fresh capture arrives", async () => {
  const previous = new Blob(["previous"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: previous,
    savedAt: 1,
    source: "capture",
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBe(previous);
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  const replacement = new Blob(["replacement"]);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  await act(() => hook.onPanePictureCaptured(pane, replacement));
  expect(hook.pictureFor(paneId)).toBe(replacement);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("does not draw pending pictures after the workspace unmounts", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement, { preferNative: true });
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
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, element);
  markPaneSynced(
    paneId,
    { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` },
    revision,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
});

it.each(["keydown", "pointerdown", "wheel"])(
  "postpones a picture when %s arrives before cloning, then retries after quiet input",
  async (type) => {
    const layout = pendingPicture();
    snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
      await layout.promise;
      return canSnapshot() ? new Blob(["interrupted picture"]) : null;
    });
    await mount();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    window.dispatchEvent(new Event(type));
    await act(async () => layout.resolve(null));
    expect(store.writes).toHaveLength(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    window.dispatchEvent(new Event(type));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(399);
    });
    expect(snapshot).toHaveBeenCalledOnce();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(store.writes).toHaveLength(1);
    expect(hook.hasFreshPicture(paneId)).toBe(true);
  },
);

it("retries an interrupted refresh with the latest pane element", async () => {
  const old = new Blob(["previous scroll position"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}|responsive-css-4`,
    image: old,
    savedAt: 1,
    source: "snapshot",
  });
  const layout = pendingPicture();
  snapshot.mockImplementationOnce(async (_element, canSnapshot) => {
    await layout.promise;
    return canSnapshot() ? new Blob(["interrupted picture"]) : null;
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBe(old);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(
    paneId,
    { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` },
    revision,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  window.dispatchEvent(new Event("wheel"));
  const replacement = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, replacement);
  await act(async () => layout.resolve(null));
  expect(store.writes).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledTimes(2);
  expect(snapshot.mock.calls[1]?.[0]).toBe(replacement);
  expect(store.writes).toHaveLength(1);
  expect(hook.pictureFor(paneId)).not.toBe(old);
});

it("keeps an immutable picture that finishes encoding after input and pane eviction", async () => {
  const encoding = pendingPicture();
  snapshot.mockReturnValueOnce(encoding.promise);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(snapshot.mock.calls[0]![1]()).toBe(true);

  window.dispatchEvent(new Event("keydown"));
  markPaneSynced(paneId, null);
  Object.defineProperty(element, "isConnected", { value: false });
  const image = new Blob(["completed after eviction"]);
  await act(async () => {
    encoding.resolve(image);
  });
  expect(store.writes).toHaveLength(1);
  expect(hook.pictureFor(paneId)).toBe(image);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(snapshot).toHaveBeenCalledOnce();
    await act(() => {
      if (change === "content") store.updatedAt = "u2";
      if (change === "theme") store.theme = "ocean";
      if (change === "fonts") store.fontSettings.fontSmoothing = false;
      if (change === "running") store.running = true;
      if (change === "stage") resize(900, 600);
      if (change === "column") hook.onLayoutChange(layout(500));
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

it("retains a native capture that arrives while its fallback is encoding", async () => {
  const encoding = pendingPicture();
  snapshot.mockReturnValueOnce(encoding.promise);
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  const native = new Blob(["native"]);
  await act(() => hook.onPanePictureCaptured(pane, native));
  await act(async () => {
    encoding.resolve(new Blob(["fallback"]));
  });
  expect(store.writes).toHaveLength(1);
  expect(hook.pictureFor(paneId)).toBe(native);
});

it("waits until a running turn completes before drawing its fallback picture", async () => {
  store.running = true;
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).not.toHaveBeenCalled();
  expect(hook.canBackgroundPicture(paneId)).toBe(false);
  expect(hook.runningPanes).toEqual(new Set([paneId]));
  store.running = false;
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` });
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.canBackgroundPicture(paneId)).toBe(true);
  expect(hook.runningPanes.size).toBe(0);
});

it("warms only pictures valid for current panes and releases their URLs on unmount", async () => {
  const valid = new Blob(["valid"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: valid,
    savedAt: 1,
    source: "capture",
  });
  store.saved.set("absent-pane", {
    paneId: "absent-pane",
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: new Blob(["absent"]),
    savedAt: 1,
    source: "capture",
  });
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  const url = hook.preparedPictureUrl(valid);
  expect(url).toBe("blob:picture-1");
  expect(decodedUrls).toEqual([url]);
  expect(hook.pictureUrl(valid)).toBe(url);
  await act(() => renderer!.unmount());
  renderer = undefined;
  expect(revokedUrls).toEqual([url]);
});

it("does not decode a stored picture that was never valid in this session", async () => {
  const invalid = new Blob(["old geometry"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(600)}`,
    image: invalid,
    savedAt: 1,
    source: "capture",
  });
  await mount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(hook.preparedPictureUrl(invalid)).toBeNull();
  expect(decodedUrls).toEqual([]);
});

it("retains the decoded cover through refresh and releases it after the next cover takes over", async () => {
  const previous = new Blob(["previous"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: previous,
    savedAt: 1,
    source: "capture",
  });
  await mount();
  expect(hook.pictureFor(paneId)).toBe(previous);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  const previousUrl = hook.preparedPictureUrl(previous)!;
  store.updatedAt = "u2";
  await act(() => renderer!.update(<Probe />));
  expect(hook.pictureFor(paneId)).toBe(previous);
  expect(hook.preparedPictureUrl(previous)).toBe(previousUrl);
  expect(revokedUrls).not.toContain(previousUrl);

  const replacement = new Blob(["replacement"]);
  markPaneSynced(paneId, { updatedAt: "u2", theme: `dark|dark|${fontRevision}` });
  await act(() => hook.onPanePictureCaptured(pane, replacement));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5);
  });
  expect(hook.pictureFor(paneId)).toBe(replacement);
  const nextUrl = hook.preparedPictureUrl(replacement)!;
  expect(nextUrl).not.toBe(previousUrl);
  store.updatedAt = "u3";
  await act(() => renderer!.update(<Probe />));
  expect(revokedUrls).toContain(previousUrl);
  expect(revokedUrls).not.toContain(nextUrl);
  expect(hook.pictureFor(paneId)).toBe(replacement);
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
  await act(() => hook.onPanePictureCaptured(pane, previous));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)).toBe(previous);

  store.fontSettings = { ...store.fontSettings, ...change };
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(false);
  expect(hook.getPanePicture(pane)).toBeNull();
  expect(hook.pictureFor(paneId)).toBe(previous);
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["old font setting"])));
  expect(store.writes).toHaveLength(1);

  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const current = new Blob(["new font setting"]);
  await act(() => hook.onPanePictureCaptured(pane, current));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.pictureFor(paneId)).toBe(current);
});

it("keeps a picture current when an unrelated setting changes", async () => {
  await mount();
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  const previous = new Blob(["same appearance"]);
  await act(() => hook.onPanePictureCaptured(pane, previous));
  store.fontSettings.panelAnimationDurationMs = 500;
  await act(() => renderer!.update(<Probe />));
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  expect(hook.getPanePicture(pane)).toEqual({ image: previous, fit: "fill", replaceable: true });
  expect(store.writes).toHaveLength(1);
});

it("refreshes a saved native picture after local scrolling while retaining its cover", async () => {
  const old = new Blob(["previous scroll position"]);
  store.saved.set(paneId, {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: old,
    savedAt: 1,
    source: "capture",
  });
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement, {
    preferNative: true,
  });
  expect(hook.getPanePicture(pane)?.image).toBe(old);
  expect(hook.pictureFor(paneId)).toBe(old);
  await act(() => hook.onPanePictureCaptured(pane, new Blob(["old in-flight capture"])));
  expect(store.writes).toHaveLength(0);
  markPaneSynced(paneId, content, revision);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(store.writes.at(-1)?.source).toBe("snapshot");
  expect(hook.pictureFor(paneId)).not.toBe(old);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("keeps a fresh native capture when an older fallback finishes in the same turn", async () => {
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  const native = new Blob(["native"]);
  await act(async () => {
    hook.onPanePictureCaptured(pane, native);
    pending.resolve(new Blob(["fallback"]));
    await pending.promise;
  });
  expect(hook.pictureFor(paneId)).toBe(native);
  expect(store.writes).toHaveLength(1);
  expect(store.writes[0]?.source).toBe("capture");
});

it("rejects an encoding made stale by another local visual change", async () => {
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  const element = { isConnected: true } as HTMLElement;
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  hook.paneSnapshots.invalidate(paneId);
  const revision = hook.paneSnapshots.request(paneId, element);
  markPaneSynced(paneId, content, revision);
  await act(async () => pending.resolve(new Blob(["old encoding"])));
  expect(store.writes).toHaveLength(0);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(store.writes).toHaveLength(1);
  expect(hook.hasFreshPicture(paneId)).toBe(true);
});

it("retains an unpublished refresh across content release and an ordinary remount request", async () => {
  await mount();
  const content = { updatedAt: store.updatedAt, theme: `dark|dark|${fontRevision}` };
  markPaneSynced(paneId, content);
  const original = new Blob(["original capture"]);
  await act(() => hook.onPanePictureCaptured(pane, original));
  hook.paneSnapshots.invalidate(paneId);
  markPaneSynced(paneId, null);
  expect(hook.getPanePicture(pane)?.image).toBe(original);
  const revision = hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  markPaneSynced(paneId, content, revision);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  expect(hook.pictureFor(paneId)).not.toBe(original);
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
  await act(() => hook.onPanePictureCaptured(pane, captured));
  const previous = new Blob(["previous session"]);
  const secondId = "thread:e:t2";
  const record = {
    paneId,
    revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
    image: previous,
    savedAt: 1,
    source: "capture" as const,
  };
  await act(async () =>
    loaded(
      new Map([
        [paneId, record],
        [secondId, { ...record, paneId: secondId }],
      ]),
    ),
  );
  expect(hook.pictureFor(paneId)).toBe(captured);
  expect(hook.pictureFor(secondId)).toBe(previous);
  expect(hook.picturesLoaded).toBe(true);
});

it.each(["native", "fallback"])(
  "retains a removed producer until current %s pixels are accepted",
  async (source) => {
    await mount();
    const old = new Blob(["static before embedded content"]);
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
    await act(() => hook.onPanePictureCaptured(pane, old));
    expect(hook.pictureFor(paneId)).toBe(old);
    const originalPresentation = hook.getPanePresentation;
    let revision = 0;
    await act(() => {
      revision = hook.paneSnapshots.setLiveProducer(paneId, true);
    });
    expect(hook.getPanePicture(pane)).toBeNull();
    expect(hook.pictureFor(paneId)).toBeNull();
    expect(hook.retainedPaneIds.has(paneId)).toBe(true);
    expect(hook.canBackgroundPicture(paneId)).toBe(false);
    expect(hook.getPanePresentation).not.toBe(originalPresentation);
    expect(store.deleted).toContain(paneId);
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
    await act(() => hook.onPanePictureCaptured(pane, new Blob(["empty guest slot"])));
    expect(store.writes).toHaveLength(1);

    await act(() => {
      revision = hook.paneSnapshots.setLiveProducer(paneId, false);
    });
    expect(hook.retainedPaneIds.has(paneId)).toBe(true);
    expect(hook.canBackgroundPicture(paneId)).toBe(true);
    expect(hook.pictureFor(paneId)).toBeNull();
    markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance }, revision);
    await act(async () => {
      if (source === "native")
        hook.onPanePictureCaptured(pane, new Blob(["current static pixels"]));
      else {
        hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
        await vi.advanceTimersByTimeAsync(3500);
      }
    });
    expect(hook.retainedPaneIds.has(paneId)).toBe(false);
    expect(hook.pictureFor(paneId)).toBe(store.writes.at(-1)!.image);
    expect(hook.pictureFor(paneId)).not.toBe(old);
  },
);

it("rejects an encoding across producer appearance and removal", async () => {
  await mount();
  const pending = pendingPicture();
  snapshot.mockImplementationOnce(() => pending.promise);
  markPaneSynced(paneId, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3500);
  });
  expect(snapshot).toHaveBeenCalledOnce();
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
    hook.paneSnapshots.setLiveProducer(paneId, false);
    pending.resolve(new Blob(["old static pixels"]));
  });
  expect(store.writes).toHaveLength(0);
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(hook.retainedPaneIds.has(paneId)).toBe(true);
});

it.each(["null", "error", "resize"])(
  "recovers a retained static pane after a %s capture failure without more input",
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
      return new Blob(["old geometry"]);
    });
    hook.paneSnapshots.request(paneId, { isConnected: true } as HTMLElement);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(hook.pictureFor(paneId)).toBeNull();
    expect(hook.retainedPaneIds.has(paneId)).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(hook.retainedPaneIds.has(paneId)).toBe(false);
    expect(hook.pictureFor(paneId)).toBe(store.writes.at(-1)!.image);
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
    candidate !== element && canSnapshot() ? new Blob(["other pane"]) : null,
  );
  hook.paneSnapshots.request(paneId, element);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(snapshot.mock.calls.length).toBeLessThanOrEqual(5);
  expect(snapshot.mock.calls.length).toBeGreaterThan(1);
  expect(hook.retainedPaneIds.has(paneId)).toBe(true);
  const other = "thread:e:t2";
  markPaneSynced(other, { updatedAt: store.updatedAt, theme: appearance });
  hook.paneSnapshots.request(other, { isConnected: true } as HTMLElement);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(hook.hasFreshPicture(other)).toBe(true);
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  const attempts = snapshot.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });
  expect(snapshot.mock.calls.length).toBe(attempts);
  expect(hook.pictureFor(paneId)).toBeNull();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
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
    loaded(
      new Map([
        [
          paneId,
          {
            paneId,
            revision: `u1|dark|dark|${fontRevision}|${geometry(400)}`,
            image: new Blob(["incomplete stored picture"]),
            savedAt: 1,
            source: "capture",
          },
        ],
      ]),
    ),
  );
  expect(hook.picturesLoaded).toBe(true);
  expect(hook.getPanePicture(pane)).toBeNull();
  expect(hook.pictureFor(paneId)).toBeNull();
  expect(hook.retainedPaneIds.has(paneId)).toBe(true);
});

it("forgets retained producers when their panes leave the workspace", async () => {
  await mount();
  await act(() => {
    hook.paneSnapshots.setLiveProducer(paneId, true);
  });
  expect(hook.retainedPaneIds.has(paneId)).toBe(true);
  await act(() => hook.onLayoutChange({ columns: [] } as unknown as OnirigiriLayout));
  expect(hook.retainedPaneIds.has(paneId)).toBe(false);
  expect(hook.pictureFor(paneId)).toBeNull();
});
