import { RegistryContext } from "@effect/atom-react";
import {
  EMPTY_THREAD_HISTORY_META,
  type EnvironmentThreadState,
} from "@t3tools/client-runtime/state/threads";
import {
  CheckpointId,
  CheckpointRef,
  CheckpointScopeId,
  EnvironmentId,
  NodeId,
  ProjectId,
  ThreadId,
  RunId,
  TurnItemId,
  type OrchestrationV2ShellSnapshot,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadShell,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render as renderScreen } from "../../test/render";

import { useThreadSurfaceContext } from "./useThreadSurfaceContext";

import {
  v2Projection,
  v2ThreadShell,
  v2Now,
} from "../../../../packages/client-runtime/src/state/orchestrationV2TestFixtures";

type StatusRequest = { environmentId: string; input: { cwd: string } };
const fixture = vi.hoisted(() => ({
  deniedScopes: new Set<string>(),
  desktopBrowser: true,
  serverBrowsers: new Set<string>(),
  fileRead: true,
  renders: new Map<string, number>(),
  results: new Map<string, ReturnType<typeof useThreadSurfaceContext>>(),
  projects: new Map<string, object>(),
  configs: new Map<string, object>(),
  settings: new Map<string, object>(),
  detailReads: [] as string[],
  statusRequests: [] as StatusRequest[],
  isRepo: new Map<string, boolean>(),
  refresh: vi.fn(),
  browserProfiles: [{ id: "work", name: "Work" }],
  registry: undefined as unknown as AtomRegistry.AtomRegistry,
}));

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const {
    createEnvironmentThreadDetailAtoms,
    createEnvironmentThreadShellAtoms,
    EMPTY_ENVIRONMENT_THREAD_STATE,
  } = await import("@t3tools/client-runtime/state/threads");
  const { mergeWithDefaultKeybindings } = await import("@t3tools/shared/keybindings");
  const snapshots = Atom.family((_id: EnvironmentId) =>
    Atom.make<OrchestrationV2ShellSnapshot | null>(null).pipe(Atom.keepAlive),
  );
  const detail = Atom.family((_key: string) =>
    Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState, Error>>(
      AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE),
    ).pipe(Atom.keepAlive),
  );
  const detailSource = Atom.family((key: string) =>
    Atom.make((get) => {
      fixture.detailReads.push(key);
      return get(detail(key));
    }),
  );
  return {
    snapshots,
    detail,
    shells: createEnvironmentThreadShellAtoms({
      catalogValueAtom: Atom.make({ isReady: true, entries: new Map() }),
      snapshotAtom: snapshots,
      hiddenThreadTagsAtom: () => Atom.make<ReadonlyArray<string> | null>(null),
    }),
    details: createEnvironmentThreadDetailAtoms((environmentId, threadId) =>
      detailSource(`${environmentId}:${threadId}`),
    ),
    keybindings: Atom.make(mergeWithDefaultKeybindings([])),
    editors: Atom.make(["vscode"]),
    unusedBoolean: Atom.make(false),
    unusedConfigs: Atom.make(new Map()),
  };
});

