// @vitest-environment jsdom
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { PanelAnimationSuppressionProvider } from "@t3tools/web/src/panelAnimations";

import {
  ComposerHandleContext,
  type ComposerHandleRef,
} from "@t3tools/web/src/composerHandleContext";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";
import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { SpatialWorkspaceActiveContext, ThreadPane } from "./ThreadPane";
import { PaneLifecycleContext, type PaneLifecycleStore } from "./paneLifecycle";
import { PaneSnapshotContext, type RequestPaneSnapshot } from "./useSavedPanePictures";

const state = vi.hoisted(() => ({
  mounted: true,
  interactive: false,
  composerVersion: 0,
  composerActions: [] as number[],
  activeKeys: 0,
  showClock: false,
  shellUpdatedAt: "2026-10-15T12:00:00.000Z",
  runtimeStatus: null as ThreadRuntimeSummary["status"] | null,
  historyLoading: false,
  projection: null as { updatedAt: string } | null,
  status: "synchronizing" as "synchronizing" | "live" | "deleted",
  panelDurationMs: 200,
  reducedMotion: false,
  panelRenders: 0,
  checkoutReady: true,
  timelineReady: true,
  composerMounted: true,
  hasChatView: true,
  suspended: false,
  engineReady: false,
  engineRevision: "",
  engineRevisions: [] as string[],
  navigateToThread: null as ((ref: ScopedThreadRef) => Promise<void>) | null,
  listeners: new Set<() => void>(),
}));

vi.mock("@riteofstring/onirigiri", async () => {
  const { useLayoutEffect } = await import("react");
  return {
    useOnirigiriPaneContentReady: (ready: boolean, revision: string) => {
      useLayoutEffect(() => {
        if (state.engineRevision !== revision) state.engineRevisions.push(revision);
        state.engineReady = ready;
        state.engineRevision = revision;
      }, [ready, revision]);
    },
    useOnirigiriPaneInteractive: () => state.interactive,
  };
});
vi.mock("./paneLifecycle", async () => {
  const { createContext } = await import("react");
  return { PaneLifecycleContext: createContext(null), usePaneMounted: () => state.mounted };
});
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: () => ({
    updatedAt: state.shellUpdatedAt,
    runtime: state.runtimeStatus ? { status: state.runtimeStatus } : null,
  }),
  useThreadProjection: (ref: ScopedThreadRef | null) =>
    ref === null || state.projection === null
      ? null
      : { projection: { updatedAt: DateTime.makeUnsafe(state.projection.updatedAt) } },
  useThreadHistory: () => ({ loading: state.historyLoading }),
  useThreadStatus: (ref: ScopedThreadRef | null) => (ref === null ? "empty" : state.status),
}));
vi.mock("./useSavedPanePictures", async () => {
  const { createContext } = await import("react");
  return {
    PaneSnapshotContext: createContext(null),
    markPaneSynced: vi.fn(),
    usePanePictureTheme: () => "default|dark",
  };
});
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { panelAnimationDurationMs: number }) => unknown) =>
    select({ panelAnimationDurationMs: state.panelDurationMs }),
}));
vi.mock("@t3tools/web/src/hooks/useMediaQuery", () => ({
  useMediaQuery: () => state.reducedMotion,
}));
vi.mock("@t3tools/web/src/components/ThreadRouteView", async () => {
  const { useImperativeHandle, useLayoutEffect, useState, useSyncExternalStore } =
    await import("react");
  const { useNavigate } = await import("@tanstack/react-router");
  const { buildThreadRouteParams } = await import("@t3tools/web/src/threadRoutes");
  const { useComposerHandleContext } = await import("@t3tools/web/src/composerHandleContext");
  const { usePanelAnimationSettings, usePanelPresence } =
    await import("@t3tools/web/src/panelAnimations");
  const { ChatViewPendingContent, useChatViewContentReady, useComposerSyncPhase } =
    await import("@t3tools/web/src/components/chatViewContentReady");
  const { useActiveChatViewEffect, useChatViewActivity } =
    await import("@t3tools/web/src/components/chatViewActivity");
  const { useNowMinute } = await import("@t3tools/web/src/hooks/useNowMinute");
  function Clock() {
    const minute = useNowMinute(useChatViewActivity());
    return <output aria-label="Current minute">{minute}</output>;
  }
  function ChatContent() {
    "use no memo";
    useActiveChatViewEffect(() => {
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === "x") state.activeKeys += 1;
      };
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }, []);
    const composerRef = useComposerHandleContext();
    const version = state.composerVersion;
    useImperativeHandle(
      composerRef,
      () =>
        ({
          isModelPickerOpen: () => version % 2 === 1,
          focusAtEnd: () => {
            state.composerActions.push(version);
          },
        }) as ChatComposerHandle,
      [version],
    );
    useLayoutEffect(() => {
      state.panelRenders++;
    });
    const [open, setOpen] = useState(true);
    const { active, durationMs } = usePanelAnimationSettings();
    const panel = usePanelPresence(open, "Restored panel", active, "thread-one", durationMs);
    const onSyncReadyChange = useChatViewContentReady(
      "thread-one",
      state.checkoutReady,
      state.timelineReady,
      false,
      state.composerMounted,
    );
    const shownSyncPhase = useComposerSyncPhase(
      "thread-one",
      state.status === "synchronizing" ? "syncing" : null,
      onSyncReadyChange,
    );
    return (
      <>
        {state.showClock ? <Clock /> : null}
        {state.suspended ? <ChatViewPendingContent /> : null}
        <textarea aria-label="Draft" className="composer-tiptap" data-testid="composer-editor" />
        {shownSyncPhase ? <span role="status">Syncing messages</span> : null}
        <button onClick={() => setOpen(!open)}>{open ? "Close panel" : "Open panel"}</button>
        {panel.present ? <aside aria-label="Thread panel">{panel.value}</aside> : null}
      </>
    );
  }
  return {
    ThreadRouteView: ({ target }: { target: ThreadRouteTarget }) => {
      const navigate = useNavigate();
      useLayoutEffect(() => {
        state.navigateToThread = async (ref) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(ref),
          });
        };
      }, [navigate]);
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () =>
          `${state.status}:${state.checkoutReady}:${state.timelineReady}:${state.hasChatView}:${state.composerVersion}:${state.suspended}`,
      );
      return state.hasChatView ? (
        <>
          <output aria-label="Routed thread">
            {target.kind === "server" ? target.threadRef.threadId : target.draftId}
          </output>
          <ChatContent />
        </>
      ) : null;
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let lifecycle: PaneLifecycleStore | null;
let paneId: string;
let appSuppressed: boolean;
let requestSnapshot: ReturnType<typeof vi.fn<RequestPaneSnapshot>>;
let invalidateSnapshot: ReturnType<typeof vi.fn<(paneId: string) => void>>;
let snapshots: {
  geometryVersion: number;
  request: RequestPaneSnapshot;
  invalidate: (paneId: string) => void;
  setLiveProducer: (paneId: string, present: boolean) => number;
};
let liveProducer: boolean;
let appComposerRef: ComposerHandleRef;
let workspaceActive: boolean;
let thread: ScopedThreadRef;
let onNavigateAway: ReturnType<typeof vi.fn<(href: string) => void>>;

