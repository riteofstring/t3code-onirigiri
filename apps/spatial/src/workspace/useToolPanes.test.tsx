import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useToolPanes } from "./useToolPanes";
import { createSpatialSurfaceNavigation } from "./SpatialSurfaceHost";
import { terminalSurface, type RightPanelSurface } from "@t3tools/web/src/rightPanelStore";
import {
  selectThreadPreviewMiniPlayer,
  usePreviewMiniPlayerStore,
} from "@t3tools/web/src/previewMiniPlayerStore";

const storage = new Map<string, string>();
let hook: ReturnType<typeof useToolPanes>;
let renderer: ReactTestRenderer | undefined;

function Probe() {
  const value = useToolPanes();
  useEffect(() => {
    hook = value;
  });
  return null;
}

async function mount() {
  await act(() => {
    renderer = create(<Probe />);
  });
}

const thread = (threadId: string) => ({
  environmentId: "e" as EnvironmentId,
  threadId: threadId as ThreadId,
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  storage.clear();
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  vi.unstubAllGlobals();
});

it("places a new pane right after its thread or after the added pane it follows", async () => {
  await mount();
  let first = "";
  let second = "";
  let third = "";
  await act(() => {
    first = hook.addEmpty(thread("t1"), null);
  });
  await act(() => {
    second = hook.addEmpty(thread("t1"), null);
  });
  await act(() => {
    third = hook.addEmpty(thread("t1"), second);
  });
  expect(hook.toolPanes.map((pane) => pane.paneId)).toEqual([second, third, first]);
});

it("turns an empty pane into a terminal or diff and remembers it across reloads", async () => {
  await mount();
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(thread("t1"), null);
  });
  await act(() => {
    hook.openSurface(thread("t1"), terminalSurface("onirigiri-pane-test"), paneId);
  });
  const terminal = hook.toolPanes[0]!;
  expect(terminal.kind).toBe("surface");
  expect(terminal.surface).toMatchObject({ kind: "terminal", resourceId: "onirigiri-pane-test" });

  await act(() => renderer!.unmount());
  renderer = undefined;
  await mount();
  expect(hook.toolPanes).toEqual([terminal]);

  await act(() => hook.remove(paneId));
  expect(hook.toolPanes).toEqual([]);
});

it("replaces choosers and placeholders in place, and keeps one owner per browser resource", async () => {
  await mount();
  let first = "";
  let second = "";
  const focused = vi.fn();
  await act(() => {
    first = hook.addEmpty(thread("t1"), null);
  });
  const navigation = () => createSpatialSurfaceNavigation(hook, first, focused);
  await act(() => navigation().openBrowser(thread("t1"), null));
  await act(() => navigation().openBrowser(thread("t1"), "browser-a"));
  expect(hook.toolPanes).toMatchObject([{ paneId: first, surface: { resourceId: "browser-a" } }]);
  await act(() => {
    second = hook.addEmpty(thread("t1"), first);
  });
  await act(() =>
    createSpatialSurfaceNavigation(hook, second, focused).openBrowser(thread("t1"), "browser-a"),
  );
  expect(hook.toolPanes).toHaveLength(1);
  expect(focused).toHaveBeenLastCalledWith(first);
  await act(() => navigation().openBrowser(thread("t2"), "browser-a"));
  expect(hook.toolPanes).toHaveLength(2);
  expect(hook.toolPanes.map((pane) => pane.threadId)).toEqual(["t1", "t2"]);
});

