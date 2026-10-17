// @vitest-environment jsdom
import {
  v2Now,
  v2Projection,
  v2ThreadShell,
} from "../../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures.ts";
import { RegistryContext } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  CheckpointRef,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  RunId,
  type EditorId,
  type OrchestrationProjectShell,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, createRef, Profiler, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useThreadProjection } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { MessagesTimeline } from "./MessagesTimeline";

const fixture = vi.hoisted(() => ({
  cardRenders: 0,
  onListLoad: undefined as (() => void) | undefined,
  timelineRender: vi.fn(),
  menu: vi.fn().mockResolvedValue("editor:vscode"),
  openInEditor: vi.fn().mockResolvedValue({ _tag: "Success" }),
}));

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult, AtomRegistry } = await import("effect/reactivity");
  const {
    createEnvironmentThreadDetailAtoms,
    createEnvironmentThreadShellAtoms,
    EMPTY_ENVIRONMENT_THREAD_STATE,
  } = await import("@t3tools/client-runtime/state/threads");
  const { createEnvironmentProjectAtoms } = await import("@t3tools/client-runtime/state/projects");
  const { mergeWithDefaultKeybindings } = await import("@t3tools/shared/keybindings");
  const snapshots = Atom.family((_id: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(null).pipe(Atom.keepAlive),
  );
  const detail = Atom.family((_key: string) =>
    Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState, Error>>(
      AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE),
    ).pipe(Atom.keepAlive),
  );
  const input = {
    snapshotAtom: snapshots,
    catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
  };
  return {
    registry: AtomRegistry.make(),
    snapshots,
    detail,
    emptyDetail: EMPTY_ENVIRONMENT_THREAD_STATE,
    shells: createEnvironmentThreadShellAtoms(input),
    projects: createEnvironmentProjectAtoms(input),
    details: createEnvironmentThreadDetailAtoms((environmentId, threadId) =>
      detail(`${environmentId}:${threadId}`),
    ),
    configs: Atom.family((_id: EnvironmentId | null) =>
      Atom.make({
        availableEditors: ["vscode"] as EditorId[],
        shellRevealInFileManager: false,
        environment: { platform: { os: "linux" } },
      }).pipe(Atom.keepAlive),
    ),
    keybindings: Atom.make(mergeWithDefaultKeybindings([])),
    editors: Atom.make(["vscode"]),
    unusedBoolean: Atom.make(false),
    unusedConfigs: Atom.make(new Map()),
  };
});

vi.mock("../../state/threads", () => ({
  environmentThreadShells: atoms.shells,
  environmentThreadDetails: atoms.details,
}));
vi.mock("../../state/projects", () => ({ environmentProjects: atoms.projects }));
vi.mock("../../state/shell", () => ({
  environmentSnapshotAtom: atoms.snapshots,
  allEnvironmentShellsBootstrappedAtom: atoms.unusedBoolean,
  allEnvironmentProjectSnapshotsReadyAtom: atoms.unusedBoolean,
  shellEnvironment: { openInEditor: {} },
}));
vi.mock("../../state/server", () => ({
  serverEnvironment: { configValueAtom: atoms.configs },
  environmentServerConfigsAtom: atoms.unusedConfigs,
  primaryServerKeybindingsAtom: atoms.keybindings,
  primaryServerAvailableEditorsAtom: atoms.editors,
}));
vi.mock("../../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return atoms.registry;
  },
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: () => fixture.openInEditor,
}));
vi.mock("../../localApi", () => ({
  readLocalApi: () => ({ contextMenu: { show: fixture.menu } }),
}));
vi.mock("../../lib/openPullRequestLink", () => ({ useOpenPrLink: () => undefined }));
vi.mock("../../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../ChatMarkdown", () => ({
  default: ({ text }: { text: string }) => <p>{text}</p>,
  ChatMarkdownAssetImage: () => null,
}));
vi.mock("@legendapp/list/react", () => ({
  LegendList: (props: {
    data: Array<{ id: string }>;
    renderItem: (input: { item: { id: string } }) => ReactNode;
    ListHeaderComponent?: ReactNode;
    ListFooterComponent?: ReactNode;
    onLoad?: () => void;
  }) => {
    fixture.onListLoad = props.onLoad;
    return (
      <div>
        {props.ListHeaderComponent}
        {props.data.map((item) => (
          <div key={item.id}>{props.renderItem({ item })}</div>
        ))}
        {props.ListFooterComponent}
      </div>
    );
  },
}));
vi.mock("./ChangedFilesTree", () => ({
  ChangedFilesCard: (
    props: ComponentProps<typeof import("./ChangedFilesTree").ChangedFilesCard>,
  ) => {
    fixture.cardRenders++;
    return (
      <section data-testid="changed-files">
        <span>{props.files.length} changed files</span>
        {props.files.map((file) => (
          <button
            key={file.path}
            data-file={file.path}
            onContextMenu={(event) => props.onFileContextMenu?.(file.path, event)}
          >
            {file.path}
          </button>
        ))}
      </section>
    );
  },
}));

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const THREAD = ThreadId.make("thread");
const PROJECT = ProjectId.make("project");
const TURN = RunId.make("turn");
const MESSAGE = MessageId.make("assistant");
const DATE = "2026-10-15T00:00:00.000Z";
const FILE = "packages/app/src/index.ts";
let registry: AtomRegistry.AtomRegistry;
let host: HTMLDivElement;
let root: Root;