function live(updatedAt = "2026-10-15T12:00:00.000Z") {
  state.projection = { updatedAt };
  state.status = "live";
}

async function render(
  focused = false,
  paintFrames = true,
  visible = focused,
  settledVisible = visible,
) {
  await act(async () => {
    for (const listener of state.listeners) listener();
    root.render(
      <SpatialWorkspaceActiveContext value={workspaceActive}>
        <ComposerHandleContext value={appComposerRef}>
          <PanelAnimationSuppressionProvider value={appSuppressed}>
            <PaneLifecycleContext value={lifecycle}>
              <PaneSnapshotContext value={snapshots}>
                <ThreadPane
                  paneId={paneId}
                  thread={{ ...thread }}
                  focused={focused}
                  visible={visible}
                  settledVisible={settledVisible}
                  onNavigateAway={onNavigateAway}
                />
              </PaneSnapshotContext>
            </PaneLifecycleContext>
          </PanelAnimationSuppressionProvider>
        </ComposerHandleContext>
      </SpatialWorkspaceActiveContext>,
    );
  });
  await act(async () => {
    if (paintFrames) await vi.advanceTimersByTimeAsync(32);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 0),
  );
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
  lifecycle = null;
  paneId = "thread:environment-one:thread-one";
  thread = {
    environmentId: "environment-one" as EnvironmentId,
    threadId: "thread-one" as ThreadId,
  };
  onNavigateAway = vi.fn();
  state.mounted = true;
  state.interactive = false;
  state.composerVersion = 0;
  state.composerActions = [];
  state.activeKeys = 0;
  state.showClock = false;
  appComposerRef = { current: null };
  workspaceActive = true;
  state.shellUpdatedAt = "2026-10-15T12:00:00.000Z";
  state.runtimeStatus = null;
  state.historyLoading = false;
  state.projection = null;
  state.status = "synchronizing";
  state.panelDurationMs = 200;
  state.reducedMotion = false;
  state.panelRenders = 0;
  state.checkoutReady = true;
  state.timelineReady = true;
  state.composerMounted = true;
  state.hasChatView = true;
  state.suspended = false;
  state.engineReady = false;
  state.engineRevision = "";
  state.engineRevisions = [];
  state.navigateToThread = null;
  let visualRevision = 0;
  requestSnapshot = vi.fn(() => visualRevision);
  invalidateSnapshot = vi.fn(() => {
    visualRevision++;
  });
  liveProducer = false;
  snapshots = {
    geometryVersion: 0,
    request: requestSnapshot,
    invalidate: invalidateSnapshot,
    setLiveProducer: (_paneId, present) => {
      if (present !== liveProducer) visualRevision++;
      liveProducer = present;
      return visualRevision;
    },
  };
  appSuppressed = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  lifecycle?.dispose();
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each([
  "thread-one",
  "thread:provider:codex:native-thread:fixture-child%3Alocal-v2-7",
  "thread:provider:codex:native-thread:slash%2Fhash%23query%3F",
])(
  "preserves opaque thread identity and its draft through native route navigation: %s",
  async (id) => {
    thread = { ...thread, threadId: id as ThreadId };
    paneId = `thread:${thread.environmentId}:${thread.threadId}`;
    live(state.shellUpdatedAt);
    await render(true);
    expect(container.querySelector('[aria-label="Routed thread"]')?.textContent).toBe(id);
    const editor = container.querySelector("textarea")!;
    editor.value = "Keep this child draft";

    await act(async () => state.navigateToThread!(thread));
    expect(onNavigateAway).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Routed thread"]')?.textContent).toBe(id);
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Keep this child draft");

    await act(async () =>
      state.navigateToThread!({ ...thread, threadId: "another-thread" as ThreadId }),
    );
    expect(onNavigateAway).toHaveBeenCalledExactlyOnceWith("/environment-one/another-thread");
    expect(container.querySelector('[aria-label="Routed thread"]')?.textContent).toBe(id);
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Keep this child draft");
  },
);

it("prepares a background view after its projection arrives and retains its draft during reconnect", async () => {
  await render();
  expect(container.querySelector("textarea")).toBeNull();

  live();
  await render();
  await act(() => vi.advanceTimersByTimeAsync(32));
  const editor = container.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  editor.value = "Keep this draft";
  const revision = state.engineRevision;
  requestSnapshot.mockClear();

  state.projection = null;
  state.status = "synchronizing";
  await render();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this draft");
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(revision);
  expect(requestSnapshot).not.toHaveBeenCalled();

  state.mounted = false;
  await render();
  expect(container.querySelector("textarea")).toBeNull();
  state.mounted = true;
  await render();
  expect(container.querySelector("textarea")).toBeNull();
});

it("keeps unsynchronized content covered even without a composer readiness gate", async () => {
  state.composerMounted = false;
  await render(true);
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(container.querySelector("[data-spatial-preparing]")).not.toBeNull();
  expect(state.engineReady).toBe(false);
  expect(requestSnapshot).not.toHaveBeenCalled();

  live();
  await render(true, false);
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
  expect(state.engineReady).toBe(true);
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("keeps the focused view available while its first projection loads", async () => {
  await render(true);
  const editor = container.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  editor.value = "Draft while connecting";
  live();
  await render(true);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Draft while connecting");
});

it.each(["checkoutReady", "timelineReady"] as const)(
  "keeps the cover and postpones capture until %s settles",
  async (readiness) => {
    live();
    state[readiness] = false;
    await render(true);
    const editor = container.querySelector("textarea")!;
    editor.value = "Prepared draft";
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(container.querySelector("[data-spatial-preparing]")).not.toBeNull();
    expect(requestSnapshot).not.toHaveBeenCalled();

    state[readiness] = true;
    await render(true, false);
    expect(requestSnapshot).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(32));
    expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
    expect(requestSnapshot).toHaveBeenCalledOnce();
    expect(container.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Prepared draft");

    state.checkoutReady = false;
    await render(true);
    expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
  },
);

it("waits for the displayed sync row to clear before revealing or capturing the composer", async () => {
  await render(true, false);
  await act(() => vi.advanceTimersByTimeAsync(450));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  live();
  await render(true, false);
  await act(() => vi.advanceTimersByTimeAsync(349));
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  expect(container.querySelector("[data-spatial-preparing]")).not.toBeNull();
  expect(requestSnapshot).not.toHaveBeenCalled();

  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(requestSnapshot).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("retains the editor while a reconnect delays readiness and cancels the pending reveal", async () => {
  live();
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep through reconnect";
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  state.status = "synchronizing";
  await render(true);
  expect(container.querySelector("[data-spatial-preparing]")).not.toBeNull();
  state.status = "live";
  await render(true, false);
  await act(() => vi.advanceTimersByTimeAsync(16));
  state.status = "synchronizing";
  await render(true);
  expect(requestSnapshot).not.toHaveBeenCalled();
  state.status = "live";
  await render(true);
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep through reconnect");
});

it("releases deleted content without waiting for a ChatView readiness report", async () => {
  state.projection = null;
  state.status = "deleted";
  state.hasChatView = false;
  await render(true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
});

it("keeps a live editor presented while suspended content postpones new pictures", async () => {
  const { markPaneSynced } = await import("./useSavedPanePictures");
  live();
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep this draft while highlighting";
  const revision = state.engineRevision;
  expect(state.engineReady).toBe(true);
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  state.suspended = true;
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(revision);
  expect(markPaneSynced).toHaveBeenLastCalledWith(paneId, null, 0);
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this draft while highlighting");

  state.suspended = false;
  await render(true, false);
  expect(requestSnapshot).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).toBe(revision);
  expect(markPaneSynced).toHaveBeenLastCalledWith(
    paneId,
    {
      updatedAt: "2026-10-15T12:00:00.000Z",
      theme: "default|dark",
    },
    0,
  );
  expect(requestSnapshot).toHaveBeenCalledOnce();

  state.mounted = false;
  await render(true);
  expect(state.engineReady).toBe(false);
  expect(state.engineRevision).toBe(revision);
  state.mounted = true;
  state.suspended = true;
  await render(true);
  expect(state.engineReady).toBe(false);
  expect(state.engineRevision).toBe(revision);
  expect(container.querySelector("textarea")).not.toBe(editor);
  state.suspended = false;
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).toBe(revision);
});

it("reuses an unchanged picture through repeated focus changes without replacing the editor", async () => {
  live();
  state.interactive = true;
  await render(true);
  const editor = container.querySelector("textarea")!;
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  editor.value = "Keep this unsent draft";
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  await render(false);
  await render(true);
  await render(false);

  expect(requestSnapshot).toHaveBeenCalledTimes(3);
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this unsent draft");
});

it("requests replacement pixels after a resize without remounting live content", async () => {
  live();
  state.interactive = true;
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep my draft through resize";
  requestSnapshot.mockClear();
  snapshots = { ...snapshots, geometryVersion: snapshots.geometryVersion + 1 };
  await render(true);
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep my draft through resize");
});

it.each(["wheel", "scroll"])(
  "requests a picture refresh after %s input while the pane is active",
  async (event) => {
    live();
    state.interactive = true;
    await render(true);
    const editor = container.querySelector("textarea")!;
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    await act(() => editor.dispatchEvent(new Event(event, { bubbles: true })));
    expect(invalidateSnapshot).toHaveBeenCalledWith(paneId, true);
    expect(requestSnapshot).toHaveBeenCalled();

    await render(true);
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    await render(false);
    expect(invalidateSnapshot).not.toHaveBeenCalled();
  },
);

it("preserves a prepared picture when a workspace navigation key changes no content", async () => {
  live();
  state.interactive = true;
  await render(true);
  const button = container.querySelector("button")!;
  button.focus();
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  const revision = state.engineRevision;

  await act(() =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        code: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  expect(requestSnapshot).not.toHaveBeenCalled();
  await render(false);
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(state.engineRevision).toBe(revision);
  expect(container.querySelector("button")).toBe(button);
  expect(document.activeElement).not.toBe(button);
});

it("reuses pictures through composer navigation and refreshes changed styles", async () => {
  live();
  state.interactive = true;
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.focus();
  await act(async () => editor.classList.add("ProseMirror-focused"));
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  await act(() => {
    for (const key of ["Control", "Alt", "ArrowRight"])
      editor.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          code: key,
          ctrlKey: true,
          altKey: true,
          bubbles: true,
        }),
      );
  });
  await render(false);
  await act(async () => editor.classList.remove("ProseMirror-focused"));
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(document.activeElement).not.toBe(editor);

  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  await act(async () => editor.classList.add("text-lg"));
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  expect(requestSnapshot).toHaveBeenCalled();
});

it("refreshes a scrolled descendant at rest without predicting its keydown", async () => {
  live();
  state.interactive = true;
  await render(true);
  const panel = container.querySelector("aside")!;
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  const revision = state.engineRevision;

  await act(() =>
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true })),
  );
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  await act(() => {
    panel.scrollTop = 120;
    panel.dispatchEvent(new Event("scroll"));
  });
  expect(panel.scrollTop).toBe(120);
  expect(invalidateSnapshot).toHaveBeenCalledOnce();
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId, true);
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(state.engineRevision).not.toBe(revision);

  await render(false);
  expect(state.engineRevision).not.toBe(revision);
  expect(requestSnapshot).toHaveBeenCalled();
  expect(requestSnapshot).toHaveReturnedWith(1);
  expect(container.querySelector("aside")).toBe(panel);
  expect(panel.scrollTop).toBe(120);

  await render(true);
  invalidateSnapshot.mockClear();
  const refreshedRevision = state.engineRevision;
  await render(false);
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(state.engineRevision).toBe(refreshedRevision);
});

