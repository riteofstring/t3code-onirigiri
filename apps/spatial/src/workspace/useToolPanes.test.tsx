import { RunId } from "@t3tools/contracts";
import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useToolPanes } from "./useToolPanes";
import { createSpatialSurfaceNavigation } from "./SpatialSurfaceHost";
import {
  browserSurface,
  pullRequestSurface,
  terminalSurface,
  useRightPanelStore,
  selectThreadRightPanelState,
  type RightPanelSurface,
} from "@t3tools/web/src/rightPanelStore";
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
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
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

it("re-attaches an empty pane to another chat or to a project without chats, across reloads", async () => {
  await mount();
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(thread("t1"), null);
  });
  await act(() => hook.attachEmpty(paneId, thread("t2")));
  expect(hook.toolPanes).toEqual([{ paneId, kind: "empty", ...thread("t2") }]);
  await act(() => hook.attachEmpty(paneId, { ...thread("t2"), projectId: "p-new" as ProjectId }));
  const attached = hook.toolPanes[0]!;
  expect(attached.projectId).toBe("p-new");

  await act(() => renderer!.unmount());
  renderer = undefined;
  await mount();
  expect(hook.toolPanes).toEqual([attached]);

  await act(() => {
    hook.openSurface(thread("t2"), terminalSurface("onirigiri-pane-test"), paneId);
  });
  await act(() => hook.attachEmpty(paneId, thread("t3")));
  expect(hook.toolPanes[0]).toMatchObject({ kind: "surface", threadId: "t2" });
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

it("does not let a dismissed setup clear a replacement surface or recreate a closed pane", async () => {
  await mount();
  const ref = thread("t1");
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(ref, null);
    hook.openSurface(ref, { id: "device", kind: "device" }, paneId);
  });
  await act(() => hook.clearSurface(paneId, "device"));
  const chooser = { ...ref, paneId, kind: "empty" };
  expect(hook.toolPanes).toEqual([chooser]);
  await act(() => {
    hook.openSurface(ref, { id: "files", kind: "files" }, paneId);
  });
  const files = hook.toolPanes[0];
  await act(() => hook.clearSurface(paneId, "device"));
  expect(hook.toolPanes).toEqual([files]);
  await act(() => hook.remove(paneId));
  await act(() => hook.clearSurface(paneId, "device"));
  expect(hook.toolPanes).toEqual([]);
});