function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id: THREAD,
    projectId: PROJECT,
    title: "Thread",
    lineage: { ...v2ThreadShell.lineage, rootThreadId: THREAD },
    ...overrides,
  };
}

function thread(
  overrides: Partial<OrchestrationV2ThreadProjection["thread"]> = {},
): OrchestrationV2ThreadProjection {
  return {
    ...v2Projection,
    thread: {
      ...v2Projection.thread,
      id: THREAD,
      projectId: PROJECT,
      title: "Thread",
      lineage: { ...v2Projection.thread.lineage, rootThreadId: THREAD },
      ...overrides,
    },
  };
}

function project(environmentId = LOCAL): OrchestrationProjectShell {
  return {
    id: PROJECT,
    title: PROJECT,
    workspaceRoot: `/workspace/${environmentId}/packages/app`,
    repositoryIdentity: {
      canonicalKey: `${environmentId}/${PROJECT}`,
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://example.test/repo",
      },
      rootPath: `/workspace/${environmentId}`,
    },
    defaultModelSelection: null,
    scripts: [],
    createdAt: DATE,
    updatedAt: DATE,
  };
}

function publishShells(threads: readonly OrchestrationV2ThreadShell[], environmentId = LOCAL) {
  registry.set(atoms.snapshots(environmentId), {
    schemaVersion: 1,
    snapshotSequence: 1,
    archivedThreads: [],
    projects: [project(environmentId)],
    threads,
  });
}

function publishDetail(value: OrchestrationV2ThreadProjection | null, environmentId = LOCAL) {
  registry.set(
    atoms.detail(`${environmentId}:${THREAD}`),
    AsyncResult.success(
      value === null
        ? atoms.emptyDetail
        : { ...atoms.emptyDetail, data: Option.some(value), status: "live", error: Option.none() },
    ),
  );
}

function DetailWitness({ environmentId }: { environmentId: EnvironmentId }) {
  const value = useThreadProjection({ environmentId, threadId: THREAD });
  return (
    <output>{value?.projection.messages.at(-1)?.text ?? value?.projection.thread.title}</output>
  );
}

function props(environmentId = LOCAL): ComponentProps<typeof MessagesTimeline> {
  return {
    isWorking: false,
    providerStatuses: [],
    runs: [],
    onAnchorSizeChanged: () => {},
    activeTurnStartedAt: null,
    activeTurnInProgress: false,
    onOpenThread: () => {},
    onForkFromRun: async () => {},
    onRollbackCheckpoint: () => {},
    listRef: createRef<LegendListRef | null>(),
    latestRun: { runId: TURN, status: "completed", startedAt: DATE, completedAt: DATE },
    runningRunId: null,
    timelineEntries: [
      {
        id: "assistant-entry",
        kind: "message",
        createdAt: DATE,
        message: {
          id: MESSAGE,
          role: "assistant",
          text: "Updated the file.",
          runId: TURN,
          createdAt: DATE,
          updatedAt: DATE,
          streaming: false,
        },
      },
    ],
    turnDiffSummaries: [
      {
        runId: TURN,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint"),
        status: "ready",
        files: [{ path: FILE, kind: "modified", additions: 2, deletions: 1 }],
        assistantMessageId: MESSAGE,
        completedAt: DATE,
      },
    ],
    routeThreadKey: `${environmentId}:${THREAD}`,
    onOpenTurnDiff: () => {},
    supportsConversationRollback: false,
    onRevertToTurnCount: () => {},
    isRevertingCheckpoint: false,
    onImageExpand: () => {},
    activeThreadEnvironmentId: environmentId,
    markdownCwd: undefined,
    resolvedTheme: "light",
    timestampFormat: "locale",
    workspaceRoot: `/workspace/${environmentId}/packages/app`,
    anchorMessageId: null,
    onAnchorReady: () => {},
    contentInsetEndAdjustment: 0,
    liveFollowEnabled: true,
    onIsAtEndChange: () => {},
    onManualNavigation: () => {},
  };
}

const render = (value = props()) =>
  act(() =>
    root.render(
      <RegistryContext value={registry}>
        <Profiler id="timeline" onRender={fixture.timelineRender}>
          <MessagesTimeline {...value} />
        </Profiler>
        <DetailWitness environmentId={value.activeThreadEnvironmentId} />
      </RegistryContext>,
    ),
  );
