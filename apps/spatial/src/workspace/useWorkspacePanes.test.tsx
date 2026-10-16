import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { threadPaneId, useWorkspacePanes, type WorkspaceLayoutMode } from "./useWorkspacePanes";
import { useToolPanes } from "./useToolPanes";

const data = vi.hoisted(() => ({
  catalogReady: true,
  bootstrapped: true,
  localEnvironmentEnabled: true,
  primaryEnvironmentId: "e" as string | null,
  threads: [
    {
      id: "one",
      projectId: "p1",
      environmentId: "e",
      title: "One",
      archivedAt: null,
      updatedAt: "3",
    },
    {
      id: "two",
      projectId: "p1",
      environmentId: "e",
      title: "Two",
      archivedAt: null,
      updatedAt: "2",
    },
    {
      id: "three",
      projectId: "p2",
      environmentId: "e",
      title: "Three",
      archivedAt: null,
      updatedAt: "1",
    },
  ],
  groups: ["p1", "p2"].map((projectId) => ({
    projectKey: projectId,
    displayName: projectId,
    memberProjectRefs: [{ environmentId: "e", projectId }],
  })),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useAllEnvironmentShellsBootstrapped: () => data.bootstrapped,
  useProjects: () => data.groups,
  useThreadShells: () => data.threads,
}));
vi.mock("@t3tools/web/src/components/Sidebar.logic", () => ({
  sortLogicalProjectsForSidebar: (groups: unknown) => groups,
  orderItemsByPreferredIds: ({ items }: { items: unknown }) => items,
}));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({ useClientSettings: () => undefined }));
vi.mock("@t3tools/web/src/logicalProject", () => ({
  getProjectOrderKey: () => "unused",
  selectProjectGroupingSettings: () => ({}),
}));
vi.mock("@t3tools/web/src/sidebarProjectGrouping", () => ({
  buildSidebarProjectSnapshots: ({ projects }: { projects: unknown }) => projects,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ isReady: data.catalogReady }) }));
vi.mock("@t3tools/web/src/connection/catalog", () => ({
  environmentCatalog: { catalogValueAtom: {} },
}));
vi.mock("@t3tools/web/src/hostedPairing", () => ({ isHostedStaticApp: () => false }));
vi.mock("@t3tools/web/src/state/environments", () => ({
  usePrimaryEnvironmentId: () => data.primaryEnvironmentId,
}));
vi.mock("@t3tools/web/src/uiStateStore", () => ({
  legacyProjectCwdPreferenceKey: () => "unused",
  useUiStateStore: () => [],
}));