it("keeps the position of a restored Agents pane while using native Lineage", async () => {
  storage.set(
    "onirigiri-t3:tool-panes",
    JSON.stringify([
      {
        ...thread("t1"),
        paneId: "tool-old-agents",
        kind: "surface",
        surface: { id: "agents", kind: "agents" },
      },
      {
        ...thread("t1"),
        paneId: "tool-files",
        kind: "surface",
        surface: { id: "files", kind: "files" },
      },
    ]),
  );
  await mount();
  expect(hook.toolPanes.map(({ paneId, surface }) => ({ paneId, surface }))).toEqual([
    { paneId: "tool-old-agents", surface: { id: "lineage", kind: "lineage" } },
    { paneId: "tool-files", surface: { id: "files", kind: "files" } },
  ]);
  const saved = hook.toolPanes;
  await act(() => renderer!.unmount());
  renderer = undefined;
  await mount();
  expect(hook.toolPanes).toEqual(saved);
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
    { id: "lineage", kind: "lineage" },
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

it.each([
  { explicitFirst: false, explicitHasUrl: false },
  { explicitFirst: true, explicitHasUrl: false },
  { explicitFirst: false, explicitHasUrl: true },
  { explicitFirst: true, explicitHasUrl: true },
])(
  "merges restored PR panes with explicitFirst=$explicitFirst and explicitHasUrl=$explicitHasUrl",
  async ({ explicitFirst, explicitHasUrl }) => {
    const ref = thread("t1");
    const target = { projectId: "p", repository: "owner/repo", number: 12 };
    const host = "github.fixture.invalid";
    const url = `https://${host}/owner/repo/pull/12`;
    const legacy: RightPanelSurface = {
      ...target,
      id: "pull-request:p:owner%2Frepo:12",
      kind: "pull-request",
      url,
    };
    const explicit = pullRequestSurface({
      ...target,
      host,
      ...(explicitHasUrl ? { url: `${url}#discussion` } : {}),
    });
    const pane = (paneId: string, surface: RightPanelSurface, owner = ref) => ({
      ...owner,
      paneId,
      kind: "surface",
      surface,
    });
    const before = pane("tool-files", { id: "files", kind: "files" });
    const between = pane("tool-diff", { id: "diff", kind: "diff" });
    const first = pane("tool-first", explicitFirst ? explicit : legacy);
    const duplicate = pane("tool-duplicate", explicitFirst ? legacy : explicit);
    const distinct = [
      pane("tool-host", pullRequestSurface({ ...target, host: "github.other.invalid" })),
      pane("tool-thread", explicit, thread("t2")),
      pane("tool-environment", explicit, { ...ref, environmentId: "other" as EnvironmentId }),
      pane("tool-source", pullRequestSurface({ ...target, host, environmentId: "remote" })),
    ];
    storage.set(
      "onirigiri-t3:tool-panes",
      JSON.stringify([before, first, between, duplicate, ...distinct]),
    );

    await mount();

    const expected = [
      before,
      {
        ...first,
        surface: pullRequestSurface({
          ...target,
          host,
          url: explicitFirst && explicitHasUrl ? `${url}#discussion` : url,
        }),
      },
      between,
      ...distinct,
    ];
    expect(hook.toolPanes).toEqual(expected);
    expect(JSON.parse(storage.get("onirigiri-t3:tool-panes")!)).toEqual(expected);

    await act(() => renderer!.unmount());
    renderer = undefined;
    await mount();
    expect(hook.toolPanes).toEqual(expected);
  },
);

it.each([undefined, ""])(
  "matches native PR URL retention when reopening with url=%s",
  async (url) => {
    await mount();
    const ref = thread("t1");
    const target = { projectId: "p", repository: "owner/repo", number: 12 };
    const linked = { ...target, url: "https://github.fixture.invalid/owner/repo/pull/12" };
    const native = useRightPanelStore.getState();
    const focused = vi.fn();
    const navigation = createSpatialSurfaceNavigation(hook, "thread-source", focused);
    await act(() => {
      native.openPullRequest(ref, linked);
      navigation.openPullRequest(ref, linked);
    });
    const original = hook.toolPanes[0]!;
    const listed = {
      ...target,
      host: "github.fixture.invalid",
      ...(url === undefined ? {} : { url }),
    };
    await act(() => {
      navigation.open(ref, "files");
      native.openPullRequest(ref, listed);
      navigation.openPullRequest(ref, listed);
    });

    expect(hook.toolPanes.map((pane) => pane.paneId)).toEqual([
      expect.any(String),
      original.paneId,
    ]);
    expect(hook.toolPanes[1]).toEqual(original);
    expect(hook.toolPanes[1]?.surface).toEqual(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces[0],
    );
    expect(focused).toHaveBeenLastCalledWith(original.paneId);

    const updated = { ...linked, url: `${linked.url}#discussion` };
    await act(() => {
      native.openPullRequest(ref, updated);
      navigation.openPullRequest(ref, updated);
    });
    expect(hook.toolPanes[1]?.paneId).toBe(original.paneId);
    expect(hook.toolPanes[1]?.surface).toMatchObject(updated);
    expect(hook.toolPanes[1]?.surface).toEqual(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces[0],
    );
  },
);

it("keeps file reveal state and terminal split changes on their own pane", async () => {
  await mount();
  let paneId = "";
  await act(() => {
    paneId = hook.addEmpty(thread("t1"), null);
  });
  const focused = vi.fn();
  const navigation = () => createSpatialSurfaceNavigation(hook, paneId, focused);
  await act(() => navigation().openFile(thread("t1"), "."));
  expect(hook.toolPanes).toMatchObject([{ paneId, surface: { id: "files", kind: "files" } }]);
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
    accepted = navigation.openProactive(
      thread("t1"),
      { kind: "diff", turnId: RunId.make("turn-1") },
      revision,
    );
  });
  expect(accepted).toBe(false);
  expect(hook.toolPanes).toHaveLength(1);
  expect(focused).toHaveBeenCalledTimes(1);
});

