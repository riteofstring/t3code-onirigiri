import { RunId } from "@t3tools/contracts";
// @vitest-environment jsdom
import type {
  OnirigiriPaneDefinition,
  OnirigiriWorkspaceHandle,
  OnirigiriWorkspaceProps,
  WorkspacePane,
} from "@riteofstring/onirigiri";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { terminalSurface } from "@t3tools/web/src/rightPanelStore";
import { SpatialWorkspace } from "./SpatialWorkspace";
import { createSpatialSurfaceNavigation, type ToolPaneController } from "./SpatialSurfaceHost";
import { toolPaneSurface, type ToolPane } from "./useToolPanes";
import { stubWorkspaceFrames } from "./workspaceTestMocks";

const fixture = vi.hoisted(() => ({
  panes: [] as OnirigiriPaneDefinition[],
  controller: null as ToolPaneController | null,
  isPaneClosing: (_id: string): boolean => false,
  closeTerminal: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => {
  const router = { navigate: vi.fn(), matchRoutes: () => [], subscribe: () => () => {} };
  return { useRouter: () => router };
});
vi.mock("@t3tools/web/src/state/terminal", () => ({ terminalEnvironment: { close: {} } }));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({
  useAtomCommand: (_command: unknown, label: string) =>
    label === "terminal close" ? fixture.closeTerminal : vi.fn(),
}));
vi.mock("@t3tools/web/src/lib/terminalCloseConfirm", () => ({
  confirmTerminalClose: fixture.confirm,
}));
vi.mock("./SpatialSurfaceProvider", async () => (await import("./workspaceTestMocks")).controller);
vi.mock("./useWorkspacePanes", async () => {
  const { useMemo } = await import("react");
  return {
    threadPaneId: (environmentId: string, threadId: string) =>
      `thread:${environmentId}:${threadId}`,
    useWorkspacePanes: (_mode: string, tools: ToolPane[]) =>
      useMemo(() => {
        fixture.panes = [
          {
            paneId: "thread:e:owner",
            surfaceKind: "thread",
            title: "Owner",
            planeIndex: 0,
            slotIndex: 0,
            data: { environmentId: "e", threadId: "owner" },
          },
          ...tools.map((tool, index) => ({
            paneId: tool.paneId,
            surfaceKind: "surface",
            title: "Terminal",
            planeIndex: 0,
            slotIndex: index + 1,
            data: tool,
          })),
        ];
        return fixture.panes;
      }, [tools]),
  };
});
vi.mock("@riteofstring/onirigiri", async (importOriginal) => {
  const engine = await importOriginal<typeof import("@riteofstring/onirigiri")>();
  const { useImperativeHandle } = await import("react");
  return {
    ...engine,
    OnirigiriWorkspace: (
      props: OnirigiriWorkspaceProps & { ref: React.Ref<OnirigiriWorkspaceHandle> },
    ) => {
      useImperativeHandle(
        props.ref,
        () =>
          ({
            getLayout: () => props.initialLayout,
            getScene: () => ({ padding: 0 }),
            getSnapshot: () => ({ focusedPaneId: "thread:e:owner", presentationMode: "normal" }),
            focusPane: () => true,
            restoreLayout: () => true,
            configurePane: () => true,
            renamePane: () => true,
            closePane: (paneId: string) => {
              const pane = fixture.panes.find((entry) => entry.paneId === paneId)!;
              return Promise.resolve(props.onPaneClose?.(pane as WorkspacePane));
            },
          }) as unknown as OnirigiriWorkspaceHandle,
      );
      return (
        <>
          {fixture.panes.map((pane) => (
            <div key={pane.paneId}>
              {props.renderPane?.(
                pane as WorkspacePane,
                { focused: true, visible: true, maximized: false } as Parameters<
                  NonNullable<OnirigiriWorkspaceProps["renderPane"]>
                >[1],
              )}
              {pane.surfaceKind !== "thread" ? (
                <button onClick={() => void props.onPaneClose?.(pane as WorkspacePane)}>
                  Close terminal group
                </button>
              ) : null}
            </div>
          ))}
        </>
      );
    },
  };
});
vi.mock("./useSavedPanePictures", async () => (await import("./workspaceTestMocks")).savedPictures);
vi.mock("./WorkspaceToolbar", () => ({ WorkspaceToolbar: () => null }));
vi.mock("./WorkspaceTooltips", async () => (await import("./workspaceTestMocks")).tooltips);
vi.mock("./ToolPaneView", () => ({
  ToolPaneView: ({
    pane,
    focused,
    onDismissDeviceSetup,
  }: {
    pane: ToolPane;
    focused: boolean;
    onDismissDeviceSetup: (
      surface: Extract<ReturnType<typeof toolPaneSurface>, { kind: "device" }>,
    ) => void;
  }) => {
    const surface = toolPaneSurface(pane);
    return (
      <section
        aria-label={surface?.kind === "terminal" ? "Terminal group" : "Tool pane"}
        data-focused={focused}
      >
        <output>{JSON.stringify(surface)}</output>
        {surface?.kind === "device" ? (
          <button onClick={() => onDismissDeviceSetup(surface)}>Cancel device setup</button>
        ) : null}
      </section>
    );
  },
}));
vi.mock("./SpatialSurfaceHost", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./SpatialSurfaceHost")>()),
  SpatialSurfaceHost: ({
    children,
    controller,
    isPaneClosing,
  }: {
    children: ReactNode;
    controller: ToolPaneController;
    isPaneClosing: (id: string) => boolean;
  }) => {
    fixture.controller = controller;
    fixture.isPaneClosing = isPaneClosing;
    return children;
  },
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
vi.mock("./ThreadCard", () => ({
  PaneLoading: () => null,
  ThreadCard: () => null,
  ToolCard: () => null,
}));
vi.mock("./DraftPane", () => ({ DraftPane: () => null }));
vi.mock("@t3tools/web/src/hooks/useHandleNewThread", () => {
  const newThread = vi.fn();
  return { useNewThreadHandler: () => newThread };
});
vi.mock("./ThreadPane", async () => {
  const { createContext } = await import("react");
  return {
    SpatialWorkspaceActiveContext: createContext(true),
    ThreadPane: () => <textarea aria-label="Thread composer" />,
  };
});

const owner = { environmentId: "e" as EnvironmentId, threadId: "owner" as ThreadId };
const firstId = "onirigiri-pane-first";
const secondId = "onirigiri-pane-second";
const storageKey = "onirigiri-t3:tool-panes";
let host: HTMLDivElement;
let root: Root;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function stored(): ToolPane[] {
  return JSON.parse(localStorage.getItem(storageKey) ?? "[]");
}
function closeButton() {
  return host.querySelector<HTMLButtonElement>("button")!;
}
async function mount() {
  await act(() =>
    root.render(<SpatialWorkspace active target={{ kind: "server", threadRef: owner }} />),
  );
}
async function clickClose() {
  await act(() => closeButton().click());
}
function group() {
  return host.querySelector<HTMLElement>('[aria-label="Terminal group"]');
}

beforeEach(() => {
  stubWorkspaceFrames();
  fixture.controller = null;
  fixture.closeTerminal.mockReset().mockResolvedValue({ _tag: "Success" });
  fixture.confirm.mockReset().mockResolvedValue(true);
  localStorage.clear();
  localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        ...owner,
        paneId: "tool-group",
        kind: "surface",
        surface: {
          ...terminalSurface(firstId),
          terminalIds: [firstId, secondId],
          activeTerminalId: secondId,
        },
      },
    ]),
  );
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