it("ignores repeated and temporary attribute writes but refreshes a changed presentation", async () => {
  live();
  await render(true);
  await render(false);
  const panel = container.querySelector("aside")!;
  const input = document.createElement("input");
  input.type = "file";
  await act(async () => panel.append(input));
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  await act(async () => {
    input.name = "";
    input.type = "file";
    input.removeAttribute("name");
    panel.setAttribute("aria-label", "Thread panel");
  });
  expect(requestSnapshot).not.toHaveBeenCalled();

  await act(async () => {
    panel.setAttribute("aria-label", "Thread panel");
    panel.setAttribute("style", "color: red");
    panel.setAttribute("aria-label", "Updated panel");
  });
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  expect(requestSnapshot).toHaveBeenCalled();
});

it("refreshes a picture when background content changes without a new message revision", async () => {
  live();
  await render(true);
  await render(false);
  expect(state.engineReady).toBe(true);
  const revision = state.engineRevision;
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  const panel = container.querySelector("aside")!;
  await act(async () => {
    panel.textContent = "Asynchronous content is ready";
  });
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  expect(requestSnapshot).toHaveBeenCalled();
  expect(state.engineRevision).not.toBe(revision);
});

it("refreshes a picture after a same-source image finishes loading in the background", async () => {
  live();
  await render(true);
  await render(false);
  expect(state.engineReady).toBe(true);
  const image = document.createElement("img");
  await act(async () => container.querySelector("aside")!.append(image));
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  await act(() => image.dispatchEvent(new Event("load")));
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  expect(requestSnapshot).toHaveBeenCalled();
});

