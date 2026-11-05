// @vitest-environment jsdom
import type { ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ScopedThreadRef, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act } from "react";
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
import { COMPOSER_NAVIGATION } from "./composerNavigation";
import { PaneLifecycleContext, type PaneLifecycleStore } from "./paneLifecycle";
import { PaneSnapshotContext, type RequestPaneSnapshot } from "./useSavedPanePictures";

const state = vi.hoisted(() => ({
  revision: 0,
  mounted: true,
  interactive: false,
  composerVersion: 0,
  composerActions: [] as number[],
  activeKeys: 0,
  showClock: false,
  shellUpdatedAt: "2026-10-15T12:00:00.000Z",
  runtimeStatus: null as ThreadRuntimeSummary["status"] | null,
  historyLoading: false,
  pendingApproval: false,
  pendingQuestion: false,
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
  projectionSubscribed: false,
  historySubscribed: false,
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
vi.mock("@t3tools/web/src/state/entities", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useThreadShell: () => {
      useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener);
          return () => {
            state.listeners.delete(listener);
          };
        },
        () => state.revision,
      );
      return {
        updatedAt: state.shellUpdatedAt,
        hasPendingApprovals: state.pendingApproval,
        hasPendingUserInput: state.pendingQuestion,
        runtime: state.runtimeStatus ? { status: state.runtimeStatus } : null,
      };
    },
    useThreadProjection: (ref: ScopedThreadRef | null) => {
      state.projectionSubscribed = ref !== null;
      return ref === null || state.projection === null
        ? null
        : { projection: { updatedAt: DateTime.makeUnsafe(state.projection.updatedAt) } };
    },
    useThreadHistory: (ref: ScopedThreadRef | null) => {
      state.historySubscribed = ref !== null;
      return { loading: state.historyLoading };
    },
    useThreadStatus: (ref: ScopedThreadRef | null) => (ref === null ? "empty" : state.status),
  };
});
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
        if (["x", "y", "z"].includes(event.key)) state.activeKeys += 1;
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
          insertTextAtEnd: (text: string) => {
            const editor = document.querySelector<HTMLTextAreaElement>('[aria-label="Draft"]');
            if (!editor) return false;
            editor.value += text;
            return true;
          },
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
        <div data-chat-composer-surface="true">
          <textarea aria-label="Draft" className="composer-tiptap" data-testid="composer-editor" />
        </div>
        <div className="messages-timeline-scroll" />
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
  hasFreshPicture: (paneId: string) => boolean;
  pictureMiss: (paneId: string) => string | null;
  geometryVersion: number;
  timelinePicture: () => { url: string; width: number; height: number } | null;
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
    state.revision++;
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
  state.pendingApproval = false;
  state.pendingQuestion = false;
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
    hasFreshPicture: () => true,
    pictureMiss: () => null,
    geometryVersion: 0,
    timelinePicture: () => null,
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
  vi.unstubAllEnvs();
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

it("keeps shown content and the editor through a reconnect without taking pictures", async () => {
  live();
  await render(true);
  const editor = container.querySelector("textarea")!;
  editor.value = "Keep through reconnect";
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  state.status = "synchronizing";
  await render(true);
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
  state.status = "live";
  await render(true, false);
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
  "preserves its picture after %s without a scroll offset change",
  async (event) => {
    live();
    state.interactive = true;
    await render(true);
    const editor = container.querySelector("textarea")!;
    requestSnapshot.mockClear();
    invalidateSnapshot.mockClear();
    await act(() => editor.dispatchEvent(new Event(event, { bubbles: true })));
    expect(invalidateSnapshot).not.toHaveBeenCalled();
    expect(requestSnapshot).not.toHaveBeenCalled();

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

it("keeps the current picture when only input caret visibility changes", async () => {
  live();
  state.interactive = true;
  await render(true);
  const editor = container.querySelector("textarea")!;
  const input = document.createElement("input");
  input.hidden = true;
  input.style.width = "1px";
  await act(async () => editor.parentElement!.append(input));
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();
  for (const element of [editor, input]) {
    await act(async () => element.style.setProperty("caret-color", "transparent", "important"));
    await act(async () => element.style.removeProperty("caret-color"));
  }
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(requestSnapshot).not.toHaveBeenCalled();

  await act(async () => editor.style.setProperty("font-size", "20px"));
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId, true);
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
  const surface = container.querySelector<HTMLElement>('[data-chat-composer-surface="true"]')!;
  surface.setAttribute("aria-label", "Composer");
  const input = document.createElement("input");
  input.type = "file";
  await act(async () => surface.append(input));
  requestSnapshot.mockClear();
  invalidateSnapshot.mockClear();

  await act(async () => {
    input.name = "";
    input.type = "file";
    input.removeAttribute("name");
    surface.setAttribute("aria-label", "Composer");
  });
  expect(requestSnapshot).not.toHaveBeenCalled();

  await act(async () => {
    surface.setAttribute("aria-label", "Composer");
    surface.setAttribute("style", "color: red");
    surface.setAttribute("aria-label", "Updated composer");
  });
  expect(invalidateSnapshot).toHaveBeenCalledWith(paneId);
  expect(requestSnapshot).toHaveBeenCalled();
});

it("keeps the picture through content changes outside the composer until an expansion changes", async () => {
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
    panel.setAttribute("style", "color: red");
  });
  expect(invalidateSnapshot).not.toHaveBeenCalled();
  expect(requestSnapshot).not.toHaveBeenCalled();
  expect(state.engineRevision).toBe(revision);

  await act(async () => panel.setAttribute("aria-expanded", "true"));
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
  "exposes an arriving composer independently of pending %s",
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
    expect(state.engineReady).toBe(pending !== "route");
    expect(requestSnapshot).not.toHaveBeenCalled();
    state.hasChatView = true;
    state.timelineReady = true;
    state.suspended = false;
    await render(true, false, true);
    await act(() => vi.advanceTimersByTimeAsync(40));
    expect(state.engineReady).toBe(true);
    expect(container.querySelector("textarea")).not.toBeNull();
  },
);