it("keeps the pane and its saved position when device setup is dismissed", async () => {
  const neighbor = stored()[0]!;
  const setup: ToolPane = {
    ...owner,
    paneId: "tool-setup",
    kind: "surface",
    surface: { id: "device", kind: "device" },
  };
  localStorage.setItem(storageKey, JSON.stringify([setup, neighbor]));
  await mount();
  const revision = fixture.controller!.getUserActionRevision(owner);
  await act(() => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === "Cancel device setup")!
      .click();
  });
  const empty: ToolPane = { ...owner, paneId: setup.paneId, kind: "empty" };
  expect(stored()).toEqual([empty, neighbor]);
  expect(fixture.panes.map((pane) => pane.paneId)).toEqual([
    "thread:e:owner",
    setup.paneId,
    neighbor.paneId,
  ]);
  expect(fixture.controller!.getUserActionRevision(owner)).toBe(revision + 1);
  expect(fixture.closeTerminal).not.toHaveBeenCalled();
  expect(fixture.confirm).not.toHaveBeenCalled();
  await act(() => root.unmount());
  root = createRoot(host);
  await mount();
  expect(stored()).toEqual([empty, neighbor]);
  await act(() =>
    createSpatialSurfaceNavigation(fixture.controller!, setup.paneId, vi.fn()).open(owner, "files"),
  );
  expect(stored()).toEqual([
    { ...empty, kind: "surface", surface: { id: "files", kind: "files" } },
    neighbor,
  ]);
});

