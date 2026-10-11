import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type DesktopPreviewBridge,
  type PreviewEvent,
  type PreviewListResult,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  navigate: vi.fn<DesktopPreviewBridge["navigate"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
  getClientSettings: vi.fn<() => Promise<typeof DEFAULT_CLIENT_SETTINGS | null>>(),
  activeRecordings: new Set<string>(),
}));

vi.mock("~/env", () => ({ isElectron: true }));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/components/preview/previewBridge", () => ({ previewBridge: mocks }));
vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: { getClientSettings: mocks.getClientSettings } }),
}));
vi.mock("~/components/preview/usePreviewBridge", () => ({
  usePreviewBridge: () => undefined,
}));
vi.mock("./browserRecording", () => ({
  useActiveBrowserRecordingTabIds: () => mocks.activeRecordings,
  stopBrowserRecording: async () => null,
}));
vi.mock("~/state/preview", () => ({
  previewEnvironment: {
    list: ({ environmentId, input }: { environmentId: string; input: { threadId: string } }) =>
      listAtoms(JSON.stringify([environmentId, input.threadId])),
    events: () => eventsAtom,
  },
}));

import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "~/hooks/useSettings";
import { navigatePreviewSession } from "~/components/preview/navigatePreviewSession";
import {
  applyPreviewServerSnapshot,
  beginPreviewSessionClose,
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "~/previewStateStore";
import { appAtomRegistry, AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { ElectronBrowserHost } from "./ElectronBrowserHost";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

const listAtoms = Atom.family((_key: string) =>
  Atom.make<AsyncResult.AsyncResult<PreviewListResult, Error>>(AsyncResult.initial(false)),
);
const eventsAtom = Atom.make<AsyncResult.AsyncResult<PreviewEvent, Error>>(
  AsyncResult.initial(false),
);

let renderer: ReactTestRenderer | undefined;
let sequence = 0;
const createGuest = vi.fn(() => Object.assign(new EventTarget(), { getWebContentsId: () => 41 }));

function threadFixture() {
  sequence += 1;
  const threadRef = {
    environmentId: EnvironmentId.make(`host-environment-${sequence}`),
    threadId: ThreadId.make(`host-thread-${sequence}`),
  };
  const snapshot: PreviewSessionSnapshot = {
    threadId: threadRef.threadId,
    tabId: "tab-1",
    navStatus: { _tag: "Success", url: "https://example.com/", title: "Example" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const list = listAtoms(JSON.stringify([threadRef.environmentId, threadRef.threadId]));
  return { threadRef, snapshot, list };
}

async function mountHost() {
  await act(() => {
    renderer = create(
      <AppAtomRegistryProvider>
        <ElectronBrowserHost />
      </AppAtomRegistryProvider>,
      {
        createNodeMock: (element) =>
          element.type === "webview"
            ? createGuest()
            : { scrollLeft: 0, scrollTop: 0, scrollTo: () => undefined },
      },
    );
  });
}

beforeEach(() => {
  resetPreviewStateForTests();
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  mocks.getClientSettings.mockReset().mockResolvedValue(null);
  mocks.registerWebview.mockReset().mockResolvedValue(undefined);
  mocks.getPreviewConfig.mockReset().mockResolvedValue({
    partition: "persist:t3-preview-default",
    webPreferences: "contextIsolation=yes",
    preloadUrl: null,
  });
  createGuest.mockClear();
  appAtomRegistry.set(eventsAtom, AsyncResult.initial(false));
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
  resetPreviewStateForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ElectronBrowserHost server identity", () => {
  it("retains an early navigation while saved settings hydrate and the host takes ownership", async () => {
    vi.useFakeTimers();
    __resetClientSettingsPersistenceForTests();
    const { threadRef, snapshot } = threadFixture();
    let loadSettings!: (settings: typeof DEFAULT_CLIENT_SETTINGS) => void;
    mocks.getClientSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        loadSettings = resolve;
      }),
    );
    applyPreviewServerSnapshot(threadRef, snapshot);
    await mountHost();
    const url = "https://example.com/early";
    let navigation!: Promise<boolean>;
    await act(async () => {
      navigation = navigatePreviewSession({
        threadRef,
        tabId: snapshot.tabId,
        url,
        listPreviews: async () =>
          AsyncResult.success({ sessions: [snapshot], serverEpoch: "server-a", revision: 1 }),
      });
    });
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      loadSettings({
        ...DEFAULT_CLIENT_SETTINGS,
        browserDefaultZoomFactor: 1.25,
        browserDefaultAppearance: "dark",
      });
      await navigation;
    });
    await expect(navigation).resolves.toBe(true);
    const runtimeTabId = previewRuntimeTabId(threadRef, "server-a", snapshot.tabId);
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
    expect(createGuest).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(runtimeTabId, url);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).not.toHaveBeenCalled();

    await act(() => renderer?.unmount());
    renderer = undefined;
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
  });

  it("does not resurrect a tab closed while its first authoritative list is pending", async () => {
    const { threadRef, snapshot, list } = threadFixture();
    applyPreviewServerSnapshot(threadRef, snapshot);
    await mountHost();
    await act(() => {
      beginPreviewSessionClose(threadRef, snapshot.tabId);
    });
    await act(() => {
      appAtomRegistry.set(
        list,
        AsyncResult.success({ sessions: [snapshot], serverEpoch: "server-a", revision: 1 }),
      );
    });
    expect(readThreadPreviewState(threadRef).serverEpoch).toBe("server-a");
    expect(readThreadPreviewState(threadRef).sessions).toEqual({});
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
  });

  it("synchronizes a background tab without a PreviewView and creates one guest after recovery", async () => {
    const { threadRef, snapshot, list } = threadFixture();
    applyPreviewServerSnapshot(threadRef, snapshot);
    await mountHost();
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();

    await act(() => {
      appAtomRegistry.set(list, AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
    });
    expect(mocks.createTab).not.toHaveBeenCalled();

    await act(() => {
      appAtomRegistry.set(
        list,
        AsyncResult.success({ sessions: [snapshot], serverEpoch: "server-a", revision: 1 }),
      );
    });
    const runtimeTabId = previewRuntimeTabId(threadRef, "server-a", snapshot.tabId);
    expect(readThreadPreviewState(threadRef).serverEpoch).toBe("server-a");
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1,
      colorScheme: "system",
    });
    expect(createGuest).toHaveBeenCalledOnce();
    expect(mocks.registerWebview).toHaveBeenCalledExactlyOnceWith(runtimeTabId, 41);

    await act(() => {
      appAtomRegistry.set(
        list,
        AsyncResult.success({
          sessions: [{ ...snapshot, viewport: { _tag: "freeform", width: 900, height: 700 } }],
          serverEpoch: "server-a",
          revision: 2,
        }),
      );
    });
    expect(createGuest).toHaveBeenCalledOnce();
    expect(mocks.createTab).toHaveBeenCalledOnce();
    expect(mocks.closeTab).not.toHaveBeenCalled();
  });

  it("replaces a guest after a real server restart and releases it when the session closes", async () => {
    const { threadRef, snapshot, list } = threadFixture();
    applyPreviewServerSnapshot(threadRef, snapshot);
    await mountHost();
    vi.useFakeTimers();
    for (const serverEpoch of ["server-a", "server-b"]) {
      await act(() => {
        appAtomRegistry.set(
          list,
          AsyncResult.success({ sessions: [snapshot], serverEpoch, revision: 1 }),
        );
      });
    }
    expect(createGuest).toHaveBeenCalledTimes(2);
    expect(mocks.createTab.mock.calls.map(([tabId]) => tabId)).toEqual([
      previewRuntimeTabId(threadRef, "server-a", snapshot.tabId),
      previewRuntimeTabId(threadRef, "server-b", snapshot.tabId),
    ]);

    await act(() => {
      appAtomRegistry.set(
        eventsAtom,
        AsyncResult.success({
          type: "closed",
          threadId: threadRef.threadId,
          tabId: snapshot.tabId,
          createdAt: "2026-10-01T00:00:01.000Z",
          serverEpoch: "server-b",
          revision: 2,
        }),
      );
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).toHaveBeenCalledWith(
      previewRuntimeTabId(threadRef, "server-a", snapshot.tabId),
    );
    expect(mocks.closeTab).toHaveBeenCalledWith(
      previewRuntimeTabId(threadRef, "server-b", snapshot.tabId),
    );
    expect(readThreadPreviewState(threadRef).sessions).toEqual({});
  });
});
