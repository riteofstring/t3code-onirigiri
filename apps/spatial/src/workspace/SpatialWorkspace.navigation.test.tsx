// @vitest-environment jsdom
import type { OnirigiriPaneDefinition } from "@riteofstring/onirigiri";
import type { DesktopPreviewHostKey, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { matchesPreviewHostShortcut } from "../../../../packages/shared/src/previewHostKeyboard";
import type { BrowserSurfaceProjectionPolicy } from "@t3tools/web/src/browser/browserSurfaceProjection";
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
  browserProjection: null as BrowserSurfaceProjectionPolicy | null,
  addEmpty: vi.fn(),
  threadRenders: [] as string[],
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
  const tools = {
    toolPanes: [],
    getPanes: () => tools.toolPanes,
    addEmpty: fixture.addEmpty,
    choose: vi.fn(),
    remove: vi.fn(),
  };
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
  const { createContext, use } = await import("react");
  const { BrowserSurfaceProjectionContext } =
    await import("@t3tools/web/src/browser/browserSurfaceProjection");
  return {
    SpatialWorkspaceActiveContext: createContext(true),
    ThreadPane: ({
      thread,
      paneId,
      onAddPane,
    }: {
      thread: { threadId: string };
      paneId: string;
      onAddPane: (paneId: string) => void;
    }) => {
      fixture.threadRenders.push(thread.threadId);
      fixture.browserProjection = use(BrowserSurfaceProjectionContext);
      return (
        <div data-browser-keyboard-slot>
          <button onClick={() => onAddPane(paneId)}>Add beside {thread.threadId}</button>
          <textarea aria-label="Thread composer" />
        </div>
      );
    },
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
  fixture.browserProjection = null;
  fixture.addEmpty.mockReset();
  fixture.threadRenders = [];
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

it("keeps mounted chat content stable across a shell refresh and uses the clicked pane's owner", async () => {
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 1)];
  await render();
  await act(() => vi.advanceTimersByTime(120));
  expect(fixture.threadRenders).toContain("origin");
  fixture.threadRenders = [];

  fixture.panes = fixture.panes.map((pane) => ({
    ...pane,
    data: { ...(pane.data as { environmentId: string; threadId: string }) },
  }));
  await render();
  expect(fixture.threadRenders).toEqual([]);

  expect(status()).toContain("origin");
  const addToRight = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Add beside right",
  );
  expect(addToRight).toBeDefined();
  await act(() => addToRight!.click());
  expect(fixture.addEmpty).toHaveBeenCalledExactlyOnceWith(
    { environmentId: "e", threadId: "right" },
    null,
  );
  fixture.addEmpty.mockClear();

  fixture.panes = [...fixture.panes, pane("new", 0, 2)];
  await render();
  await explicitRoute("new");
  const add = Array.from(host.querySelectorAll("button")).find(
    (button) => button.textContent === "Add beside new",
  );
  expect(add).toBeDefined();
  await act(() => add!.click());
  expect(fixture.addEmpty).toHaveBeenCalledExactlyOnceWith(
    { environmentId: "e", threadId: "new" },
    null,
  );
});

it("routes guest keys through the engine and returns keyboard focus to the destination pane", async () => {
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 1)];
  await render();
  await act(() => vi.advanceTimersByTime(120));
  const slot = host.querySelector<HTMLElement>(
    '[data-onirigiri-pane-id="thread:e:origin"] [data-browser-keyboard-slot]',
  )!;
  const guest = document.createElement("button");
  host.append(guest);
  guest.focus();
  const input = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    code: "ArrowRight",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => fixture.browserProjection!.keyboard!.keyDown(slot, input));
  await act(() => vi.advanceTimersByTime(120));
  expect(input.defaultPrevented).toBe(true);
  expect(status()).toContain("right");
  expect((document.activeElement as HTMLElement).dataset.onirigiriPaneId).toBe("thread:e:right");

  const stale = new KeyboardEvent("keydown", {
    key: "ArrowRight",
    code: "ArrowRight",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => fixture.browserProjection!.keyboard!.keyDown(slot, stale));
  expect(stale.defaultPrevented).toBe(false);
  const back = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    code: "ArrowLeft",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  await act(() => document.activeElement!.dispatchEvent(back));
  await act(() => vi.advanceTimersByTime(120));
  expect(back.defaultPrevented).toBe(true);
  expect(status()).toContain("origin");
  expect((document.activeElement as HTMLElement).dataset.onirigiriPaneId).toBe("thread:e:origin");
});