vi.mock("../state/threads", () => ({
  environmentThreadShells: atoms.shells,
  environmentThreadDetails: atoms.details,
}));
vi.mock("../state/shell", () => ({
  environmentSnapshotAtom: atoms.snapshots,
  allEnvironmentShellsBootstrappedAtom: atoms.unusedBoolean,
  allEnvironmentProjectSnapshotsReadyAtom: atoms.unusedBoolean,
}));
vi.mock("../state/projects", () => ({ environmentProjects: {} }));
vi.mock("../state/server", () => ({
  environmentServerConfigsAtom: atoms.unusedConfigs,
  primaryServerKeybindingsAtom: atoms.keybindings,
  primaryServerAvailableEditorsAtom: atoms.editors,
}));
vi.mock("../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return fixture.registry;
  },
}));
vi.mock("../state/entities", async () => {
  const { useAtomValue } = await import("@effect/atom-react");
  return {
    useThreadShell: (ref: ScopedThreadRef) => useAtomValue(atoms.shells.threadShellAtom(ref)),
    useProject: (ref: ScopedProjectRef | null) =>
      ref ? (fixture.projects.get(`${ref.environmentId}:${ref.projectId}`) ?? null) : null,
    useServerConfigs: () => fixture.configs,
    useEnvironmentSupportsServerBrowser: (id: string) => fixture.serverBrowsers.has(id),
  };
});
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: (id: string) => fixture.settings.get(id),
}));
vi.mock("../browser/browserDefaults", () => ({
  useBrowserDefaults: () => ({ profiles: fixture.browserProfiles }),
}));
vi.mock("../previewStateStore", () => ({
  isPreviewSupportedInRuntime: () => fixture.desktopBrowser,
}));
vi.mock("../state/session", () => ({
  useEnvironmentScope: (id: string, scope: string) => !fixture.deniedScopes.has(`${id}:${scope}`),
}));
vi.mock("../state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: fixture.fileRead }),
}));
vi.mock("../state/vcs", () => ({
  vcsEnvironment: { status: (request: StatusRequest) => request },
}));
vi.mock("./chatViewVcsStatus", () => ({
  useChatViewVcsStatus: (request: StatusRequest | null) => {
    if (request) fixture.statusRequests.push(request);
    const isRepo = request
      ? fixture.isRepo.get(`${request.environmentId}:${request.input.cwd}`)
      : undefined;
    return { data: isRepo === undefined ? null : { isRepo }, refresh: fixture.refresh };
  },
}));

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const ONE = ThreadId.make("one");
const TWO = ThreadId.make("two");
const PROJECT = ProjectId.make("project");
const DATE = DateTime.formatIso(v2Now);

function shell(id = ONE, environmentId = LOCAL): OrchestrationV2ThreadShell {
  return {
    ...v2ThreadShell,
    id,
    projectId: PROJECT,
    worktreePath: `/worktrees/${environmentId}/${id}`,
    linkedPullRequest: {
      projectId: PROJECT,
      repository: `${environmentId}/repo`,
      number: 1,
      url: `https://github.com/${environmentId}/repo/pull/1`,
    },
    pullRequests: [
      {
        host: "github.com",
        repository: `${environmentId}/repo`,
        number: 1,
        url: `https://github.com/${environmentId}/repo/pull/1`,
        source: "manual",
        linkedAt: DATE,
        snapshot: null,
        stack: null,
      },
    ],
  };
}

function thread(id = ONE, environmentId = LOCAL): OrchestrationV2ThreadProjection {
  const metadata = shell(id, environmentId);
  return {
    ...v2Projection,
    thread: {
      ...v2Projection.thread,
      id,
      projectId: PROJECT,
      worktreePath: metadata.worktreePath,
      linkedPullRequest: metadata.linkedPullRequest,
      pullRequests: metadata.pullRequests,
    },
  };
}

function checkpoint(): OrchestrationV2ThreadProjection["checkpoints"][number] {
  return {
    id: CheckpointId.make("checkpoint"),
    scopeId: CheckpointScopeId.make("scope"),
    nodeId: NodeId.make("node"),
    threadId: ONE,
    runId: RunId.make("run"),
    parentCheckpointId: null,
    ordinalWithinScope: 1,
    appRunOrdinal: 1,
    ref: CheckpointRef.make("refs/checkpoints/run"),
    status: "ready",
    files: [],
    capturedAt: v2Now,
  };
}

function command(
  id: string,
  status: "running" | "completed" = "completed",
): OrchestrationV2ProjectedTurnItem {
  const itemId = TurnItemId.make(id);
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: ONE,
    sourceItemId: itemId,
    item: {
      id: itemId,
      threadId: ONE,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status,
      title: null,
      startedAt: v2Now,
      completedAt: status === "completed" ? v2Now : null,
      updatedAt: v2Now,
      type: "command_execution",
      input: "pwd",
      output: "",
      exitCode: undefined,
    },
  };
}

function publishDetail(value: OrchestrationV2ThreadProjection, environmentId = LOCAL) {
  fixture.registry.set(
    atoms.detail(`${environmentId}:${value.thread.id}`),
    AsyncResult.success({
      data: Option.some(value),
      status: "live",
      error: Option.none(),
      history: EMPTY_THREAD_HISTORY_META,
      sequence: 0,
    }),
  );
}