it("keeps a closing panel present when the app route follows another pane", async () => {
  live();
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep this draft";
  await act(() => container.querySelector("button")!.click());
  expect(container.querySelector("aside")).not.toBeNull();
  const panelRenders = state.panelRenders;

  appSuppressed = true;
  await render(true, false);
  expect(container.querySelector("aside")).not.toBeNull();
  appSuppressed = false;
  await render(true, false);
  expect(state.panelRenders).toBe(panelRenders);
  await act(() => vi.advanceTimersByTimeAsync(199));
  expect(container.querySelector("aside")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(container.querySelector("aside")).toBeNull();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this draft");
});

it("suppresses panel motion until the pane's own initial paint, including after remount", async () => {
  live();
  await render(true, false);
  await act(() => container.querySelector("button")!.click());
  expect(container.querySelector("aside")).toBeNull();

  state.mounted = false;
  await render(true);
  state.mounted = true;
  await render(true, false);
  expect(container.querySelector("aside")).not.toBeNull();
  await act(() => container.querySelector("button")!.click());
  expect(container.querySelector("aside")).toBeNull();

  await act(() => vi.advanceTimersByTimeAsync(32));
  await act(() => container.querySelector("button")!.click());
  await act(() => container.querySelector("button")!.click());
  expect(container.querySelector("aside")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(container.querySelector("aside")).toBeNull();
});

it.each([
  { panelDurationMs: 0, reducedMotion: false },
  { panelDurationMs: 200, reducedMotion: true },
])(
  "closes panels immediately with $panelDurationMs ms and reduced motion $reducedMotion",
  async (settings) => {
    Object.assign(state, settings, {
      projection: { updatedAt: "2026-10-15T12:00:00.000Z" },
      status: "live",
    });
    await render(true);
    await act(() => container.querySelector("button")!.click());
    expect(container.querySelector("aside")).toBeNull();
  },
);

it.each(["route", "timeline", "suspended content"])(
  "keeps an arriving chat covered until %s is ready",
  async (pending) => {
    const { createPaneLifecycleStore } =
      await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
    lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], null);
    lifecycle.setMoving(true);
    lifecycle.setFocus(paneId);
    live();
    state.hasChatView = pending !== "route";
    state.timelineReady = pending !== "timeline";
    state.suspended = pending === "suspended content";
    await render(true, false, true);
    expect(state.engineReady).toBe(false);
    await act(() => lifecycle!.setMoving(false));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(state.engineReady).toBe(false);
    state.hasChatView = true;
    state.timelineReady = true;
    state.suspended = false;
    await render(true, false, true);
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(state.engineReady).toBe(true);
    expect(container.querySelector("textarea")).not.toBeNull();
  },
);

