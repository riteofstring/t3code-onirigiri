import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  ThreadId,
  type DesktopPreviewBridge,
  type PreviewListResult,
  type PreviewSessionSnapshot,
} from "@t3tools/contracts";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  navigate: vi.fn<DesktopPreviewBridge["navigate"]>(),
}));

vi.mock("./previewBridge", () => ({ previewBridge: mocks }));
vi.mock("~/browser/browserRecording", () => ({ stopBrowserRecording: async () => null }));

import { acquireDesktopTab } from "~/browser/desktopTabLifetime";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import {
  applyPreviewServerSnapshot,
  beginPreviewSessionClose,
  readThreadPreviewState,
  reconcilePreviewServerSessions,
  resetPreviewStateForTests,
} from "~/previewStateStore";

import { navigatePreviewSession } from "./navigatePreviewSession";

const threadRef = {
  environmentId: EnvironmentId.make("navigation-environment"),
  threadId: ThreadId.make("navigation-thread"),
};
const snapshot: PreviewSessionSnapshot = {
  threadId: threadRef.threadId,
  tabId: "tab-1",
  navStatus: { _tag: "Idle" },
  canGoBack: false,
  canGoForward: false,
  updatedAt: "2026-10-01T00:00:00.000Z",
};
const result: PreviewListResult = { sessions: [snapshot], serverEpoch: "server-a", revision: 1 };
const runtimeTabId = previewRuntimeTabId(threadRef, result.serverEpoch, snapshot.tabId);
const url = "https://example.com/early";
const listPreviews = vi.fn<() => Promise<AtomCommandResult<PreviewListResult, Error>>>();
const navigate = () =>
  navigatePreviewSession({ threadRef, tabId: snapshot.tabId, url, listPreviews });

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
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  resetPreviewStateForTests();
  __setClientSettingsForTests({
    ...DEFAULT_CLIENT_SETTINGS,
    browserDefaultZoomFactor: 1.25,
    browserDefaultAppearance: "dark",
  });
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  listPreviews.mockReset().mockResolvedValue(AsyncResult.success(result));
});

afterEach(async () => {
  await vi.advanceTimersByTimeAsync(0);
  resetPreviewStateForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("navigatePreviewSession", () => {
  it("binds an early native server tab before navigating it", async () => {
    const serverSnapshot = { ...snapshot, runtime: "server" as const };
    reconcilePreviewServerSessions(threadRef, { ...result, sessions: [serverSnapshot] });
    await expect(navigate()).resolves.toBe(true);
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1.25,
      colorScheme: "dark",
      serverTab: { threadId: threadRef.threadId, tabId: snapshot.tabId },
    });
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(runtimeTabId, url);
  });

  it("resolves the first epoch and applies saved defaults before an early address submission", async () => {
    const list = deferred<AtomCommandResult<PreviewListResult, Error>>();
    listPreviews.mockReturnValueOnce(list.promise);
    applyPreviewServerSnapshot(threadRef, snapshot);
    const navigation = navigate();
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();

    list.resolve(AsyncResult.success(result));
    await expect(navigation).resolves.toBe(true);
    expect(listPreviews).toHaveBeenCalledExactlyOnceWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(runtimeTabId, url);
    expect(mocks.createTab.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.navigate.mock.invocationCallOrder[0]!,
    );
    expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([url]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
  });

  it("uses the existing host lease without another list or creation once the epoch is known", async () => {
    reconcilePreviewServerSessions(threadRef, result);
    const host = acquireDesktopTab(runtimeTabId);
    await host.ready;

    await expect(navigate()).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(listPreviews).not.toHaveBeenCalled();
    expect(mocks.createTab).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(runtimeTabId, url);
    expect(mocks.closeTab).not.toHaveBeenCalled();

    host.release();
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
  });

  it.each(["closed", "restarted"] as const)(
    "abandons an early submission when its tab is %s while the list is pending",
    async (change) => {
      const list = deferred<AtomCommandResult<PreviewListResult, Error>>();
      listPreviews.mockReturnValueOnce(list.promise);
      applyPreviewServerSnapshot(threadRef, snapshot);
      const navigation = navigate();
      if (change === "closed") beginPreviewSessionClose(threadRef, snapshot.tabId);
      else reconcilePreviewServerSessions(threadRef, { ...result, serverEpoch: "server-b" });

      list.resolve(AsyncResult.success(result));
      await expect(navigation).resolves.toBe(false);
      expect(mocks.createTab).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);
      if (change === "restarted") {
        expect(readThreadPreviewState(threadRef).serverEpoch).toBe("server-b");
      }
    },
  );

  it.each(["closed", "restarted"] as const)(
    "releases the pending creation lease when the tab is %s",
    async (change) => {
      const creation = deferred<void>();
      const started = deferred<void>();
      mocks.createTab.mockImplementationOnce(() => {
        started.resolve();
        return creation.promise;
      });
      reconcilePreviewServerSessions(threadRef, result);
      const navigation = navigate();
      await started.promise;
      if (change === "closed") beginPreviewSessionClose(threadRef, snapshot.tabId);
      else reconcilePreviewServerSessions(threadRef, { ...result, serverEpoch: "server-b" });

      creation.resolve();
      await expect(navigation).resolves.toBe(false);
      expect(mocks.navigate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
    },
  );

  it.each(["create", "navigate"] as const)(
    "releases its temporary lease when %s fails",
    async (operation) => {
      const failure = new Error(`${operation} failed`);
      (operation === "create" ? mocks.createTab : mocks.navigate).mockRejectedValueOnce(failure);
      reconcilePreviewServerSessions(threadRef, result);
      await expect(navigate()).rejects.toBe(failure);
      expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);
      await vi.advanceTimersByTimeAsync(0);
      expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
    },
  );

  it("does not create a guest when the first authoritative list fails", async () => {
    applyPreviewServerSnapshot(threadRef, snapshot);
    listPreviews.mockResolvedValueOnce(AsyncResult.failure(Cause.fail(new Error("Disconnected"))));
    await expect(navigate()).resolves.toBe(false);
    expect(mocks.createTab).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("does not apply navigation completion to a replaced tab", async () => {
    const loading = deferred<void>();
    const started = deferred<void>();
    mocks.navigate.mockImplementationOnce(() => {
      started.resolve();
      return loading.promise;
    });
    reconcilePreviewServerSessions(threadRef, result);
    const navigation = navigate();
    await started.promise;
    reconcilePreviewServerSessions(threadRef, { ...result, serverEpoch: "server-b" });
    loading.resolve();

    await expect(navigation).resolves.toBe(false);
    expect(readThreadPreviewState(threadRef).recentlySeenUrls).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.closeTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId);
  });
});