let tools: ReturnType<typeof useToolPanes>;
let panes: ReturnType<typeof useWorkspacePanes>;
let renderer: ReactTestRenderer | undefined;
function Probe({ mode, dismissed }: { mode: WorkspaceLayoutMode; dismissed: ReadonlySet<string> }) {
  const currentTools = useToolPanes();
  const currentPanes = useWorkspacePanes(mode, currentTools.toolPanes, dismissed);
  useEffect(() => {
    tools = currentTools;
    panes = currentPanes;
  });
  return null;
}
async function render(mode: WorkspaceLayoutMode, dismissed = new Set<string>()) {
  await act(() => {
    const element = <Probe mode={mode} dismissed={dismissed} />;
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
const id = (thread: string) => threadPaneId("e", thread);
const positions = () => panes!.map((pane) => [pane.paneId, pane.planeIndex, pane.slotIndex]);
beforeEach(() => {
  data.catalogReady = true;
  data.bootstrapped = true;
  data.localEnvironmentEnabled = true;
  data.primaryEnvironmentId = "e";
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    localStorage: { getItem: () => null, setItem: () => {} },
    desktopBridge: { getLocalEnvironmentEnabled: () => data.localEnvironmentEnabled },
  });
});

it("waits for the environment catalog before providing an initial pane layout", async () => {
  data.catalogReady = false;
  await render("rows");
  expect(panes).toBeNull();
  data.catalogReady = true;
  await render("rows");
  expect(positions()).toEqual([
    [id("one"), 0, 0],
    [id("two"), 0, 1],
    [id("three"), 1, 0],
  ]);
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it.each(["strip", "rows"] as const)(
  "adds beside the requested chat and dismisses only that chat in %s",
  async (mode) => {
    await render(mode);
    let first = "";
    let second = "";
    const owner = { environmentId: "e" as EnvironmentId, threadId: "two" as ThreadId };
    await act(() => {
      first = tools.addEmpty(owner, null);
    });
    await act(() => {
      tools.openSurface(
        owner,
        {
          id: "terminal:test",
          kind: "terminal",
          resourceId: "test",
          terminalIds: ["test"],
          activeTerminalId: "test",
        },
        first,
      );
    });
    const terminal = tools.toolPanes[0]!;
    await act(() => {
      second = tools.addEmpty(owner, null);
    });
    const original = positions();
    expect(original).toEqual([
      [id("one"), 0, 0],
      [id("two"), 0, 1],
      [second, 0, 2],
      [first, 0, 3],
      [id("three"), mode === "strip" ? 0 : 1, mode === "strip" ? 4 : 0],
    ]);
    await render(mode, new Set([id("two")]));
    expect(positions()).toEqual([
      [id("one"), 0, 0],
      [second, 0, 1],
      [first, 0, 2],
      [id("three"), mode === "strip" ? 0 : 1, mode === "strip" ? 3 : 0],
    ]);
    expect(panes!.find((pane) => pane.paneId === first)?.data).toBe(terminal);
    expect(tools.toolPanes.find((pane) => pane.paneId === first)).toBe(terminal);
    expect(data.threads.every((thread) => thread.archivedAt === null)).toBe(true);
    await render(mode);
    expect(positions()).toEqual(original);
    expect(tools.toolPanes.find((pane) => pane.paneId === first)).toBe(terminal);
    await render(mode, new Set(data.threads.map((thread) => id(thread.id))));
    expect(positions()).toEqual([
      [second, 0, 0],
      [first, 0, 1],
    ]);
    await render(mode, new Set([id("one"), id("two")]));
    expect(positions()).toEqual([
      [second, 0, 0],
      [first, 0, 1],
      [id("three"), mode === "strip" ? 0 : 1, mode === "strip" ? 2 : 0],
    ]);
  },
);

it("waits for local primary discovery even when the persisted catalog is already ready", async () => {
  data.primaryEnvironmentId = null;
  await render("strip");
  expect(panes).toBeNull();
  data.primaryEnvironmentId = "e";
  await render("strip");
  expect(panes?.map((pane) => pane.paneId)).toEqual([id("one"), id("two"), id("three")]);
});

it.each(["strip", "rows"] as const)(
  "loads remote %s panes when the local environment is disabled",
  async (mode) => {
    data.primaryEnvironmentId = null;
    data.localEnvironmentEnabled = false;
    data.bootstrapped = false;
    await render(mode);
    expect(panes).toBeNull();

    data.bootstrapped = true;
    await render(mode);
    expect(positions()).toEqual([
      [id("one"), 0, 0],
      [id("two"), 0, 1],
      [id("three"), mode === "strip" ? 0 : 1, mode === "strip" ? 2 : 0],
    ]);
  },
);

it("keeps layout changes responsive without repeated synchronous desktop settings reads", async () => {
  data.primaryEnvironmentId = null;
  data.localEnvironmentEnabled = false;
  const readEnabled = vi.spyOn(window.desktopBridge!, "getLocalEnvironmentEnabled");
  await render("strip");
  expect(panes?.map((pane) => pane.paneId)).toEqual([id("one"), id("two"), id("three")]);

  await render("rows", new Set([id("two")]));
  expect(positions()).toEqual([
    [id("one"), 0, 0],
    [id("three"), 1, 0],
  ]);
  await render("strip");
  expect(positions()).toEqual([
    [id("one"), 0, 0],
    [id("two"), 0, 1],
    [id("three"), 0, 2],
  ]);
  expect(readEnabled).toHaveBeenCalledTimes(1);

  await act(() => renderer!.unmount());
  renderer = undefined;
  data.localEnvironmentEnabled = true;
  await render("strip");
  expect(panes).toBeNull();
  expect(readEnabled).toHaveBeenCalledTimes(2);
});