it("prepares a newly visible view during motion without waiting for idle", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setMoving(true);
  live();
  vi.stubGlobal("requestIdleCallback", () => 99);
  await render(false, false, true);
  expect(container.querySelector("textarea")).not.toBeNull();
  await act(() => lifecycle!.setMoving(false));
  expect(container.querySelector("textarea")).not.toBeNull();
});

it("cancels an offscreen content mount if motion starts before its idle callback", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  live();
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 50 }), 100),
  );
  lifecycle.setPictures(() => true);
  await render(false, false);
  await act(() => lifecycle!.setMoving(true));
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(container.querySelector("textarea")).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(container.querySelector("textarea")).not.toBeNull();
});

it("updates visible neighbors' clocks, pauses hidden content, and catches up on return", async () => {
  vi.setSystemTime("2026-10-23T12:00:30.000Z");
  state.showClock = true;
  state.interactive = true;
  live();
  await render(false, false, true);
  const minute = () => container.querySelector('[aria-label="Current minute"]')?.textContent;
  expect(minute()).toBe("2026-10-23T12:00");
  await act(() => vi.advanceTimersByTimeAsync(30_000));
  expect(minute()).toBe("2026-10-23T12:01");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(0);

  state.interactive = false;
  await render(false, false);
  await act(() => vi.advanceTimersByTimeAsync(120_000));
  expect(minute()).toBe("2026-10-23T12:01");
  state.interactive = true;
  await render(false, false, true);
  expect(minute()).toBe("2026-10-23T12:03");

  workspaceActive = false;
  await render(false, false, true);
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(minute()).toBe("2026-10-23T12:03");
  workspaceActive = true;
  await render(false, false, true);
  expect(minute()).toBe("2026-10-23T12:04");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(0);
});

