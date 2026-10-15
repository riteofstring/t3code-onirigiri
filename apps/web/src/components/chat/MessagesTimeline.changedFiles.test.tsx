// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import type { LegendListRef } from "@legendapp/list/react";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  CheckpointRef,
  EnvironmentId,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type EditorId,
  type OrchestrationProjectShell,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { act, createRef, Profiler, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useThread } from "../../state/entities";
import { useUiStateStore } from "../../uiStateStore";
import { MessagesTimeline } from "./MessagesTimeline";

const fixture = vi.hoisted(() => ({
  cardRenders: 0,
  timelineRender: vi.fn(),
  menu: vi.fn().mockResolvedValue("editor:vscode"),
  openInEditor: vi.fn().mockResolvedValue({ _tag: "Success" }),
  openDiff: vi.fn(),
}));

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult, AtomRegistry } = await import("effect/unstable/reactivity");
  const {
    createEnvironmentThreadDetailAtoms,
    createEnvironmentThreadShellAtoms,
    EMPTY_ENVIRONMENT_THREAD_STATE,
  } = await import("@t3tools/client-runtime/state/threads");
  const { createEnvironmentProjectAtoms } = await import("@t3tools/client-runtime/state/projects");
  const { mergeWithDefaultKeybindings } = await import("@t3tools/shared/keybindings");
  const snapshots = Atom.family((_id: EnvironmentId) =>
    Atom.make<OrchestrationShellSnapshot | null>(null).pipe(Atom.keepAlive),
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
  }) => (
    <div>
      {props.ListHeaderComponent}
      {props.data.map((item) => (
        <div key={item.id}>{props.renderItem({ item })}</div>
      ))}
      {props.ListFooterComponent}
    </div>
  ),
}));
vi.mock("./ChangedFilesTree", () => ({
  ChangedFilesCard: (
    props: ComponentProps<typeof import("./ChangedFilesTree").ChangedFilesCard>,
  ) => {
    fixture.cardRenders++;
    return (
      <section data-testid="changed-files">
        <span>{props.files.length} changed files</span>
        <button onClick={props.onToggleAllDirectories}>
          {props.allDirectoriesExpanded ? "Collapse folders" : "Expand folders"}
        </button>
        {props.files.map((file) => (
          <button
            key={file.path}
            data-file={file.path}
            onClick={() => props.onOpenTurnDiff(props.turnId, file.path)}
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
const OTHER_PROJECT = ProjectId.make("other-project");
const TURN = TurnId.make("turn");
const MESSAGE = MessageId.make("assistant");
const DATE = "2026-10-15T00:00:00.000Z";
const FILE = "packages/app/src/index.ts";
let registry: AtomRegistry.AtomRegistry;
let host: HTMLDivElement;
let root: Root;

function shell(overrides: Partial<OrchestrationThreadShell> = {}): OrchestrationThreadShell {
  return {
    id: THREAD,
    projectId: PROJECT,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: DATE,
    updatedAt: DATE,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    linkedPullRequest: null,
    pullRequests: [],
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  };
}

function thread(overrides: Partial<OrchestrationThread> = {}): OrchestrationThread {
  return {
    ...shell(),
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    ...overrides,
  };
}

function project(environmentId = LOCAL, id = PROJECT): OrchestrationProjectShell {
  return {
    id,
    title: id,
    workspaceRoot: `/workspace/${environmentId}/packages/app`,
    repositoryIdentity: {
      canonicalKey: `${environmentId}/${id}`,
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

function publishShells(
  threads: readonly OrchestrationThreadShell[],
  environmentId = LOCAL,
  projects: readonly OrchestrationProjectShell[] = [project(environmentId)],
) {
  registry.set(atoms.snapshots(environmentId), {
    snapshotSequence: 1,
    updatedAt: DATE,
    projects,
    threads,
  });
}

function publishDetail(value: OrchestrationThread | null, environmentId = LOCAL) {
  registry.set(
    atoms.detail(`${environmentId}:${THREAD}`),
    AsyncResult.success(
      value === null
        ? atoms.emptyDetail
        : { data: Option.some(value), status: "live", error: Option.none(), page: Option.none() },
    ),
  );
}

function DetailWitness({ environmentId }: { environmentId: EnvironmentId }) {
  const value = useThread({ environmentId, threadId: THREAD });
  return <output>{value?.messages.at(-1)?.text ?? value?.activities.at(-1)?.summary}</output>;
}

function props(environmentId = LOCAL): ComponentProps<typeof MessagesTimeline> {
  return {
    isWorking: false,
    activeTurnStartedAt: null,
    listRef: createRef<LegendListRef | null>(),
    latestTurn: { turnId: TURN, state: "completed", startedAt: DATE, completedAt: DATE },
    runningTurnId: null,
    timelineEntries: [
      {
        id: "assistant-entry",
        kind: "message",
        createdAt: DATE,
        message: {
          id: MESSAGE,
          role: "assistant",
          text: "Updated the file.",
          turnId: TURN,
          createdAt: DATE,
          updatedAt: DATE,
          streaming: false,
        },
      },
    ],
    turnDiffSummaries: [
      {
        turnId: TURN,
        checkpointTurnCount: 1,
        checkpointRef: CheckpointRef.make("checkpoint"),
        status: "ready",
        files: [{ path: FILE, kind: "modified", additions: 2, deletions: 1 }],
        assistantMessageId: MESSAGE,
        completedAt: DATE,
      },
    ],
    routeThreadKey: `${environmentId}:${THREAD}`,
    onOpenTurnDiff: fixture.openDiff,
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
  fixture.openDiff.mockClear();
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

it.each(["messages", "activities"] as const)(
  "keeps changed files untouched by unrelated same-thread %s",
  async (kind) => {
    await render();
    const before = fixture.cardRenders;
    const commits = fixture.timelineRender.mock.calls.length;
    const content = card().textContent;
    const value =
      kind === "messages"
        ? thread({
            messages: [
              {
                id: MessageId.make("new-message"),
                role: "assistant",
                text: "Live detail advanced",
                turnId: TURN,
                createdAt: DATE,
                updatedAt: DATE,
                streaming: true,
              },
            ],
          })
        : thread({
            activities: [
              {
                id: EventId.make("agent-progress"),
                kind: "agent.updated",
                tone: "info",
                summary: "Live detail advanced",
                payload: { progress: "working" },
                turnId: TURN,
                createdAt: DATE,
              },
            ],
          });
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

it("updates file actions for project and worktree changes and keeps menu capabilities live", async () => {
  const value = props();
  await render(value);
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/src/index.ts",
  );
  const changedProject = {
    ...project(LOCAL, OTHER_PROJECT),
    repositoryIdentity: {
      ...project().repositoryIdentity!,
      rootPath: "/workspace/local/packages/app",
    },
  };
  await act(() =>
    publishShells([shell({ projectId: OTHER_PROJECT })], LOCAL, [project(), changedProject]),
  );
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/packages/app/src/index.ts",
  );
  await act(() =>
    publishShells([shell({ projectId: OTHER_PROJECT, worktreePath: "/worktrees/live" })], LOCAL, [
      changedProject,
    ]),
  );
  await render({ ...value, workspaceRoot: "/worktrees/live" });
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/worktrees/live/packages/app/src/index.ts",
  );
  await act(() =>
    registry.set(atoms.configs(LOCAL), {
      ...registry.get(atoms.configs(LOCAL)),
      availableEditors: ["vscode", "file-manager"],
      shellRevealInFileManager: true,
    }),
  );
  await openMenu();
  expect(fixture.menu.mock.lastCall?.[0].map((item: { id: string }) => item.id)).toEqual([
    "open",
    "reveal-in-folder",
    "open-with",
  ]);
  await act(() => fileButton().click());
  expect(fixture.openDiff).toHaveBeenLastCalledWith(TURN, FILE);
  await act(() => card().querySelector("button")!.click());
  expect(card().textContent).toContain("Collapse folders");
});

it("keeps archived detail fallback and resumes shell authority after recovery", async () => {
  publishShells([]);
  publishDetail(thread({ archivedAt: DATE }));
  await render();
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/src/index.ts",
  );
  await act(() => publishDetail(null));
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/packages/app/src/index.ts",
  );
  await act(() => publishDetail(thread({ archivedAt: DATE })));
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/src/index.ts",
  );
  await act(() => publishShells([shell({ worktreePath: "/worktrees/recovered" })]));
  await openMenu();
  expect(fixture.openInEditor.mock.lastCall?.[0].input.cwd).toBe(
    "/workspace/local/packages/app/packages/app/src/index.ts",
  );
  const before = fixture.cardRenders;
  const commits = fixture.timelineRender.mock.calls.length;
  await act(() => publishDetail(thread({ archivedAt: DATE, title: "Stale detail title" })));
  expect(fixture.cardRenders).toBe(before);
  expect(fixture.timelineRender).toHaveBeenCalledTimes(commits);
  await act(() => publishShells([]));
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