const card = () => host.querySelector('[data-testid="changed-files"]')!;
const fileButton = () => host.querySelector<HTMLButtonElement>("[data-file]")!;
const openMenu = async () => {
  const menus = fixture.menu.mock.calls.length;
  const actions = fixture.openInEditor.mock.calls.length;
  await act(async () => {
    fileButton().dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 17, clientY: 23 }),
    );
  });
  expect(fixture.menu).toHaveBeenCalledTimes(menus + 1);
  expect(fixture.openInEditor).toHaveBeenCalledTimes(actions + 1);
};

beforeEach(() => {
  atoms.registry.dispose();
  registry = AtomRegistry.make();
  atoms.registry = registry;
  fixture.cardRenders = 0;
  fixture.timelineRender.mockClear();
  fixture.menu.mockClear();
  fixture.openInEditor.mockClear();
  useUiStateStore.setState({ threadChangedFilesExpandedById: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  for (const environmentId of [LOCAL, REMOTE]) {
    publishShells([shell()], environmentId);
    publishDetail(thread(), environmentId);
  }
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  registry.dispose();
  host.remove();
  vi.unstubAllGlobals();
});

it.each(["messages", "metadata"] as const)(
  "keeps changed files untouched by unrelated same-thread %s",
  async (kind) => {
    await render();
    const before = fixture.cardRenders;
    const commits = fixture.timelineRender.mock.calls.length;
    const content = card().textContent;
    const value =
      kind === "messages"
        ? {
            ...thread(),
            messages: [
              {
                id: MessageId.make("new-message"),
                threadId: THREAD,
                runId: TURN,
                nodeId: null,
                role: "assistant" as const,
                text: "Live detail advanced",
                attachments: [],
                streaming: true,
                createdAt: v2Now,
                updatedAt: v2Now,
                createdBy: "agent" as const,
                creationSource: "provider" as const,
              },
            ],
          }
        : thread({ title: "Live detail advanced" });
    await act(() => publishDetail(value));
    expect(host.querySelector("output")?.textContent).toBe("Live detail advanced");
    expect(card().textContent).toBe(content);
    expect(fixture.cardRenders).toBe(before);
    expect(fixture.timelineRender).toHaveBeenCalledTimes(commits);
  },
);

it("uses available shell/project metadata before detail arrives", async () => {
  publishDetail(null);
  await render();
  await openMenu();
  expect(fixture.openInEditor).toHaveBeenLastCalledWith({
    environmentId: LOCAL,
    input: { cwd: "/workspace/local/packages/app/src/index.ts", editor: "vscode" },
  });
});

it("recovers file context when shell metadata returns without subscribing to live detail", async () => {
  publishShells([]);
  publishDetail(thread());
  await render();
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/packages/app/src/index.ts",
  );
  await act(() => publishShells([shell()]));
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/src/index.ts",
  );
  const before = fixture.cardRenders;
  const commits = fixture.timelineRender.mock.calls.length;
  await act(() =>
    publishDetail(thread({ worktreePath: "/stale-worktree", title: "Stale detail title" })),
  );
  expect(fixture.cardRenders).toBe(before);
  expect(fixture.timelineRender).toHaveBeenCalledTimes(commits);
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/src/index.ts",
  );
});

it("isolates colliding thread/project IDs across environments and switches the file menu target", async () => {
  await render();
  const before = fixture.cardRenders;
  await act(() => publishDetail(thread({ title: "Remote update" }), REMOTE));
  expect(fixture.cardRenders).toBe(before);
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].environmentId).toBe(LOCAL);
  await render(props(REMOTE));
  await openMenu();
  expect(fixture.openInEditor).toHaveBeenLastCalledWith({
    environmentId: REMOTE,
    input: { cwd: "/workspace/remote/packages/app/src/index.ts", editor: "vscode" },
  });
});

it("holds a populated timeline until the native list is ready and releases readiness when unmounted", async () => {
  const onReadyChange = vi.fn();
  const value = { ...props(), onReadyChange };
  await render(value);
  expect(onReadyChange).toHaveBeenLastCalledWith(false, value.routeThreadKey);
  await act(() => fixture.onListLoad?.());
  expect(onReadyChange).toHaveBeenLastCalledWith(true, value.routeThreadKey);
  await act(() => root.render(null));
  expect(onReadyChange).toHaveBeenLastCalledWith(false, value.routeThreadKey);
});

it("reports an empty timeline ready and waits for a newly mounted list after messages arrive", async () => {
  const onReadyChange = vi.fn();
  const value = props();
  await render({
    ...value,
    onReadyChange,
    timelineEntries: [],
    turnDiffSummaries: [],
    latestRun: null,
  });
  expect(onReadyChange).toHaveBeenLastCalledWith(true, value.routeThreadKey);
  await render({ ...value, onReadyChange });
  expect(onReadyChange).toHaveBeenLastCalledWith(false, value.routeThreadKey);
  await act(() => fixture.onListLoad?.());
  expect(onReadyChange).toHaveBeenLastCalledWith(true, value.routeThreadKey);
});