it("retains only the failed terminal after partial group closure and retries without closing its former sibling twice", async () => {
  fixture.closeTerminal
    .mockResolvedValueOnce({ _tag: "Success" })
    .mockResolvedValueOnce({ _tag: "Failure" });
  await mount();
  await clickClose();
  expect(stored()).toHaveLength(1);
  expect(toolPaneSurface(stored()[0]!)).toMatchObject({
    terminalIds: [secondId],
    activeTerminalId: secondId,
  });
  expect(JSON.parse(group()!.querySelector("output")!.textContent!)).toMatchObject({
    terminalIds: [secondId],
    activeTerminalId: secondId,
  });
  expect(group()?.parentElement?.hasAttribute("inert")).toBe(false);
  expect(fixture.confirm).toHaveBeenNthCalledWith(1, [secondId, firstId]);
  await clickClose();
  expect(fixture.closeTerminal.mock.calls.map(([request]) => request.input.terminalId)).toEqual([
    firstId,
    secondId,
    secondId,
  ]);
  expect(fixture.confirm).toHaveBeenNthCalledWith(2, [secondId]);
  expect(stored()).toEqual([]);
  expect(group()).toBeNull();
});

it("selects the last remaining terminal after partial outer closure removes the active one", async () => {
  const thirdId = "onirigiri-pane-third";
  const pane = stored()[0]!;
  localStorage.setItem(
    storageKey,
    JSON.stringify([
      {
        ...pane,
        surface: { ...terminalSurface(firstId), terminalIds: [firstId, secondId, thirdId] },
      },
    ]),
  );
  fixture.closeTerminal
    .mockResolvedValueOnce({ _tag: "Success" })
    .mockResolvedValueOnce({ _tag: "Failure" });
  await mount();
  await clickClose();
  expect(toolPaneSurface(stored()[0]!)).toMatchObject({
    terminalIds: [secondId, thirdId],
    activeTerminalId: thirdId,
  });
  expect(JSON.parse(group()!.querySelector("output")!.textContent!)).toMatchObject({
    terminalIds: [secondId, thirdId],
    activeTerminalId: thirdId,
  });
  await clickClose();
  expect(fixture.closeTerminal.mock.calls.map(([request]) => request.input.terminalId)).toEqual([
    firstId,
    secondId,
    secondId,
    thirdId,
  ]);
  expect(stored()).toEqual([]);
});

it("ignores duplicate close requests during both confirmation and the terminal RPC", async () => {
  const confirmation = deferred<boolean>();
  const closing = deferred<{ _tag: "Success" }>();
  fixture.confirm.mockReturnValueOnce(confirmation.promise);
  fixture.closeTerminal.mockReturnValueOnce(closing.promise);
  await mount();
  await act(() => {
    closeButton().click();
    closeButton().click();
  });
  expect(fixture.confirm).toHaveBeenCalledTimes(1);
  expect(fixture.closeTerminal).not.toHaveBeenCalled();
  expect(group()?.parentElement?.hasAttribute("inert")).toBe(true);
  expect(group()?.dataset.focused).toBe("false");
  await act(() => confirmation.resolve(true));
  await clickClose();
  expect(fixture.closeTerminal).toHaveBeenCalledTimes(1);
  expect(fixture.confirm).toHaveBeenCalledTimes(1);
  expect(fixture.controller!.getUserActionRevision(owner)).toBe(1);
  await act(() => closing.resolve({ _tag: "Success" }));
  expect(fixture.closeTerminal.mock.calls.map(([request]) => request.input.terminalId)).toEqual([
    firstId,
    secondId,
  ]);
  expect(stored()).toEqual([]);
  expect(group()).toBeNull();
});

it("invalidates pending proactive navigation immediately and preserves the group when close is cancelled", async () => {
  const confirmation = deferred<boolean>();
  fixture.confirm.mockReturnValueOnce(confirmation.promise);
  await mount();
  const before = stored();
  const navigation = createSpatialSurfaceNavigation(
    fixture.controller!,
    "tool-group",
    vi.fn(),
    fixture.isPaneClosing,
  );
  const pendingRevision = navigation.getUserActionRevision(owner);
  await clickClose();
  expect(navigation.getUserActionRevision(owner)).toBe(pendingRevision + 1);
  let reopened = true;
  await act(() => {
    reopened = navigation.openProactive(
      owner,
      { kind: "diff", turnId: RunId.make("turn-1") },
      pendingRevision,
    );
  });
  expect(reopened).toBe(false);
  expect(stored()).toEqual(before);
  await act(() => confirmation.resolve(false));
  expect(fixture.closeTerminal).not.toHaveBeenCalled();
  expect(stored()).toEqual(before);
  expect(group()?.parentElement?.hasAttribute("inert")).toBe(false);
  expect(group()?.dataset.focused).toBe("true");
  expect(fixture.isPaneClosing("tool-group")).toBe(false);
  await clickClose();
  expect(stored()).toEqual([]);
});
