// @vitest-environment jsdom
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { PanelAnimationSuppressionProvider } from "@t3tools/web/src/panelAnimations";

import {
  ComposerHandleContext,
  type ComposerHandleRef,
} from "@t3tools/web/src/composerHandleContext";
import type { ChatComposerHandle } from "@t3tools/web/src/components/chat/ChatComposer";

import { SpatialWorkspaceActiveContext, ThreadPane } from "./ThreadPane";
import { PaneLifecycleContext, type PaneLifecycleStore } from "./paneLifecycle";
import { PaneSnapshotContext, type RequestPaneSnapshot } from "./useSavedPanePictures";

const state = vi.hoisted(() => ({
  mounted: true,
  interactive: false,
  composerVersion: 0,
  composerActions: [] as number[],
  activeKeys: 0,
  shellUpdatedAt: "u1",
  running: false,
  detail: null as { updatedAt: string } | null,
  status: "synchronizing" as "synchronizing" | "live" | "deleted",
  panelDurationMs: 200,
  reducedMotion: false,
  panelRenders: 0,
  checkoutReady: true,
  timelineReady: true,
  hasChatView: true,
  suspended: false,
  engineReady: false,
  engineRevision: "",
  engineRevisions: [] as string[],
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
    latestTurn: state.running ? { state: "running" } : null,
  }),
  useThreadDetail: (ref: ScopedThreadRef | null) => (ref === null ? null : state.detail),
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
vi.mock("./panePictureSnapshot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./panePictureSnapshot")>()),
  canCapturePanes: () => false,
}));
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
  const { useComposerHandleContext } = await import("@t3tools/web/src/composerHandleContext");
  const { usePanelAnimationSettings, usePanelPresence } =
    await import("@t3tools/web/src/panelAnimations");
  const { ChatViewPendingContent, useChatViewContentReady, useComposerSyncPhase } =
    await import("@t3tools/web/src/components/chatViewContentReady");
  const { useActiveChatViewEffect } = await import("@t3tools/web/src/components/chatViewActivity");
  function ChatContent() {
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
    );
    const shownSyncPhase = useComposerSyncPhase(
      "thread-one",
      state.status === "synchronizing" ? "syncing" : null,
      onSyncReadyChange,
    );
    return (
      <>
        {state.suspended ? <ChatViewPendingContent /> : null}
        <textarea aria-label="Draft" className="composer-tiptap" data-testid="composer-editor" />
        {shownSyncPhase ? <span role="status">Syncing messages</span> : null}
        <button onClick={() => setOpen(!open)}>{open ? "Close panel" : "Open panel"}</button>
        {panel.present ? <aside aria-label="Thread panel">{panel.value}</aside> : null}
      </>
    );
  }
  return {
    ThreadRouteView: () => {
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => state.listeners.delete(listener);
        },
        () =>
          `${state.status}:${state.checkoutReady}:${state.timelineReady}:${state.hasChatView}:${state.composerVersion}:${state.suspended}`,
      );
      return state.hasChatView ? <ChatContent /> : null;
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