it("keeps command-palette actions bound to the active composer's latest handle", async () => {
  state.interactive = true;
  await render(true);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(false);
  appComposerRef.current?.focusAtEnd();

  state.composerVersion = 1;
  await render(true);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(true);
  appComposerRef.current?.focusAtEnd();
  expect(state.composerActions).toEqual([0, 1]);
});

it("releases command-palette actions while content is shielded and restores them on arrival", async () => {
  state.interactive = true;
  await render(true);
  expect(appComposerRef.current).not.toBeNull();

  state.interactive = false;
  await render(true);
  expect(appComposerRef.current?.isModelPickerOpen() ?? false).toBe(false);
  appComposerRef.current?.focusAtEnd();
  expect(state.composerActions).toEqual([]);

  state.composerVersion = 1;
  state.interactive = true;
  await render(true);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(true);
  appComposerRef.current?.focusAtEnd();
  expect(state.composerActions).toEqual([1]);
});

it("leaves no stale composer handle after its view is evicted and accepts its replacement", async () => {
  state.interactive = true;
  await render(true);
  const previous = appComposerRef.current;

  state.mounted = false;
  await render(true);
  expect(appComposerRef.current?.isModelPickerOpen() ?? false).toBe(false);
  expect(appComposerRef.current).toBeNull();

  state.mounted = true;
  state.composerVersion = 1;
  await render(true);
  expect(appComposerRef.current).not.toBe(previous);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(true);
});