it("adds a proactive diff beside a pull request without moving focus", async () => {
  await mount();
  const ref = thread("t1");
  const focused = vi.fn();
  const navigation = createSpatialSurfaceNavigation(hook, "thread-source", focused);
  await act(() =>
    navigation.openPullRequest(ref, { projectId: "p", repository: "owner/repo", number: 12 }),
  );
  const pullRequest = hook.toolPanes[0]!;
  const revision = navigation.getUserActionRevision(ref);
  let accepted = false;
  await act(() => {
    accepted = navigation.openProactive(
      ref,
      { kind: "diff", turnId: RunId.make("turn-1") },
      revision,
    );
  });
  expect(accepted).toBe(true);
  expect(hook.toolPanes).toHaveLength(2);
  expect(hook.toolPanes).toContainEqual(pullRequest);
  expect(hook.toolPanes.find((pane) => pane.surface?.kind === "diff")).toBeDefined();
  expect(focused.mock.calls).toEqual([[pullRequest.paneId]]);
  expect(navigation.getUserActionRevision(ref)).toBe(revision);
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

it("matches native terminal selection and split layout while closing a three-terminal group", async () => {
  await mount();
  const ref = thread("t1");
  const native = useRightPanelStore.getState();
  const navigation = createSpatialSurfaceNavigation(hook, "thread-source", vi.fn());
  await act(() => {
    native.openTerminal(ref, "one");
    navigation.openTerminal(ref, "one");
    native.splitTerminal(ref, "terminal:one", "two", "vertical");
    navigation.splitTerminal(ref, "terminal:one", "two", "vertical");
    native.splitTerminal(ref, "terminal:one", "three", "horizontal");
    navigation.splitTerminal(ref, "terminal:one", "three", "horizontal");
    native.activateTerminal(ref, "terminal:one", "two");
    navigation.activateTerminal(ref, "terminal:one", "two");
    native.closeTerminal(ref, "terminal:one", "two");
    navigation.closeTerminal(ref, "terminal:one", "two");
  });
  const expected = [
    {
      id: "terminal:one",
      kind: "terminal",
      resourceId: "one",
      terminalIds: ["one", "three"],
      activeTerminalId: "three",
    },
  ];
  expect(hook.toolPanes.map((pane) => pane.surface)).toEqual(expected);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
  ).toEqual(expected);
  await act(() => {
    native.closeTerminal(ref, "terminal:one", "one");
    navigation.closeTerminal(ref, "terminal:one", "one");
  });
  expect(hook.toolPanes[0]?.surface).toMatchObject({
    terminalIds: ["three"],
    activeTerminalId: "three",
  });
  await act(() => {
    native.closeTerminal(ref, "terminal:one", "three");
    navigation.closeTerminal(ref, "terminal:one", "three");
  });
  expect(hook.toolPanes).toEqual([]);
  expect(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
  ).toEqual([]);
});

it.each([
  { first: "docs///", path: "docs", line: 0, expectedLine: 1 },
  { first: "C:/", path: "C:/", line: 8.75, expectedLine: 8 },
  { first: "/", path: "/", line: Number.NaN, expectedLine: null },
  {
    first: " notes/file ",
    path: " notes/file ",
    line: Number.POSITIVE_INFINITY,
    expectedLine: null,
  },
])(
  "matches native file identity and repeated line reveal for $first",
  async ({ first, path, line, expectedLine }) => {
    await mount();
    const ref = thread("t1");
    const native = useRightPanelStore.getState();
    const navigation = createSpatialSurfaceNavigation(hook, "thread-source", vi.fn());
    await act(() => {
      native.openFile(ref, first, 3);
      navigation.openFile(ref, first, 3);
      native.openFile(ref, path, line);
      navigation.openFile(ref, path, line);
    });
    const expected = [
      {
        id: `file:${path}`,
        kind: "file",
        relativePath: path,
        revealLine: expectedLine,
        revealRequestId: 2,
      },
    ];
    expect(hook.toolPanes.map((pane) => pane.surface)).toEqual(expected);
    expect(
      selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
    ).toEqual(expected);
  },
);

it("matches native device title trimming and fallback without changing the device resource", async () => {
  await mount();
  const ref = thread("t1");
  const native = useRightPanelStore.getState();
  const navigation = createSpatialSurfaceNavigation(hook, "thread-source", vi.fn());
  const target = { hostId: "local", deviceId: "phone", platform: "ios", name: "Phone" } as const;
  await act(() => {
    native.openDevice(ref, target);
    navigation.openDevice(ref, target);
    native.renameDevice(ref, "device:local:phone", "  Test phone  ");
    navigation.renameDevice(ref, "device:local:phone", "  Test phone  ");
  });
  expect(hook.toolPanes[0]?.surface).toMatchObject({ title: "Test phone", target });
  expect(hook.toolPanes.map((pane) => pane.surface)).toEqual(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
  );
  await act(() => {
    native.renameDevice(ref, "device:local:phone", "  ");
    navigation.renameDevice(ref, "device:local:phone", "  ");
  });
  expect(hook.toolPanes[0]?.surface).toMatchObject({ title: "Phone", target });
  expect(hook.toolPanes.map((pane) => pane.surface)).toEqual(
    selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref).surfaces,
  );
});

it.each([false, true])(
  "keeps one browser owner after a background reveal (existing pane=%s)",
  async (existing) => {
    await mount();
    const focused = vi.fn();
    const ref = thread("background");
    const other = thread("other");
    const navigation = createSpatialSurfaceNavigation(hook, "thread-source", focused);
    if (existing) await act(() => navigation.openBrowser(ref, "shared-tab"));
    const paneId = hook.toolPanes[0]?.paneId;
    const revision = navigation.getUserActionRevision(ref);
    focused.mockClear();
    usePreviewMiniPlayerStore.getState().open(ref, { kind: "browser", tabId: "shared-tab" });
    usePreviewMiniPlayerStore.getState().open(other, { kind: "browser", tabId: "shared-tab" });
    await act(() => {
      navigation.openBrowser(ref, "shared-tab", true);
    });
    expect(hook.toolPanes).toHaveLength(1);
    expect(hook.toolPanes[0]?.surface).toEqual(browserSurface("shared-tab"));
    if (existing) expect(hook.toolPanes[0]?.paneId).toBe(paneId);
    expect(focused).not.toHaveBeenCalled();
    expect(navigation.getUserActionRevision(ref)).toBe(revision);
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, ref),
    ).toBeNull();
    expect(
      selectThreadPreviewMiniPlayer(usePreviewMiniPlayerStore.getState().byThreadKey, other)
        ?.source,
    ).toEqual({ kind: "browser", tabId: "shared-tab" });
  },
);
