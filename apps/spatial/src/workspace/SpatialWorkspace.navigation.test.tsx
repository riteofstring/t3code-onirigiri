// @vitest-environment jsdom
import type { OnirigiriPaneDefinition } from "@riteofstring/onirigiri";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SpatialWorkspace } from "./SpatialWorkspace";
import { readPaneLayout, threadLayoutPositions } from "./workspaceLayout";

type RouteLocation = { environmentId: string; threadId: string };
type NavigationEvent = { toLocation: RouteLocation };

const fixture = vi.hoisted(() => ({
  panes: [] as OnirigiriPaneDefinition[],
  loaded: true,
  bindWorkspace: vi.fn<(target: { focusPane: (id: string) => void } | null) => void>(),
  routeListeners: new Set<(event: NavigationEvent) => void>(),
  navigate: vi.fn<(input: { params: RouteLocation }) => Promise<void>>(),
  pictureLayoutChanged: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => {
  const router = {
    navigate: fixture.navigate,
    matchRoutes: (location: RouteLocation) => [
      { routeId: "/_chat/$environmentId/$threadId", params: location },
    ],
    subscribe: (_event: string, listener: (event: NavigationEvent) => void) => {
      fixture.routeListeners.add(listener);
      return () => fixture.routeListeners.delete(listener);
    },
  };
  return { useRouter: () => router };
});
vi.mock("@t3tools/web/src/state/terminal", () => ({ terminalEnvironment: { close: {} } }));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("./useWorkspacePanes", () => ({
  useWorkspacePanes: () => (fixture.loaded ? fixture.panes : null),
  threadPaneId: (environmentId: string, threadId: string) => `thread:${environmentId}:${threadId}`,
}));
vi.mock("./useToolPanes", () => {
  const tools = { toolPanes: [], addEmpty: vi.fn(), choose: vi.fn(), remove: vi.fn() };
  return { useToolPanes: () => tools };
});
vi.mock("./SpatialSurfaceProvider", async () => {
  const { useToolPanes } = await import("./useToolPanes");
  return {
    useSpatialController: () => ({
      controller: useToolPanes(),
      bindWorkspace: fixture.bindWorkspace,
    }),
  };
});
vi.mock("./useSavedPanePictures", async () => {
  const { createContext } = await import("react");
  const pictures = {
    getPanePicture: () => null,
    getPanePresentation: () => "dom",
    onLayoutChange: fixture.pictureLayoutChanged,
    onPanePictureCaptured: vi.fn(),
    pictureFor: () => null,
    preparedPictureUrl: () => null,
    pictureUrl: () => "",
    hasFreshPicture: () => false,
    canBackgroundPicture: () => false,
    runningPanes: new Set(),
    retainedPaneIds: new Set(),
    picturesLoaded: true,
    paneSnapshots: {},
    setCaptureActivity: vi.fn(),
    stageRef: vi.fn(),
    stageViewport: { width: 1200, height: 900, compact: false },
  };
  return { PaneSnapshotContext: createContext(null), useSavedPanePictures: () => pictures };
});
vi.mock("./WorkspaceToolbar", () => ({ WorkspaceToolbar: () => null }));
vi.mock("./WorkspaceTooltips", () => ({
  WorkspaceTooltips: ({ children }: { children: ReactNode }) => children,
  WorkspaceControlButton: (props: ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));
vi.mock("./ToolPaneView", () => ({ ToolPaneView: () => null }));
vi.mock("./SpatialSurfaceHost", () => ({
  SpatialSurfaceHost: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@t3tools/web/src/state/preview", () => ({ previewEnvironment: { close: {} } }));
vi.mock("@t3tools/web/src/previewStateStore", () => ({ readThreadPreviewState: vi.fn() }));
vi.mock("@t3tools/web/src/components/preview/closePreviewSession", () => ({
  closePreviewSession: vi.fn(),
}));
vi.mock("@t3tools/web/src/components/ChatView.logic", () => ({
  agentControlledBrowserCloseConfirmation: vi.fn(),
}));
vi.mock("@t3tools/web/src/components/pullRequest/LinkPullRequestDialog", () => ({
  LinkPullRequestDialogHost: () => null,
}));
vi.mock("@t3tools/web/src/localApi", () => ({ readLocalApi: vi.fn() }));
vi.mock("./SavedPanePicture", () => ({ SavedPanePicture: () => null }));
vi.mock("./ThreadCard", () => ({ ThreadCard: () => null }));
vi.mock("./ThreadPane", async () => {
  const { createContext } = await import("react");
  return {
    SpatialWorkspaceActiveContext: createContext(true),
    ThreadPane: () => <textarea aria-label="Thread composer" />,
  };
});

let host: HTMLDivElement;
let root: Root;

function pane(threadId: string, row: number, column: number): OnirigiriPaneDefinition {
  return {
    paneId: `thread:e:${threadId}`,
    surfaceKind: "thread",
    title: threadId,
    planeIndex: row,
    slotIndex: column,
    data: { environmentId: "e", threadId },
  };
}

async function render(threadId = "origin") {
  await act(() =>
    root.render(
      <SpatialWorkspace
        active
        target={{
          kind: "server",
          threadRef: { environmentId: "e" as EnvironmentId, threadId: threadId as ThreadId },
        }}
      />,
    ),
  );
}

function workspace() {
  return host.querySelector<HTMLElement>('[aria-label="Onirigiri for T3 Code"]')!;
}

function status() {
  return host.querySelector('[data-onirigiri-slot="status"]')!.textContent;
}

async function key(key: string, ctrlKey = false) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key.startsWith("Arrow") ? key : `Key${key.toUpperCase()}`,
    altKey: true,
    ctrlKey,
    bubbles: true,
    cancelable: true,
  });
  await act(() => workspace().dispatchEvent(event));
  await act(() => vi.advanceTimersByTime(120));
  return event;
}

async function explicitRoute(threadId: string) {
  await act(() => {
    for (const listener of fixture.routeListeners) {
      listener({ toLocation: { environmentId: "e", threadId } });
    }
  });
  await render(threadId);
  await act(() => vi.advanceTimersByTime(120));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 16),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => window.setTimeout(callback, 0));
  vi.stubGlobal("cancelIdleCallback", (id: number) => window.clearTimeout(id));
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1200,
    height: 900,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1200,
    bottom: 900,
    toJSON: () => ({}),
  });
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 2), pane("lower", 2, 0)];
  fixture.loaded = true;
  fixture.bindWorkspace.mockReset();
  fixture.navigate.mockReset();
  fixture.navigate.mockResolvedValue(undefined);
  fixture.pictureLayoutChanged.mockClear();
  localStorage.clear();
  window.history.replaceState(null, "", "/?layout=rows");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("delivers global surface focus only after the initial workspace and route are ready", async () => {
  fixture.loaded = false;
  fixture.bindWorkspace.mockImplementation((target) => target?.focusPane("thread:e:right"));
  await render();
  expect(fixture.bindWorkspace).not.toHaveBeenCalled();
  fixture.loaded = true;
  await render();
  await act(() => vi.advanceTimersByTime(120));
  expect(status()).toContain("right");
  expect(status()).not.toContain("origin");
});