it("persists every supported surface and drops malformed records without losing valid neighbors", async () => {
  const surfaces: RightPanelSurface[] = [
    { id: "browser:page", kind: "preview", resourceId: "page" },
    terminalSurface("onirigiri-pane-shell"),
    { id: "files", kind: "files" },
    {
      id: "file:src/app.ts",
      kind: "file",
      relativePath: "src/app.ts",
      revealLine: 42,
      revealRequestId: 3,
    },
    { id: "diff", kind: "diff" },
    {
      id: "pull-request:p:owner%2Frepo:12",
      kind: "pull-request",
      projectId: "p",
      repository: "owner/repo",
      number: 12,
    },
    { id: "pull-requests", kind: "pull-requests" },
    { id: "agents", kind: "agents" },
    {
      id: "device:local:phone",
      kind: "device",
      target: { hostId: "local", deviceId: "phone", platform: "ios", name: "Phone" },
    },
  ];
  await mount();
  await act(() => {
    for (const surface of surfaces) hook.openSurface(thread("t1"), surface, null);
  });
  const saved = hook.toolPanes;
  await act(() => renderer!.unmount());
  renderer = undefined;
  storage.set(
    "onirigiri-t3:tool-panes",
    JSON.stringify([
      ...saved,
      {
        ...saved[0],
        paneId: "tool-corrupt",
        surface: { id: "browser:wrong", kind: "preview", resourceId: "other" },
      },
    ]),
  );
  await mount();
  expect(hook.toolPanes).toEqual(saved);
});

it("keeps file reveal state and terminal split changes on their own pane", async () => {
  await mount();
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(thread("t1"), null);
  });
  const focused = vi.fn();
  const navigation = () => createSpatialSurfaceNavigation(hook, paneId, focused);
  await act(() => navigation().open(thread("t1"), "files"));
  await act(() => navigation().openFile(thread("t1"), "src/app.ts", 20));
  await act(() => navigation().openFile(thread("t1"), "src/app.ts", 36));
  expect(hook.toolPanes).toMatchObject([
    { paneId, surface: { revealLine: 36, revealRequestId: 2 } },
  ]);
  await act(() => navigation().openTerminal(thread("t1"), "one"));
  await act(() => navigation().splitTerminal(thread("t1"), "terminal:one", "two", "vertical"));
  await act(() => navigation().closeTerminal(thread("t1"), "terminal:one", "one"));
  expect(hook.toolPanes.find((pane) => pane.surface?.kind === "terminal")?.surface).toMatchObject({
    terminalIds: ["two"],
    activeTerminalId: "two",
    splitDirection: "vertical",
  });
  await act(() => navigation().closeTerminal(thread("t1"), "terminal:one", "two"));
  expect(hook.toolPanes).toHaveLength(1);
  expect(hook.toolPanes[0]?.paneId).toBe(paneId);
});

it("rejects late proactive openings after a user choice without moving focus", async () => {
  await mount();
  const focused = vi.fn();
  const navigation = createSpatialSurfaceNavigation(hook, "thread-source", focused);
  const revision = navigation.getUserActionRevision(thread("t1"));
  await act(() => navigation.open(thread("t1"), "files"));
  let accepted = true;
  await act(() => {
    accepted = navigation.openProactive(thread("t1"), { kind: "diff", id: "diff" }, revision);
  });
  expect(accepted).toBe(false);
  expect(hook.toolPanes).toHaveLength(1);
  expect(focused).toHaveBeenCalledTimes(1);
});

it("redocks only the matching floating resource and recovers a remotely closed browser in place", async () => {
  await mount();
  const focused = vi.fn();
  const navigation = createSpatialSurfaceNavigation(hook, "thread-source", focused);
  usePreviewMiniPlayerStore.getState().open(thread("t1"), { kind: "browser", tabId: "floating" });
  await act(() => navigation.openBrowser(thread("t1"), "other"));
  expect(
    selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, thread("t1"))
      ?.source,
  ).toMatchObject({ tabId: "floating" });
  await act(() => navigation.openBrowser(thread("t1"), "floating"));
  expect(
    selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, thread("t1")),
  ).toBeNull();
  const recovering = hook.toolPanes.find((pane) => pane.surface?.id === "browser:floating")!;
  const revision = navigation.getUserActionRevision(thread("t1"));
  focused.mockClear();
  await act(() => navigation.reconcileBrowserSurfaces(thread("t1"), ["other"]));
  expect(hook.toolPanes.find((pane) => pane.paneId === recovering.paneId)?.surface).toEqual({
    id: "browser:new",
    kind: "preview",
    resourceId: null,
  });
  expect(hook.toolPanes).toHaveLength(2);
  expect(focused).not.toHaveBeenCalled();
  expect(navigation.getUserActionRevision(thread("t1"))).toBe(revision);
});