it("does not clear the next pane's composer when the departing pane releases its view", async () => {
  state.interactive = true;
  await render(true);
  const nextFocus = vi.fn<() => void>();
  const next = {
    isModelPickerOpen: (): boolean => true,
    focusAtEnd: () => nextFocus(),
  } as ChatComposerHandle;
  appComposerRef.current = next;

  state.interactive = false;
  state.mounted = false;
  await render(false);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(true);
  appComposerRef.current?.focusAtEnd();
  expect(nextFocus).toHaveBeenCalledOnce();
});

it("yields to a draft covering the workspace and reclaims its composer on return", async () => {
  state.interactive = true;
  await render(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(1);
  workspaceActive = false;
  await render(true);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(1);
  expect(appComposerRef.current).toBeNull();

  const draftFocus = vi.fn<() => void>();
  const draft = {
    isModelPickerOpen: (): boolean => true,
    focusAtEnd: () => draftFocus(),
  } as ChatComposerHandle;
  appComposerRef.current = draft;
  state.composerVersion = 2;
  await render(true);
  expect(appComposerRef.current).toBe(draft);
  appComposerRef.current?.focusAtEnd();
  expect(draftFocus).toHaveBeenCalledOnce();
  expect(state.composerActions).toEqual([]);

  Object.assign(appComposerRef, { current: null });
  workspaceActive = true;
  await render(true);
  appComposerRef.current?.focusAtEnd();
  expect(state.composerActions).toEqual([2]);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(2);
});

it("releases the active composer when the workspace unmounts", async () => {
  state.interactive = true;
  await render(true);
  expect(appComposerRef.current).not.toBeNull();
  await act(() => root.render(null));
  expect(appComposerRef.current).toBeNull();
});

it("returns from a covered eviction before a replacement composer is available", async () => {
  state.interactive = true;
  await render(true);
  const previous = appComposerRef.current;
  workspaceActive = false;
  state.mounted = false;
  await render(true);
  workspaceActive = true;
  await render(true);
  expect(appComposerRef.current).toBeNull();

  state.composerVersion = 1;
  state.mounted = true;
  await render(true);
  expect(appComposerRef.current).not.toBe(previous);
  expect(appComposerRef.current?.isModelPickerOpen()).toBe(true);
});

it("preserves an acknowledged scroll revision after its content is remounted", async () => {
  live();
  state.interactive = true;
  await render(true);
  const before = state.engineRevision;
  await act(() => container.querySelector("textarea")!.dispatchEvent(new Event("scroll")));
  expect(state.engineRevision).not.toBe(before);
  state.mounted = false;
  await render(false);
  expect(container.querySelector("textarea")).toBeNull();
  state.mounted = true;
  await render(false);
  expect(container.querySelector("textarea")).not.toBeNull();
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
});

it("reuses the picture revision when unchanged content is released and remounted", async () => {
  live();
  await render(true);
  const before = state.engineRevision;
  const revisions = [...state.engineRevisions];
  invalidateSnapshot.mockClear();
  state.mounted = false;
  await render(true);
  expect(state.engineReady).toBe(false);
  expect(state.engineRevision).toBe(before);
  expect(state.engineRevisions).toEqual(revisions);
  state.mounted = true;
  await render(true);
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).toBe(before);
  expect(state.engineRevisions).toEqual(revisions);
  expect(invalidateSnapshot).not.toHaveBeenCalled();
});