function publishShells(threads: readonly OrchestrationV2ThreadShell[], environmentId = LOCAL) {
  fixture.registry.set(atoms.snapshots(environmentId), {
    snapshotSequence: 1,
    schemaVersion: 1,
    archivedThreads: [],
    projects: [],
    threads,
  });
}

function Probe({
  name,
  environmentId = LOCAL,
  threadId = ONE,
  detail,
}: {
  name: string;
  environmentId?: EnvironmentId;
  threadId?: ThreadId;
  detail?: false | "workspace";
}) {
  const ref: ScopedThreadRef = { environmentId, threadId };
  const result = useThreadSurfaceContext(ref, detail === undefined ? undefined : { detail });
  fixture.renders.set(name, (fixture.renders.get(name) ?? 0) + 1);
  fixture.results.set(name, result);
  return (
    <output data-probe={name}>
      {JSON.stringify({
        cwd: result.cwd,
        mutation: result.context.workspaceMutationId,
      })}
    </output>
  );
}

const displayed = (name: string) =>
  JSON.parse(document.querySelector(`[data-probe="${name}"]`)!.textContent!);
const tree = (children: ReactNode) => (
  <RegistryContext value={fixture.registry}>{children}</RegistryContext>
);
const workspaceProbes = (
  <>
    <Probe name="files" detail="workspace" />
    <Probe name="diff" detail="workspace" />
  </>
);

function setup() {
  fixture.registry = AtomRegistry.make();
  fixture.deniedScopes.clear();
  fixture.desktopBrowser = true;
  fixture.serverBrowsers.clear();
  fixture.fileRead = true;
  fixture.renders.clear();
  fixture.results.clear();
  fixture.refresh.mockReset();
  fixture.projects.clear();
  fixture.settings.clear();
  fixture.configs.clear();
  fixture.isRepo.clear();
  fixture.detailReads.length = 0;
  fixture.statusRequests.length = 0;
  for (const environmentId of [LOCAL, REMOTE]) {
    fixture.projects.set(`${environmentId}:${PROJECT}`, {
      id: PROJECT,
      environmentId,
      title: environmentId,
      workspaceRoot: `/projects/${environmentId}`,
      scripts: [],
    });
    fixture.settings.set(environmentId, {
      projectSettingsOverrides: {},
      projectScriptOverrides: {},
      projectSettingsFolded: true,
      defaultProjectScripts: [{ previewUrl: `https://${environmentId}.test` }],
    });
    fixture.configs.set(environmentId, {
      environment: {
        capabilities: {
          pullRequests: environmentId === LOCAL,
          threadPullRequests: environmentId === LOCAL,
        },
      },
    });
    publishShells([shell(ONE, environmentId), shell(TWO, environmentId)], environmentId);
    publishDetail(thread(ONE, environmentId), environmentId);
    publishDetail(thread(TWO, environmentId), environmentId);
    for (const threadId of [ONE, TWO]) {
      fixture.isRepo.set(
        `${environmentId}:/worktrees/${environmentId}/${threadId}`,
        environmentId === LOCAL,
      );
    }
  }
  return {
    // Hook probes only; nothing here navigates.
    render: (children: ReactNode) => renderScreen(tree(children), { router: false }),
    [Symbol.dispose]: () => fixture.registry.dispose(),
  };
}

it("ignores running tool output and refreshes for completed workspace mutations and checkpoints", async () => {
  using surfaces = setup();
  const initial = thread();
  await using _screen = await surfaces.render(workspaceProbes);
  const before = fixture.renders.get("files");
  await act(() => publishDetail({ ...initial, visibleTurnItems: [command("write", "running")] }));
  expect(fixture.renders.get("files")).toBe(before);
  const changed = { ...initial, visibleTurnItems: [command("write")] };
  await act(() => publishDetail(changed));
  expect(displayed("files").mutation).toBe('["write",null]');
  expect(displayed("diff").mutation).toBe('["write",null]');
  expect(fixture.refresh).toHaveBeenCalledTimes(2);
  const captured = checkpoint();
  await act(() => publishDetail({ ...changed, checkpoints: [captured] }));
  expect(displayed("files").mutation).toBe(`["write","${DATE}"]`);
  expect(displayed("diff").mutation).toBe(`["write","${DATE}"]`);
  expect(fixture.refresh).toHaveBeenCalledTimes(4);
  await act(() => publishDetail({ ...changed, checkpoints: [{ ...captured, status: "error" }] }));
  expect(fixture.refresh).toHaveBeenCalledTimes(4);
  const recapturedAt = DateTime.add(v2Now, { seconds: 10 });
  await act(() =>
    publishDetail({ ...changed, checkpoints: [{ ...captured, capturedAt: recapturedAt }] }),
  );
  expect(displayed("files").mutation).toBe(`["write","${DateTime.formatIso(recapturedAt)}"]`);
  expect(fixture.refresh).toHaveBeenCalledTimes(6);
});

