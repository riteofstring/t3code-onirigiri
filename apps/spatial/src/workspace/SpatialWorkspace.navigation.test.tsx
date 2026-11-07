// @vitest-environment jsdom
import {
  createWorkspaceScene,
  serializeWorkspaceLayout,
  type OnirigiriPaneDefinition,
} from "@riteofstring/onirigiri";
import type { DesktopPreviewHostKey, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { matchesPreviewHostShortcut } from "../../../../packages/shared/src/previewHostKeyboard";
import type { BrowserSurfaceProjectionPolicy } from "@t3tools/web/src/browser/browserSurfaceProjection";
import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { SpatialWorkspace } from "./SpatialWorkspace";
import {
  createPaneLifecycleStore,
  PaneLifecycleContext,
  type PaneLifecycleStore,
  usePaneMounted,
} from "./paneLifecycle";
import { readPaneLayout, threadLayoutPositions, writePaneLayout } from "./workspaceLayout";
import { bindWorkspace, pictureLayoutChanged, stubWorkspaceFrames } from "./workspaceTestMocks";

type RouteLocation = { environmentId: string; threadId: string };
type NavigationEvent = { toLocation: RouteLocation };

const fixture = vi.hoisted(() => ({
  panes: [] as OnirigiriPaneDefinition[],
  loaded: true,
  routeListeners: new Set<(event: NavigationEvent) => void>(),
  navigate: vi.fn<(input: { params: RouteLocation }) => Promise<void>>(),
  browserProjection: null as BrowserSurfaceProjectionPolicy | null,
  addEmpty: vi.fn(),
  threadRenders: [] as string[],
  lifecycle: null as PaneLifecycleStore | null,
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
vi.mock("./SpatialSurfaceProvider", async () => (await import("./workspaceTestMocks")).controller);
vi.mock("./useSavedPanePictures", async () => (await import("./workspaceTestMocks")).savedPictures);
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
vi.mock("./ThreadCard", () => ({ PaneLoading: () => null, ThreadCard: () => null }));
vi.mock("./DraftPane", () => ({ DraftPane: () => null }));
vi.mock("@t3tools/web/src/hooks/useHandleNewThread", () => {
  const newThread = vi.fn();
  return { useNewThreadHandler: () => newThread };
});
vi.mock("./ThreadPane", async () => {
  const { createContext, use } = await import("react");
  const { useOnirigiriPaneContentReady } = await import("@riteofstring/onirigiri");
  const { PaneLifecycleContext, usePaneMounted } = await import("./paneLifecycle");
  const { BrowserSurfaceProjectionContext } =
    await import("@t3tools/web/src/browser/browserSurfaceProjection");
  return {
    SpatialWorkspaceActiveContext: createContext(true),
    ThreadPane: ({
      thread,
      paneId,
      visible,
      onAddPane,
    }: {
      thread: { threadId: string };
      paneId: string;
      visible: boolean;
      onAddPane: (paneId: string) => void;
    }) => {
      fixture.threadRenders.push(thread.threadId);
      fixture.lifecycle = use(PaneLifecycleContext);
      fixture.browserProjection = use(BrowserSurfaceProjectionContext);
      const mounted = usePaneMounted(paneId, visible);
      useOnirigiriPaneContentReady(mounted);
      return (
        <div data-browser-keyboard-slot>
          <button onClick={() => onAddPane(paneId)}>Add beside {thread.threadId}</button>
          {mounted ? <textarea aria-label="Thread composer" data-thread={thread.threadId} /> : null}
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

async function render(threadId = "origin", strict = false) {
  const view = (
    <SpatialWorkspace
      active
      target={{
        kind: "server",
        threadRef: { environmentId: "e" as EnvironmentId, threadId: threadId as ThreadId },
      }}
    />
  );
  await act(() => root.render(strict ? <StrictMode>{view}</StrictMode> : view));
}

function workspace() {
  return host.querySelector<HTMLElement>('[aria-label="Onirigiri for T3 Code"]')!;
}

function status() {
  return host.querySelector('[data-onirigiri-slot="status"]')!.textContent;
}

function rowHeight() {
  return host.querySelector<HTMLInputElement>('input[aria-label="Row height in pixels"]')!;
}

function paneHeights() {
  return [...host.querySelectorAll<HTMLElement>('[data-onirigiri-slot="pane"]')].map((element) =>
    Number.parseFloat(element.style.height),
  );
}

async function changeHeight(value: string) {
  await act(() => {
    const input = rowHeight();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => vi.advanceTimersByTime(120));
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
  stubWorkspaceFrames();
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
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
  bindWorkspace.mockReset();
  fixture.navigate.mockReset();
  fixture.navigate.mockResolvedValue(undefined);
  pictureLayoutChanged.mockClear();
  fixture.browserProjection = null;
  fixture.addEmpty.mockReset();
  fixture.threadRenders = [];
  fixture.lifecycle = null;
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
  vi.unstubAllEnvs();
});

it("keeps every chat mounted through navigation and overview in all-live builds", async () => {
  vi.stubEnv("MODE", "all-live");
  fixture.panes = Array.from({ length: 40 }, (_, index) => pane(`live-${index}`, 0, index));
  await render("live-0");
  const composers = [
    ...host.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Thread composer"]'),
  ];
  expect(composers).toHaveLength(40);
  await key("ArrowRight");
  expect(status()).toContain("live-1");
  await key("o");
  expect(workspace().dataset.presentationMode).toBe("overview");
  expect([...host.querySelectorAll('textarea[aria-label="Thread composer"]')]).toEqual(composers);
  await key("o");
  expect(workspace().dataset.presentationMode).toBe("normal");
  expect([...host.querySelectorAll('textarea[aria-label="Thread composer"]')]).toEqual(composers);
});

function VisiblePane({ paneId }: { paneId: string }) {
  return <span>{usePaneMounted(paneId, true) ? "live" : "unmounted"}</span>;
}

it("releases visibility when its React owner leaves before layout membership changes", async () => {
  const panes = Array.from({ length: 40 }, (_, slot) => ({ paneId: `p${slot}`, plane: 0, slot }));
  const store = createPaneLifecycleStore(panes, "p0");
  store.setPictures(() => true);
  try {
    await act(() =>
      root.render(
        <PaneLifecycleContext value={store}>
          {panes.slice(1, 15).map((pane) => (
            <VisiblePane key={pane.paneId} paneId={pane.paneId} />
          ))}
        </PaneLifecycleContext>,
      ),
    );
    await act(() => root.render(<PaneLifecycleContext value={store} />));
    for (let i = 15; i < 40; i++) store.setFocus(`p${i}`);
    vi.advanceTimersByTime(501);
    expect(panes.filter((pane) => store.isMounted(pane.paneId)).map((pane) => pane.paneId)).toEqual(
      panes.slice(30).map((pane) => pane.paneId),
    );
  } finally {
    store.dispose();
  }
});

async function exerciseLifecycle(store: PaneLifecycleStore) {
  const origin = "thread:e:origin";
  const destination = "thread:e:right";
  const unregister = [origin, destination].map((paneId) => store.registerChat(paneId, () => null));
  const navigation = bindWorkspace.mock.calls.at(-1)![0]!;
  try {
    await act(() => {
      store.setPictures(() => true);
      navigation.focusPane(destination);
    });
    await act(() => vi.advanceTimersByTime(64));
    expect(store.isMounted(origin)).toBe(false);
    await act(() => vi.advanceTimersByTime(1000));
    expect(store.isMounted(destination)).toBe(true);
    await act(() => store.composerReady(destination));
    await act(() => vi.advanceTimersByTime(64));
    expect(store.timelineDeferred(destination)).toBe(false);
    await act(() => navigation.focusPane(origin));
    await act(() => vi.advanceTimersByTime(1000));
    expect(store.isMounted(origin)).toBe(true);
    expect(host.querySelector('textarea[data-thread="origin"]')).not.toBeNull();
  } finally {
    for (const release of unregister) release();
  }
}

it.each([true, false])(
  "keeps lifecycle ownership through Strict Mode with initial readiness %s",
  async (ready) => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }));
    fixture.loaded = ready;
    await render("origin", true);
    if (!ready) {
      expect(fixture.lifecycle).toBeNull();
      fixture.loaded = true;
      await render("origin", true);
    }
    const store = fixture.lifecycle!;
    await exerciseLifecycle(store);
    await changeHeight("420");
    expect(fixture.lifecycle).toBe(store);
    await render("right", true);
    expect(fixture.lifecycle).toBe(store);
    await render("origin", true);
    await act(() => {
      host.querySelector<HTMLButtonElement>('[aria-label="Switch to strip layout"]')!.click();
    });
    expect(fixture.lifecycle).not.toBe(store);
    await exerciseLifecycle(fixture.lifecycle!);
  },
);

it("applies row height to manually sized rows without changing widths or selection", async () => {
  const { scene, cursor } = createWorkspaceScene({ id: "onirigiri-t3", panes: fixture.panes });
  const layout = serializeWorkspaceLayout(scene, cursor);
  const pinned = {
    ...layout,
    columns: layout.columns.map((column, index) => ({
      ...column,
      widthSpec: { unit: "px" as const, value: 520 + index * 40 },
      cells: column.cells.map((cell) => ({ ...cell, heightPx: 500 })),
    })),
  };
  writePaneLayout("rows", pinned);
  await render("right");
  expect(paneHeights()).toEqual([500, 500, 500]);
  const widths = pinned.columns.map((column) => column.widthSpec);
  expect(status()).toContain("right");

  await changeHeight("420");
  expect(paneHeights()).toEqual([420, 420, 420]);
  await changeHeight(rowHeight().max);
  const maximum = Number(rowHeight().max);
  expect(paneHeights()).toEqual([maximum, maximum, maximum]);
  await changeHeight("420");
  expect(paneHeights()).toEqual([420, 420, 420]);
  expect(status()).toContain("right");

  await act(() => root.unmount());
  root = createRoot(host);
  await render("right");
  expect(paneHeights()).toEqual([420, 420, 420]);
  expect(readPaneLayout("rows")!.columns.map((column) => column.widthSpec)).toEqual(widths);
});

it("leaves full screen panes when committing a shorter row height", async () => {
  localStorage.setItem(
    "onirigiri-t3:workspace-preferences",
    JSON.stringify({
      rowHeight: 420,
      maximizeAll: true,
    }),
  );
  await render();
  expect(rowHeight().value).toBe(rowHeight().max);
  await act(() => vi.advanceTimersByTime(120));
  expect(paneHeights().every((height) => height > 420)).toBe(true);
  await changeHeight("420");
  expect(paneHeights()).toEqual([420, 420, 420]);
  expect(host.querySelector('[aria-label="Full screen panes"]')!.getAttribute("aria-pressed")).toBe(
    "false",
  );
  await changeHeight(rowHeight().max);
  const maximum = Number(rowHeight().max);
  expect(paneHeights()).toEqual([maximum, maximum, maximum]);
});

it("delivers global surface focus only after the initial workspace and route are ready", async () => {
  fixture.loaded = false;
  bindWorkspace.mockImplementation((target) => target?.focusPane("thread:e:right"));
  await render();
  expect(bindWorkspace).not.toHaveBeenCalled();
  fixture.loaded = true;
  await render();
  await act(() => vi.advanceTimersByTime(120));
  expect(status()).toContain("right");
  expect(status()).not.toContain("origin");
});

it("mounts a distant pane on arrival from overview without retaining it offscreen", async () => {
  fixture.panes = [pane("origin", 0, 0), pane("distant", 0, 20)];
  await render();
  await key("o");
  expect(workspace().dataset.presentationMode).toBe("overview");
  const neighbor = host.querySelector<HTMLElement>('[data-onirigiri-pane-id="thread:e:distant"]')!;
  expect(neighbor.dataset.visible).toBe("false");
  expect(neighbor.querySelector("textarea")).toBeNull();

  await act(() => vi.advanceTimersByTime(4000));
  expect(neighbor.querySelector("textarea")).toBeNull();
  expect(neighbor.dataset.visible).toBe("false");
  expect(workspace().dataset.presentationMode).toBe("overview");
  expect(status()).toContain("origin");

  await explicitRoute("distant");
  await act(() => vi.runOnlyPendingTimers());
  expect(workspace().dataset.presentationMode).toBe("normal");
  expect(status()).toContain("distant");
  expect(neighbor.dataset.visible).toBe("true");
  expect(neighbor.querySelector("textarea")).not.toBeNull();
  expect(
    neighbor
      .querySelector('[data-onirigiri-slot="pane-live-content"]')
      ?.getAttribute("aria-hidden"),
  ).toBe("false");
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

it("preserves Shift+Option navigation from an editing browser guest", async () => {
  fixture.panes = [pane("origin", 0, 0), pane("right", 0, 1)];
  await render();
  const slot = host.querySelector<HTMLElement>(
    '[data-onirigiri-pane-id="thread:e:origin"] [data-browser-keyboard-slot]',
  )!;
  const input: DesktopPreviewHostKey = {
    key: "ArrowRight",
    code: "ArrowRight",
    altKey: true,
    ctrlKey: false,
    metaKey: false,
    shiftKey: true,
    repeat: false,
    isComposing: false,
    keyCode: 0,
    altGraph: false,
    editing: true,
  };
  expect(
    matchesPreviewHostShortcut(input, fixture.browserProjection!.keyboard!.shortcuts, "MacIntel"),
  ).toBe(true);
  const event = new KeyboardEvent("keydown", { ...input, bubbles: true, cancelable: true });
  await act(() => fixture.browserProjection!.keyboard!.keyDown(slot, event));
  await act(() => vi.advanceTimersByTime(120));
  expect(event.defaultPrevented).toBe(true);
  expect(status()).toContain("right");
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
          matchesPreviewHostShortcut(
            input,
            shortcuts.map((binding) =>
              binding.shiftKey && binding.key.startsWith("Arrow")
                ? { ...binding, whileEditing: false }
                : binding,
            ),
            name,
          ),
          `${name}: ${JSON.stringify(input)}`,
        ).toBe(event.defaultPrevented);
      }
    }
  }
});

it("stays on the emptied cell when a focused tool closes through its content", async () => {
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
  expect(status()).toContain("Empty cell");
});

it("returns to a focused tool pane after a reload whose route names its chat", async () => {
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
  await act(() => vi.advanceTimersByTime(1000));
  await act(() => root.unmount());
  root = createRoot(host);
  await render("origin");
  expect(status()).toContain("Owned terminal");
});

it("visits empty cells within and beyond the pane bounds, leaving the chat route, without invalidating pane pictures", async () => {
  await render();
  const pictureUpdates = pictureLayoutChanged.mock.calls.length;
  expect((await key("ArrowRight")).defaultPrevented).toBe(true);
  expect(status()).toContain("Grid cell (1, 0), split 1: Empty cell.");
  await key("ArrowDown");
  expect(status()).toContain("Grid cell (1, 1), split 1: Empty cell.");
  await key("ArrowDown");
  await key("ArrowDown");
  expect(status()).toContain("Grid cell (1, 3), split 1: Empty cell.");
  await act(() => vi.advanceTimersByTime(1000));
  expect(readPaneLayout("rows")?.cursor).toEqual({ column: 1, row: 3, split: 0 });
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/" });
  expect(pictureLayoutChanged).toHaveBeenCalledTimes(pictureUpdates);

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
  const pictureUpdates = pictureLayoutChanged.mock.calls.length;
  await key("ArrowRight");
  expect(status()).toContain("Grid cell (1, 0), split 1: Empty cell.");
  await act(() => vi.advanceTimersByTime(1000));
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/" });
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
  expect(pictureLayoutChanged).toHaveBeenCalledTimes(pictureUpdates);
  await explicitRoute("right");
  expect(status()).toContain("right");
  expect(status()).not.toContain("Empty cell");
});
