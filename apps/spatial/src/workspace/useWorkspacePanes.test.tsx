import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { threadPaneId, useWorkspacePanes, type WorkspaceLayoutMode } from "./useWorkspacePanes";
import { useToolPanes } from "./useToolPanes";

const data = vi.hoisted(() => ({
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
  useAllEnvironmentShellsBootstrapped: () => true,
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
vi.mock("@t3tools/web/src/state/environments", () => ({ usePrimaryEnvironmentId: () => "e" }));
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { localStorage: { getItem: () => null, setItem: () => {} } });
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
    await act(() => tools.choose(first, "terminal"));
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