it("invalidates the picture revision when the shell changes while content is released", async () => {
  live();
  await render(true);
  const before = state.engineRevision;
  state.mounted = false;
  await render(false);
  expect(state.engineRevision).toBe(before);
  requestSnapshot.mockClear();

  state.shellUpdatedAt = "2026-10-15T12:01:00.000Z";
  await render(false);
  expect(state.engineReady).toBe(false);
  expect(state.engineRevision).not.toBe(before);
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it("invalidates the picture revision when mounted projection changes", async () => {
  live();
  await render(true);
  const before = state.engineRevision;
  const editor = container.querySelector("textarea");
  requestSnapshot.mockClear();

  state.projection = { updatedAt: "2026-10-15T12:01:00.000Z" };
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("invalidates the picture revision when remounted projection has changed", async () => {
  live();
  await render(true);
  const before = state.engineRevision;
  const revisions = [...state.engineRevisions];
  state.mounted = false;
  await render(false);
  expect(state.engineRevisions).toEqual(revisions);

  state.projection = { updatedAt: "2026-10-15T12:01:00.000Z" };
  state.mounted = true;
  await render(true);
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(state.engineRevisions).toEqual([...revisions, state.engineRevision]);
});

it("invalidates the picture revision when subscribed projection is deleted", async () => {
  live();
  await render(true);
  const before = state.engineRevision;
  requestSnapshot.mockClear();

  state.projection = null;
  state.status = "deleted";
  state.hasChatView = false;
  await render(true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
  "defers shell and projection picture revisions while the runtime is %s",
  async (status) => {
    live();
    await render(true);
    const before = state.engineRevision;
    requestSnapshot.mockClear();

    state.runtimeStatus = status;
    state.shellUpdatedAt = "2026-10-15T12:01:00.000Z";
    state.projection = { updatedAt: "2026-10-15T12:01:00.000Z" };
    await render(true);
    expect(state.engineRevision).toBe(before);
    expect(requestSnapshot).not.toHaveBeenCalled();

    state.runtimeStatus = null;
    await render(true);
    expect(state.engineReady).toBe(true);
    expect(state.engineRevision).not.toBe(before);
    expect(requestSnapshot).toHaveBeenCalledOnce();
  },
);

it("retains the presented editor while earlier history loads and waits for its final layout", async () => {
  const { markPaneSynced } = await import("./useSavedPanePictures");
  live();
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep this draft during paging";
  const revision = state.engineRevision;
  requestSnapshot.mockClear();

  state.historyLoading = true;
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(revision);
  expect(markPaneSynced).toHaveBeenLastCalledWith(paneId, null, 0);
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this draft during paging");

  state.historyLoading = false;
  await render(true, false);
  expect(requestSnapshot).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(requestSnapshot).toHaveBeenCalledOnce();
  expect(container.querySelector("textarea")).toBe(editor);
});

it("focuses the stock composer on keyboard navigation arrival and cancels on pointer intent", async () => {
  live();
  await render(true, false, true);
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true })),
  );
  expect(state.composerActions).toEqual([]);
  state.interactive = true;
  await render(true, false, true);
  expect(state.composerActions).toEqual([0]);
  state.interactive = false;
  await render(true, false, true);
  await act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true })),
  );
  await act(() => window.dispatchEvent(new Event("pointerdown")));
  state.interactive = true;
  await render(true, false, true);
  expect(state.composerActions).toEqual([0]);
});

it("keeps current-picture transit content dormant, then admits it when retargeted", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setPictures(() => true);
  lifecycle.setMoving(true);
  live();
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBeNull();
  await render(false, false, true, true);
  expect(container.querySelector("textarea")).not.toBeNull();
  const editor = container.querySelector("textarea")!;
  editor.value = "retained draft";
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("retained draft");
});

it("admits a transit pane when its current picture becomes stale during motion", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setPictures(() => true);
  lifecycle.setMoving(true);
  live();
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBeNull();
  await act(() =>
    lifecycle!.setPictures(
      () => false,
      true,
      () => true,
      () => true,
    ),
  );
  expect(container.querySelector("textarea")).not.toBeNull();
});

it("commits one required motion-time chat at a time with the destination first", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  const panes = [0, 1, 2].map((slot) => ({ paneId: `p${slot}`, plane: 0, slot }));
  lifecycle = createPaneLifecycleStore(panes, "p2");
  lifecycle.setPictures(() => false);
  lifecycle.setMoving(true);
  live();
  const commits: string[][] = [];
  await act(async () => {
    root.render(
      <PaneLifecycleContext value={lifecycle}>
        <Profiler
          id="admissions"
          onRender={() => {
            commits.push(
              [...container.querySelectorAll("textarea")].map((editor) =>
                editor.closest("[data-test-pane]")!.getAttribute("data-test-pane")!,
              ),
            );
          }}
        >
          {[0, 1, 2].map((slot) => (
            <div key={slot} data-test-pane={`p${slot}`}>
              <ThreadPane
                paneId={`p${slot}`}
                thread={thread}
                focused={slot === 2}
                visible
                settledVisible
                onNavigateAway={onNavigateAway}
              />
            </div>
          ))}
        </Profiler>
      </PaneLifecycleContext>,
    );
  });
  const additions = commits
    .map((ids, index) =>
      ids.filter((id) => !commits.slice(0, index).some((earlier) => earlier.includes(id))),
    )
    .filter((ids) => ids.length);
  expect(additions).toEqual([["p2"], ["p1"], ["p0"]]);
});
