// @vitest-environment jsdom
import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
  type ClientSettings,
  type DesktopPreviewBridge,
  type DesktopPreviewWebviewConfig,
  type PreviewViewportSetting,
} from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
  activeRecordings: new Set<string>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: mocks }),
}));

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {
    createTab: mocks.createTab,
    closeTab: mocks.closeTab,
    registerWebview: mocks.registerWebview,
    getPreviewConfig: mocks.getPreviewConfig,
  },
}));

vi.mock("~/components/preview/usePreviewBridge", () => ({
  usePreviewBridge: () => undefined,
}));

vi.mock("./browserRecording", () => ({
  useActiveBrowserRecordingTabIds: () => mocks.activeRecordings,
  stopBrowserRecording: async () => null,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "~/hooks/useSettings";
import { acquireBrowserSurface, useBrowserSurfaceStore } from "./browserSurfaceStore";
import * as desktopTabLifetime from "./desktopTabLifetime";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

let renderer: ReactTestRenderer | undefined;

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  mocks.getClientSettings.mockReset().mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  mocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.registerWebview.mockReset().mockResolvedValue(undefined);
  mocks.getPreviewConfig.mockReset().mockResolvedValue({
    partition: "persist:t3-preview-work",
    webPreferences: "contextIsolation=yes",
    preloadUrl: null,
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("addEventListener", vi.fn());
  vi.stubGlobal("removeEventListener", vi.fn());
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useFakeTimers();
  await act(() => renderer?.unmount());
  renderer = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HostedBrowserWebview settings hydration", () => {
  it("starts a retained background tab only after a settings read succeeds on retry", async () => {
    const firstRead = deferred<ClientSettings | null>();
    const retryRead = deferred<ClientSettings | null>();
    const tabCreation = deferred<void>();
    mocks.getClientSettings
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(retryRead.promise);
    mocks.createTab.mockReturnValueOnce(tabCreation.promise);
    const acquire = vi.spyOn(desktopTabLifetime, "acquireDesktopTab");
    const createGuest = vi.fn((_attributes: unknown) =>
      Object.assign(new EventTarget(), { getWebContentsId: () => 41 }),
    );
    const threadRef = {
      environmentId: EnvironmentId.make("host-settings-retry"),
      threadId: ThreadId.make("thread-settings-retry"),
    };
    const runtimeTabId = "retained-background-tab";
    useBrowserSurfaceStore.getState().acquireActivity(runtimeTabId);

    await act(() => {
      renderer = create(
        <HostedBrowserWebview
          threadRef={threadRef}
          tabId="server-tab"
          runtimeTabId={runtimeTabId}
          initialUrl="https://example.com"
          viewport={FILL_PREVIEW_VIEWPORT}
          pictureInPicture={false}
          profileId="work"
          zoomFactor={1.25}
        />,
        {
          createNodeMock: (element) =>
            element.type === "webview"
              ? createGuest(element.props)
              : {
                  style: document.createElement("div").style,
                  scrollLeft: 0,
                  scrollTop: 0,
                  scrollTo: () => undefined,
                },
        },
      );
    });

    expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    const failure = new Error("Saved settings are unavailable");
    await act(async () => {
      const hydration = ensureClientSettingsHydrated();
      firstRead.reject(failure);
      await expect(hydration).rejects.toBe(failure);
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    let retry!: Promise<void>;
    await act(() => {
      retry = ensureClientSettingsHydrated();
    });
    expect(mocks.getClientSettings).toHaveBeenCalledTimes(2);
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    await act(async () => {
      retryRead.resolve({
        ...DEFAULT_CLIENT_SETTINGS,
        browserDefaultZoomFactor: 1.25,
        browserDefaultAppearance: "dark",
        browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
        browserDefaultProfileId: "work",
      });
      await retry;
    });

    expect(acquire).toHaveBeenCalledExactlyOnceWith(runtimeTabId, undefined);
    expect(mocks.getPreviewConfig).toHaveBeenCalledExactlyOnceWith(threadRef.environmentId, "work");
    expect(createGuest).toHaveBeenCalledOnce();
    expect(createGuest).toHaveBeenCalledWith(
      expect.objectContaining({
        partition: "persist:t3-preview-work",
        src: "https://example.com",
      }),
    );
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
    expect(mocks.registerWebview).not.toHaveBeenCalled();

    await act(async () => {
      tabCreation.resolve();
      await tabCreation.promise;
    });
    expect(mocks.registerWebview).toHaveBeenCalledExactlyOnceWith(runtimeTabId, 41);
    expect(mocks.closeTab).not.toHaveBeenCalled();
    expect(mocks.setClientSettings).not.toHaveBeenCalled();
  });
});

describe("HostedBrowserWebview content presentation", () => {
  function fixture(name: string, fitSourceContent = false) {
    const runtimeTabId = `content-${name}`;
    const threadRef = {
      environmentId: EnvironmentId.make(`host-content-${name}`),
      threadId: ThreadId.make(`thread-content-${name}`),
    };
    const lease = acquireBrowserSurface(runtimeTabId, fitSourceContent);
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    let scrollLeft = 0;
    let scrollTop = 0;
    const readLeft = vi.fn(() => scrollLeft);
    const readTop = vi.fn(() => scrollTop);
    const wrapper = {
      style: document.createElement("div").style,
      get scrollLeft() {
        return readLeft();
      },
      get scrollTop() {
        return readTop();
      },
      scrollTo(position: { left: number; top: number }) {
        scrollLeft = position.left;
        scrollTop = position.top;
      },
    };
    const guest = Object.assign(new EventTarget(), { getWebContentsId: () => 41 });
    const focus = () => undefined;
    const present = (x = 0, y = 0, width = 800, height = 600, scale = 1) =>
      lease.present({ x, y, width: width * scale, height: height * scale }, true, 0, 30, {
        width,
        height,
        scaleX: scale,
        scaleY: scale,
        clipPath: "inset(0)",
        interactive: true,
        onFocus: focus,
      });
    present();
    return {
      runtimeTabId,
      readLeft,
      readTop,
      frames,
      present,
      content: () => useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.content,
      async render(
        options: {
          runtimeTabId?: string;
          viewport?: PreviewViewportSetting;
          zoomFactor?: number;
        } = {},
      ) {
        await act(() => {
          const view = (
            <HostedBrowserWebview
              threadRef={threadRef}
              tabId="server-tab"
              runtimeTabId={options.runtimeTabId ?? runtimeTabId}
              initialUrl="https://example.com"
              viewport={options.viewport ?? FILL_PREVIEW_VIEWPORT}
              pictureInPicture={false}
              profileId={undefined}
              zoomFactor={options.zoomFactor ?? 1}
            />
          );
          if (renderer) renderer.update(view);
          else
            renderer = create(view, {
              createNodeMock: (element) => (element.type === "webview" ? guest : wrapper),
            });
        });
      },
      async frame() {
        await act(() => {
          const pending = [...frames.values()];
          frames.clear();
          for (const callback of pending) callback(16);
        });
      },
      async scroll(left: number, top: number) {
        scrollLeft = left;
        scrollTop = top;
        await act(() => {
          renderer!.root.findByProps({ "data-preview-viewport": runtimeTabId }).props.onScroll();
        });
      },
    };
  }

  it.each([false, true])(
    "does not reread scrolling for camera-only movement (fitSourceContent=%s)",
    async (fitSourceContent) => {
      const f = fixture(`camera-${fitSourceContent}`, fitSourceContent);
      await f.render();
      await f.frame();
      await f.frame();
      const content = f.content();
      expect(content).not.toBeNull();
      f.readLeft.mockClear();
      f.readTop.mockClear();
      for (const [x, y, scale] of [
        [100, 80, 1],
        [240, 120, 0.5],
        [-1200, 90, 0.75],
      ] as const) {
        await act(() => {
          f.present(x, y, 800, 600, scale);
        });
        await f.frame();
      }
      expect(f.content()).toBe(content);
      expect(f.readLeft).not.toHaveBeenCalled();
      expect(f.readTop).not.toHaveBeenCalled();
      expect(f.frames.size).toBe(0);
    },
  );

  it("publishes changed logical dimensions on the next frame and native scrolling immediately", async () => {
    const f = fixture("dimensions");
    await f.render();
    await f.frame();
    await f.frame();
    await act(() => {
      f.present(100, 80, 1000, 700, 0.5);
    });
    expect(f.content()).toMatchObject({ width: 800, height: 600 });
    await f.frame();
    expect(f.content()).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 700,
      scale: 1,
      scrollLeft: 0,
      scrollTop: 0,
    });
    await f.scroll(37, 61);
    expect(f.content()).toMatchObject({ scrollLeft: 37, scrollTop: 61 });
  });

  it("publishes fitted viewport and zoom changes with their current offsets and scale", async () => {
    const f = fixture("zoom", true);
    const viewport = { _tag: "freeform", width: 320, height: 240 } as const;
    await f.render({ viewport });
    await f.frame();
    expect(f.content()).toMatchObject({ x: 240, y: 180, width: 320, height: 240, scale: 1 });
    await f.render({ viewport, zoomFactor: 2 });
    await f.frame();
    expect(f.content()).toMatchObject({ x: 80, y: 60, width: 640, height: 480, scale: 1 });
    await f.render({ viewport, zoomFactor: 4 });
    await f.frame();
    expect(f.content()).toMatchObject({ x: 0, y: 0, width: 800, height: 600, scale: 0.625 });
    await f.render({ viewport: { _tag: "freeform", width: 400, height: 200 } });
    await f.frame();
    expect(f.content()).toMatchObject({ x: 200, y: 200, width: 400, height: 200, scale: 1 });
  });

  it.each(["settings", "configuration"] as const)(
    "synchronizes the first mounted wrapper after delayed %s readiness",
    async (delayed) => {
      const settings = deferred<ClientSettings | null>();
      const config = deferred<DesktopPreviewWebviewConfig>();
      if (delayed === "settings") mocks.getClientSettings.mockReturnValueOnce(settings.promise);
      else mocks.getPreviewConfig.mockReturnValueOnce(config.promise);
      const f = fixture(`delayed-${delayed}`);
      await f.render();
      await f.frame();
      expect(f.content()).toBeNull();
      expect(f.readLeft).not.toHaveBeenCalled();
      await act(() => {
        if (delayed === "settings") settings.resolve(DEFAULT_CLIENT_SETTINGS);
        else
          config.resolve({
            partition: "persist:t3-preview-work",
            webPreferences: "contextIsolation=yes",
            preloadUrl: null,
          });
      });
      expect(f.content()).toBeNull();
      await f.frame();
      expect(f.content()).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
        scale: 1,
        scrollLeft: 0,
        scrollTop: 0,
      });
      expect(f.readLeft).toHaveBeenCalledOnce();
      expect(f.readTop).toHaveBeenCalledOnce();
    },
  );

  it("cancels a pending old-tab sync before publishing to a replacement tab", async () => {
    const f = fixture("ownership");
    await f.render();
    await f.frame();
    await f.frame();
    const original = f.content();
    await act(() => {
      f.present(0, 0, 1000, 700);
    });
    const replacementId = "replacement-content-tab";
    const replacement = acquireBrowserSurface(replacementId);
    replacement.present({ x: 20, y: 30, width: 640, height: 480 }, true);
    await f.render({ runtimeTabId: replacementId });
    await f.frame();
    expect(f.content()).toBe(original);
    expect(useBrowserSurfaceStore.getState().byTabId[replacementId]?.content).toMatchObject({
      width: 640,
      height: 480,
    });
  });
});
