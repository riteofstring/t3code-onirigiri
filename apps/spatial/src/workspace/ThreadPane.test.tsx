// @vitest-environment jsdom
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { PanelAnimationSuppressionProvider } from "@t3tools/web/src/panelAnimations";

import { ThreadPane } from "./ThreadPane";
import { PaneLifecycleContext, type PaneLifecycleStore } from "./paneLifecycle";

const state = vi.hoisted(() => ({
  mounted: true,
  detail: null as { updatedAt: string } | null,
  status: "synchronizing" as "synchronizing" | "live" | "deleted",
  panelDurationMs: 200,
  reducedMotion: false,
  panelRenders: 0,
}));

vi.mock("@riteofstring/onirigiri", () => ({
  useOnirigiriPaneContentReady: () => {},
  useOnirigiriPaneInteractive: () => false,
}));
vi.mock("./paneLifecycle", async () => {
  const { createContext } = await import("react");
  return { PaneLifecycleContext: createContext(null), usePaneMounted: () => state.mounted };
});
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: () => ({ updatedAt: "u1", latestTurn: null }),
  useThreadDetail: () => state.detail,
  useThreadStatus: () => state.status,
}));
vi.mock("./useSavedPanePictures", async () => {
  const { createContext } = await import("react");
  return {
    PaneSnapshotContext: createContext(null),
    markPaneSynced: () => {},
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
  const { useState } = await import("react");
  const { usePanelAnimationSettings, usePanelPresence } =
    await import("@t3tools/web/src/panelAnimations");
  return {
    ThreadRouteView: () => {
      state.panelRenders++;
      const [open, setOpen] = useState(true);
      const { active, durationMs } = usePanelAnimationSettings();
      const panel = usePanelPresence(open, "Restored panel", active, "thread-one", durationMs);
      return (
        <>
          <textarea aria-label="Draft" />
          <button onClick={() => setOpen(!open)}>{open ? "Close panel" : "Open panel"}</button>
          {panel.present ? <aside aria-label="Thread panel">{panel.value}</aside> : null}
        </>
      );
    },
  };
});

let root: Root;
let container: HTMLDivElement;
let lifecycle: PaneLifecycleStore | null;
let paneId: string;
let appSuppressed: boolean;

async function render(focused = false, paintFrames = true) {
  await act(async () => {
    root.render(
      <PanelAnimationSuppressionProvider value={appSuppressed}>
        <PaneLifecycleContext value={lifecycle}>
          <ThreadPane
            paneId={paneId}
            thread={{
              environmentId: "environment-one" as EnvironmentId,
              threadId: "thread-one" as ThreadId,
            }}
            focused={focused}
            visible={focused}
            onNavigateAway={() => {}}
          />
        </PaneLifecycleContext>
      </PanelAnimationSuppressionProvider>,
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
  state.detail = null;
  state.status = "synchronizing";
  state.panelDurationMs = 200;
  state.reducedMotion = false;
  state.panelRenders = 0;
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
  const editor = container.querySelector("textarea")!;
  expect(editor).not.toBeNull();
  editor.value = "Keep this draft";

  state.detail = null;
  state.status = "synchronizing";
  await render();
  expect(container.querySelector("textarea")).toBe(editor);
  expect(editor.value).toBe("Keep this draft");

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