it("returns to the owning chat when a focused tool closes through its content", async () => {
  fixture.panes = [
    pane("origin", 0, 0),
    {
      paneId: "tool-owned",
      title: "Owned terminal",
      surfaceKind: "terminal",
      planeIndex: 0,
      slotIndex: 1,
      data: {
        paneId: "tool-owned",
        kind: "terminal",
        environmentId: "e",
        threadId: "origin",
        terminalId: "pane-test",
      },
    },
    pane("right", 0, 2),
  ];
  await render();
  await key("ArrowRight");
  expect(status()).toContain("Owned terminal");
  fixture.panes = fixture.panes.filter((pane) => pane.paneId !== "tool-owned");
  await render();
  await act(() => vi.advanceTimersByTime(120));
  expect(status()).toContain("origin");
  expect(status()).not.toContain("Empty cell");
});

it("visits empty cells within and beyond the pane bounds without invalidating pane pictures", async () => {
  await render();
  const pictureUpdates = fixture.pictureLayoutChanged.mock.calls.length;
  expect((await key("ArrowRight")).defaultPrevented).toBe(true);
  expect(status()).toContain("Grid cell (1, 0), split 1: Empty cell.");
  await key("ArrowDown");
  expect(status()).toContain("Grid cell (1, 1), split 1: Empty cell.");
  await key("ArrowDown");
  await key("ArrowDown");
  expect(status()).toContain("Grid cell (1, 3), split 1: Empty cell.");
  await act(() => vi.advanceTimersByTime(1000));
  expect(readPaneLayout("rows")?.cursor).toEqual({ column: 1, row: 3, split: 0 });
  expect(fixture.navigate).not.toHaveBeenCalled();
  expect(fixture.pictureLayoutChanged).toHaveBeenCalledTimes(pictureUpdates);

  fixture.panes = [...fixture.panes, pane("new-project", 4, 0)];
  await render();
  expect(status()).toContain("Grid cell (1, 3), split 1: Empty cell.");
  await explicitRoute("right");
  expect(status()).toContain("right");
  expect(status()).not.toContain("Empty cell");
});

it("does not let a delayed route follow snap an empty cursor back to a pane", async () => {
  await render();
  await key("ArrowRight");
  await key("ArrowRight");
  expect(status()).toContain("right");
  await act(() => vi.advanceTimersByTime(500));
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({
    to: "/$environmentId/$threadId",
    params: { environmentId: "e", threadId: "right" },
  });
  await key("ArrowDown");
  expect(status()).toContain("Grid cell (2, 1), split 1: Empty cell.");
  await render("right");
  await act(() => vi.advanceTimersByTime(1000));
  expect(status()).toContain("Grid cell (2, 1), split 1: Empty cell.");
  await explicitRoute("origin");
  expect(status()).toContain("origin");
  expect(status()).not.toContain("Empty cell");
});

it("moves a pane to an empty row and negative column with Control+Alt, and restores it on reload", async () => {
  await render();
  await key("ArrowDown", true);
  await key("ArrowLeft", true);
  await act(() => window.dispatchEvent(new Event("pagehide")));
  expect(threadLayoutPositions(readPaneLayout("rows")!)).toContainEqual({
    paneId: "thread:e:origin",
    plane: 1,
    slot: -1,
  });
  await act(() => root.unmount());
  root = createRoot(host);
  await render();
  await key("ArrowRight");
  expect(status()).toContain("Grid cell (0, 1), split 1: Empty cell.");
});

it("keeps strip navigation on occupied panes and the single row", async () => {
  window.history.replaceState(null, "", "/?layout=strip");
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 2)];
  await render();
  await key("ArrowRight");
  expect(status()).toContain("right");
  await key("ArrowRight");
  await key("ArrowDown");
  expect(status()).toContain("right");
  expect(status()).not.toContain("Empty cell");
});