it.each([
  { fresh: true, delay: 300 },
  { fresh: false, delay: 0 },
])(
  "defers a newly visible view until motion stops, then $delay ms more with a fresh picture: $fresh",
  async ({ fresh, delay }) => {
    const { createPaneLifecycleStore } =
      await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
    lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
    lifecycle.setMoving(true);
    live();
    snapshots.hasFreshPicture = () => fresh;
    vi.stubGlobal("requestIdleCallback", () => 99);
    await render(false, false, true);
    expect(container.querySelector("textarea")).toBeNull();
    await act(() => lifecycle!.setMoving(false));
    if (delay > 0) {
      expect(container.querySelector("textarea")).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(delay - 1));
      expect(container.querySelector("textarea")).toBeNull();
      await act(() => vi.advanceTimersByTimeAsync(1));
    }
    expect(container.querySelector("textarea")).not.toBeNull();
  },
);

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
  snapshots.hasFreshPicture = () => false;
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
  await act(() => {
    const editor = container.querySelector("textarea")!;
    editor.scrollTop = 120;
    editor.dispatchEvent(new Event("scroll"));
  });
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

it("focuses the stock composer after an adapter-approved editing navigation", async () => {
  live();
  await render(true, false, true);
  await act(() => window.dispatchEvent(new Event(COMPOSER_NAVIGATION)));
  expect(state.composerActions).toEqual([]);
  state.interactive = true;
  await render(true, false, true);
  expect(state.composerActions).toEqual([0]);
});

it("keeps transit content dormant until rest and then retains its editor", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setPictures(() => true);
  lifecycle.setMoving(true);
  live();
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBeNull();
  await render(false, false, true, true);
  expect(container.querySelector("textarea")).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  await act(() => vi.advanceTimersByTimeAsync(300));
  expect(container.querySelector("textarea")).not.toBeNull();
  const editor = container.querySelector("textarea")!;
  editor.value = "retained draft";
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("retained draft");
});

it("does not mount a stale transit pane until motion stops", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  lifecycle.setPictures(() => true);
  lifecycle.setMoving(true);
  live();
  await render(false, false, true, false);
  expect(container.querySelector("textarea")).toBeNull();
  snapshots.hasFreshPicture = () => false;
  await act(() =>
    lifecycle!.setPictures(
      () => false,
      true,
      () => true,
      () => true,
    ),
  );
  expect(container.querySelector("textarea")).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  expect(container.querySelector("textarea")).not.toBeNull();
});

it.each([false, true])("restores the timeline after content release, at end: %s", async (atEnd) => {
  live();
  await render(true);
  const scroller = container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
  Object.defineProperties(scroller, {
    scrollHeight: { value: 1000 },
    clientHeight: { value: 200 },
  });
  scroller.scrollTop = atEnd ? 800 : 320;
  state.mounted = false;
  await render(false);
  expect(container.querySelector(".messages-timeline-scroll")).toBeNull();
  state.mounted = true;
  state.timelineReady = false;
  await render(true);
  const restored = container.querySelector<HTMLElement>(".messages-timeline-scroll")!;
  Object.defineProperties(restored, {
    scrollHeight: { value: 1200 },
    clientHeight: { value: 200 },
  });
  state.timelineReady = true;
  await render(true);
  await act(() => vi.advanceTimersByTimeAsync(64));
  expect(restored.scrollTop).toBe(atEnd ? 1000 : 320);
});

it("admits a nonfocused pane from readiness metadata before subscribing to heavy content", async () => {
  await render(false, false);
  expect(state.projectionSubscribed).toBe(false);
  expect(state.historySubscribed).toBe(false);
  live();
  await render(false);
  expect(container.querySelector("textarea")).not.toBeNull();
  expect(state.projectionSubscribed).toBe(true);
  expect(state.historySubscribed).toBe(true);
  state.mounted = false;
  await render(false);
  expect(state.projectionSubscribed).toBe(false);
  expect(state.historySubscribed).toBe(false);
});