it("switches thread and environment without receiving another owner's detail changes", async () => {
  using surfaces = setup();
  await using screen = await surfaces.render(<Probe name="selected" detail="workspace" />);
  expect(displayed("selected").cwd).toBe("/worktrees/local/one");
  const local = fixture.results.get("selected")!;
  expect(local.context.composerDraftTarget).toEqual({ environmentId: LOCAL, threadId: ONE });
  expect(local.context.preview.configuredUrls).toEqual(["https://local.test"]);
  expect(local.context.files.workspaceRoot).toBe("/worktrees/local/one");
  expect(local.runtimeEnv).toEqual({
    T3CODE_PROJECT_ROOT: "/projects/local",
    T3CODE_WORKTREE_PATH: "/worktrees/local/one",
  });
  expect(local.availability).toMatchObject({
    diffAvailable: true,
    pullRequestAvailable: true,
    pullRequestsAvailable: true,
  });
  expect(local.linkedPullRequest?.repository).toBe("local/repo");
  expect(local.browserProfiles).toEqual(fixture.browserProfiles);
  await screen.rerender(tree(<Probe name="selected" detail="workspace" threadId={TWO} />));
  expect(displayed("selected").cwd).toBe("/worktrees/local/two");
  await screen.rerender(
    tree(<Probe name="selected" detail="workspace" threadId={TWO} environmentId={REMOTE} />),
  );
  expect(displayed("selected").cwd).toBe("/worktrees/remote/two");
  const remote = fixture.results.get("selected")!;
  expect(remote.context.composerDraftTarget).toEqual({ environmentId: REMOTE, threadId: TWO });
  expect(remote.availability).toMatchObject({
    terminalAvailable: true,
    filesAvailable: true,
    diffAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
  });
  expect(fixture.statusRequests.at(-1)).toEqual({
    environmentId: REMOTE,
    input: { cwd: "/worktrees/remote/two" },
  });
  const before = fixture.renders.get("selected");
  await act(() => publishDetail({ ...thread(TWO), visibleTurnItems: [command("local-write")] }));
  expect(fixture.renders.get("selected")).toBe(before);
  await act(() =>
    publishDetail({ ...thread(TWO, REMOTE), visibleTurnItems: [command("remote-write")] }, REMOTE),
  );
  expect(displayed("selected").mutation).toBe('["remote-write",null]');
  expect(fixture.results.get("selected")!.context.preview.configuredUrls).toEqual([
    "https://remote.test",
  ]);
});

it("offers remote Browser support and respects current environment permissions", async () => {
  using surfaces = setup();
  fixture.desktopBrowser = false;
  fixture.serverBrowsers.add(REMOTE);
  await using screen = await surfaces.render(
    <Probe name="chooser" detail={false} environmentId={REMOTE} />,
  );
  expect(fixture.results.get("chooser")!.availability.browserAvailable).toBe(true);
  fixture.deniedScopes.add(`${REMOTE}:preview:operate`);
  fixture.deniedScopes.add(`${REMOTE}:terminal:operate`);
  fixture.fileRead = false;
  await screen.rerender(tree(<Probe name="chooser" detail={false} environmentId={REMOTE} />));
  expect(fixture.results.get("chooser")!.availability).toMatchObject({
    browserAvailable: false,
    terminalAvailable: false,
    filesAvailable: false,
    diffAvailable: false,
  });
});