it("admits exactly the configured engine chords, including editable targets and macOS Option keys", async () => {
  await render();
  const shortcuts = fixture.browserProjection!.keyboard!.shortcuts;
  const platform = vi.spyOn(window.navigator, "platform", "get");
  for (const name of ["Linux", "MacIntel"]) {
    platform.mockReturnValue(name);
    for (const editing of [false, true]) {
      const inputs: DesktopPreviewHostKey[] = shortcuts.map((shortcut) => ({
        ...shortcut,
        code: shortcut.key.length === 1 ? `Key${shortcut.key.toUpperCase()}` : shortcut.key,
        key: name === "MacIntel" && shortcut.key === "o" ? "ø" : shortcut.key,
        repeat: false,
        isComposing: false,
        keyCode: 0,
        altGraph: false,
        editing,
      }));
      const arrow = inputs.find((input) => input.key === "ArrowRight")!;
      inputs.push(
        { ...arrow, isComposing: true },
        { ...arrow, keyCode: 229 },
        { ...arrow, altGraph: true },
        { ...arrow, shiftKey: true },
        { ...arrow, metaKey: true },
        { ...arrow, altKey: false },
      );
      for (const input of inputs) {
        const event = new KeyboardEvent("keydown", {
          ...input,
          modifierAltGraph: input.altGraph,
          bubbles: true,
          cancelable: true,
        });
        Object.defineProperty(event, "keyCode", { value: input.keyCode });
        const target = editing ? host.querySelector("textarea")! : workspace();
        await act(() => target.dispatchEvent(event));
        expect(
          matchesPreviewHostShortcut(input, shortcuts, name),
          `${name}: ${JSON.stringify(input)}`,
        ).toBe(event.defaultPrevented);
      }
    }
  }
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

it("visits gaps and positions beyond either end of the strip without leaving its row", async () => {
  window.history.replaceState(null, "", "/?layout=strip");
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 2)];
  await render();
  const pictureUpdates = fixture.pictureLayoutChanged.mock.calls.length;
  await key("ArrowRight");
  expect(status()).toContain("Grid cell (1, 0), split 1: Empty cell.");
  await act(() => vi.advanceTimersByTime(1000));
  expect(fixture.navigate).not.toHaveBeenCalled();
  await key("ArrowRight");
  expect(status()).toContain("right");
  await key("ArrowRight");
  expect(status()).toContain("Grid cell (3, 0), split 1: Empty cell.");
  await key("ArrowDown");
  await key("ArrowUp");
  expect(status()).toContain("Grid cell (3, 0), split 1: Empty cell.");
  await key("ArrowLeft");
  expect(status()).toContain("right");
  await key("ArrowLeft");
  expect(status()).toContain("Grid cell (1, 0), split 1: Empty cell.");
  await key("ArrowLeft");
  expect(status()).toContain("origin");
  await key("ArrowLeft");
  expect(status()).toContain("Grid cell (-1, 0), split 1: Empty cell.");
  await act(() => window.dispatchEvent(new Event("pagehide")));
  expect(readPaneLayout("strip")?.cursor).toEqual({ column: -1, row: 0, split: 0 });
  expect(fixture.pictureLayoutChanged).toHaveBeenCalledTimes(pictureUpdates);
  await explicitRoute("right");
  expect(status()).toContain("right");
  expect(status()).not.toContain("Empty cell");
});