it("finishes preparation after one idle slice even with little time remaining", async () => {
  vi.stubGlobal("requestIdleCallback", (callback: IdleRequestCallback) =>
    setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 1 }), 0),
  );
  live();
  await render(true);
  expect(state.engineReady).toBe(true);
  expect(container.querySelector("[data-spatial-preparing]")).toBeNull();
});

it("keeps a focused retained composer inactive during camera motion", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  live();
  state.interactive = true;
  await render(false);
  const editor = container.querySelector("textarea");
  await act(() => lifecycle!.setMoving(true));
  await render(true, false);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(0);
  expect(appComposerRef.current).toBeNull();
  expect(container.querySelector("textarea")).toBe(editor);
});

it("binds the destination and admits three keys on the camera stop edge", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  live();
  state.interactive = true;
  await render(false);
  await act(() => lifecycle!.setMoving(true));
  await render(true, false);
  await act(() => window.dispatchEvent(new Event(COMPOSER_NAVIGATION)));
  expect(appComposerRef.current).toBeNull();
  await act(() => lifecycle!.setMoving(false));
  expect(appComposerRef.current).not.toBeNull();
  expect(state.composerActions).toEqual([0]);
  for (const key of "xyz") window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  expect(state.activeKeys).toBe(3);
});

it("deactivates and reactivates same-focus motion without pointer motion", async () => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  live();
  state.interactive = true;
  await render(true);
  const handle = appComposerRef.current;
  await act(() => lifecycle!.setMoving(true));
  expect(appComposerRef.current).toBeNull();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(0);
  await act(() => lifecycle!.setMoving(false));
  expect(appComposerRef.current).toBe(handle);
  await act(() => window.dispatchEvent(new Event("pointerdown")));
  expect(lifecycle.isMoving()).toBe(true);
  expect(appComposerRef.current).toBe(handle);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(1);
});

it("keeps immediate composer activity with a null lifecycle", async () => {
  live();
  state.interactive = true;
  await render(true, false);
  expect(appComposerRef.current).not.toBeNull();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  expect(state.activeKeys).toBe(1);
});

it.each(["input", "pointerdown", "click", "keydown", "drop", "paste", "expansion"])(
  "keeps local %s state live, including queued descendant mutations",
  async (signal) => {
    const { createPaneLifecycleStore } =
      await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
    lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
    const registration = vi.spyOn(lifecycle, "registerChat");
    snapshots.timelinePicture = () => ({ url: "blob:current", width: 800, height: 600 });
    live();
    await render(true);
    const inspect = registration.mock.calls.at(-1)![1];
    expect(inspect()).toBeNull();
    await act(() => {
      const editor = container.querySelector("textarea")!;
      if (signal === "expansion") {
        const child = container.querySelector(".messages-timeline-scroll")!;
        child.setAttribute("aria-expanded", "true");
      } else {
        editor.dispatchEvent(
          signal === "keydown"
            ? new KeyboardEvent("keydown", { key: "a", bubbles: true })
            : new Event(signal, { bubbles: true }),
        );
      }
      expect(inspect()).toBe("local-ui-interaction");
    });
  },
);

it.each(["approval", "question"])("keeps a pending %s live", async (kind) => {
  const { createPaneLifecycleStore } =
    await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
  lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
  const registration = vi.spyOn(lifecycle, "registerChat");
  state.pendingApproval = kind === "approval";
  state.pendingQuestion = kind === "question";
  live();
  await render(true);
  expect(registration.mock.calls.at(-1)![1]()).toBe(`pending-${kind}`);
});

it.each(["live", "deleted"] as const)(
  "only releases a missing composer after the %s view is ready",
  async (status) => {
    const { createPaneLifecycleStore } =
      await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
    lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
    const ready = vi.spyOn(lifecycle, "composerReady");
    live();
    state.status = status;
    state.hasChatView = false;
    state.interactive = true;
    await render(true);
    expect(ready).toHaveBeenCalledTimes(status === "deleted" ? 1 : 0);
  },
);

it.each([true, false])(
  "retains first-stop typing with keyboard intent %s until the stock composer can accept it",
  async (keyboardIntent) => {
    const { createPaneLifecycleStore } =
      await vi.importActual<typeof import("./paneLifecycle")>("./paneLifecycle");
    lifecycle = createPaneLifecycleStore([{ paneId, plane: 0, slot: 0 }], paneId);
    live();
    state.mounted = false;
    await render(true, false, true);
    if (keyboardIntent) await act(() => window.dispatchEvent(new Event(COMPOSER_NAVIGATION)));
    for (const key of ["x", "y", "Backspace", "z"]) {
      const event = new KeyboardEvent("keydown", { key, cancelable: true });
      await act(() => window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    state.mounted = true;
    state.checkoutReady = false;
    state.interactive = true;
    await render(true, false, true);
    expect(state.composerActions).toEqual([]);
    expect(container.querySelector("textarea")?.value).toBe("");
    state.checkoutReady = true;
    await render(true, false, true);
    expect(container.querySelector("textarea")?.value).toBe("xz");
    expect(state.composerActions).toEqual([0]);
    await render(true, false, true);
    expect(container.querySelector("textarea")?.value).toBe("xz");
  },
);