async function render(focused = false, paintFrames = true, visible = focused) {
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
                  thread={{
                    environmentId: "environment-one" as EnvironmentId,
                    threadId: "thread-one" as ThreadId,
                  }}
                  focused={focused}
                  visible={visible}
                  onNavigateAway={() => {}}
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
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", clearTimeout);
  lifecycle = null;
  paneId = "thread:environment-one:thread-one";
  state.mounted = true;
  state.interactive = false;
  state.composerVersion = 0;
  state.composerActions = [];
  state.activeKeys = 0;
  appComposerRef = { current: null };
  workspaceActive = true;
  state.shellUpdatedAt = "u1";
  state.running = false;
  state.detail = null;
  state.status = "synchronizing";
  state.panelDurationMs = 200;
  state.reducedMotion = false;
  state.panelRenders = 0;
  state.checkoutReady = true;
  state.timelineReady = true;
  state.hasChatView = true;
  state.suspended = false;
  state.engineReady = false;
  state.engineRevision = "";
  state.engineRevisions = [];
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

it("prepares a background view after its detail arrives and retains its draft during reconnect", async () => {
  await render();
  expect(container.querySelector("textarea")).toBeNull();

  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render();
  await act(() => vi.advanceTimersByTimeAsync(32));
  const editor = container.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  editor.value = "Keep this draft";
  const revision = state.engineRevision;
  requestSnapshot.mockClear();

  state.detail = null;
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

it("keeps the focused view available while its first detail loads", async () => {
  await render(true);
  const editor = container.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  editor.value = "Draft while connecting";
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Draft while connecting");
});

it.each(["checkoutReady", "timelineReady"] as const)(
  "keeps the cover and postpones capture until %s settles",
  async (readiness) => {
    state.detail = { updatedAt: "u1" };
    state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = null;
  state.status = "deleted";
  state.hasChatView = false;
  await render(true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
});

it("keeps a live editor presented while suspended content postpones new pictures", async () => {
  const { markPaneSynced } = await import("./useSavedPanePictures");
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
      updatedAt: "u1",
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  "defers a picture refresh after %s input until departure and reuses an unchanged visit",
  async (event) => {
    state.detail = { updatedAt: "u1" };
    state.status = "live";
    state.interactive = true;
    await render(true);
    const editor = container.querySelector("textarea")!;
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    const revision = state.engineRevision;
    await act(() => editor.dispatchEvent(new Event(event, { bubbles: true })));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(requestSnapshot).not.toHaveBeenCalled();
    expect(state.engineRevision).toBe(revision);
    await render(false);
    expect(state.engineRevision).not.toBe(revision);
    expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
    expect(requestSnapshot).toHaveBeenCalled();

    await render(true);
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    await render(false);
    expect(invalidateSnapshot).not.toHaveBeenCalled();
  },
);

it("reuses pictures when navigation starts in the composer but refreshes keyboard scrolling", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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

  for (const options of [
    { key: "Home", ctrlKey: true },
    { key: "ArrowDown", altKey: true },
    { key: "ArrowUp", altKey: true, shiftKey: true },
  ]) {
    await render(true);
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    await act(() =>
      editor.dispatchEvent(new KeyboardEvent("keydown", { ...options, bubbles: true })),
    );
    await render(false);
    expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  }
});

it("ignores repeated and temporary attribute writes but refreshes a changed presentation", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
    Object.assign(state, settings, { detail: { updatedAt: "u1" }, status: "live" });
    await render(true);
    await act(() => container.querySelector("button")!.click());
    expect(container.querySelector("aside")).toBeNull();
  },
);

it("starts the next queued preparation only after the deferred view commits", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore(
    [0, 1, 2].map((slot) => ({ paneId: `p${slot}`, plane: 0, slot })),
    "p0",
  );
  lifecycle.setPictures(() => true);
  // Let the neighbor's settle timer and idle mount run.
  vi.advanceTimersByTime(650);
  expect(lifecycle.isMounted("p1")).toBe(true);
  lifecycle.setPictures(() => false);
  lifecycle.setVisible("p2", true);
  // Rebuild the wanted queue while the first view is still waiting for detail.
  vi.advanceTimersByTime(250);
  paneId = "p1";
  await render();
  expect(container.querySelector("textarea")).toBeNull();
  expect(lifecycle.isMounted("p2")).toBe(false);

  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render();
  expect(container.querySelector("textarea")).not.toBeNull();
  await act(async () => {
    await vi.advanceTimersToNextTimerAsync();
  });
  expect(lifecycle.isMounted("p2")).toBe(true);
});

it("holds a visible prepared view through motion and renders at rest without waiting for idle", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setMoving(true);
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  vi.stubGlobal("requestIdleCallback", () => 99);
  await render(false, false, true);
  expect(container.querySelector("textarea")).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  expect(container.querySelector("textarea")).not.toBeNull();
});

it("cancels an offscreen content mount if motion starts before its idle callback", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => setTimeout(callback, 100));
  await render(false, false);
  await act(() => lifecycle!.setMoving(true));
  await act(() => vi.advanceTimersByTimeAsync(150));
  expect(container.querySelector("textarea")).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  await act(() => vi.advanceTimersByTimeAsync(100));
  expect(container.querySelector("textarea")).not.toBeNull();
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

it("publishes a pending scroll revision after its content is remounted", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  state.interactive = true;
  await render(true);
  const before = state.engineRevision;
  await act(() => container.querySelector("textarea")!.dispatchEvent(new Event("scroll")));
  expect(state.engineRevision).toBe(before);
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
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
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  const before = state.engineRevision;
  state.mounted = false;
  await render(false);
  expect(state.engineRevision).toBe(before);
  requestSnapshot.mockClear();

  state.shellUpdatedAt = "u2";
  await render(false);
  expect(state.engineReady).toBe(false);
  expect(state.engineRevision).not.toBe(before);
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it("invalidates the picture revision when mounted detail changes", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  const before = state.engineRevision;
  const editor = container.querySelector("textarea");
  requestSnapshot.mockClear();

  state.detail = { updatedAt: "u2" };
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(requestSnapshot).toHaveBeenCalledOnce();
});

it("invalidates the picture revision when remounted detail has changed", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  const before = state.engineRevision;
  const revisions = [...state.engineRevisions];
  state.mounted = false;
  await render(false);
  expect(state.engineRevisions).toEqual(revisions);

  state.detail = { updatedAt: "u2" };
  state.mounted = true;
  await render(true);
  await act(() => vi.advanceTimersByTimeAsync(32));
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(state.engineRevisions).toEqual([...revisions, state.engineRevision]);
});

it("invalidates the picture revision when subscribed detail is deleted", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  const before = state.engineRevision;
  requestSnapshot.mockClear();

  state.detail = null;
  state.status = "deleted";
  state.hasChatView = false;
  await render(true);
  expect(container.querySelector("textarea")).toBeNull();
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(requestSnapshot).not.toHaveBeenCalled();
});

it("defers shell and detail picture revisions until a running turn settles", async () => {
  state.detail = { updatedAt: "u1" };
  state.status = "live";
  await render(true);
  const before = state.engineRevision;
  requestSnapshot.mockClear();

  state.running = true;
  state.shellUpdatedAt = "u2";
  state.detail = { updatedAt: "u2" };
  await render(true);
  expect(state.engineRevision).toBe(before);
  expect(requestSnapshot).not.toHaveBeenCalled();

  state.running = false;
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(state.engineRevision).not.toBe(before);
  expect(requestSnapshot).toHaveBeenCalledOnce();
});
