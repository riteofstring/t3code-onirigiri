// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
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
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useThread } from "../state/entities";
import { useThreadSurfaceContext } from "./useThreadSurfaceContext";

type StatusRequest = { environmentId: string; input: { cwd: string } };
const fixture = vi.hoisted(() => ({
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
}));

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/unstable/reactivity");
  const {
    createEnvironmentThreadDetailAtoms,
    createEnvironmentThreadShellAtoms,
    EMPTY_ENVIRONMENT_THREAD_STATE,
  } = await import("@t3tools/client-runtime/state/threads");
  const { mergeWithDefaultKeybindings } = await import("@t3tools/shared/keybindings");
  const snapshots = Atom.family((_id: EnvironmentId) =>
    Atom.make<OrchestrationShellSnapshot | null>(null).pipe(Atom.keepAlive),
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
    return registry;
  },
}));
vi.mock("../state/entities", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../state/entities")>()),
  useProject: (ref: ScopedProjectRef | null) =>
    ref ? (fixture.projects.get(`${ref.environmentId}:${ref.projectId}`) ?? null) : null,
  useServerConfigs: () => fixture.configs,
}));
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: (id: string) => fixture.settings.get(id),
}));
vi.mock("../browser/browserDefaults", () => ({
  useBrowserDefaults: () => ({ profiles: fixture.browserProfiles }),
}));
vi.mock("../previewStateStore", () => ({ isPreviewSupportedInRuntime: () => true }));
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
const DATE = "2026-10-14T00:00:00.000Z";
let registry: AtomRegistry.AtomRegistry;
let host: HTMLDivElement;
let root: Root;

function shell(id = ONE, environmentId = LOCAL): OrchestrationThreadShell {
  return {
    id,
    projectId: PROJECT,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: `/worktrees/${environmentId}/${id}`,
    latestTurn: null,
    createdAt: DATE,
    updatedAt: DATE,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
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
    session: {
      threadId: id,
      status: "running",
      providerName: "codex",
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: DATE,
    },
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

function thread(id = ONE, environmentId = LOCAL): OrchestrationThread {
  return {
    ...shell(id, environmentId),
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
  };
}

function activity(
  id: string,
  kind: string,
  payload: Record<string, unknown>,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    kind,
    payload,
    tone: "info",
    summary: kind,
    turnId: null,
    createdAt: DATE,
  };
}

function publishDetail(value: OrchestrationThread, environmentId = LOCAL) {
  registry.set(
    atoms.detail(`${environmentId}:${value.id}`),
    AsyncResult.success({
      data: Option.some(value),
      status: "live",
      error: Option.none(),
      page: Option.none(),
    }),
  );
}

function publishShells(threads: readonly OrchestrationThreadShell[], environmentId = LOCAL) {
  registry.set(atoms.snapshots(environmentId), {
    snapshotSequence: 1,
    updatedAt: DATE,
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
  detail?: false | "workspace" | "agents";
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
        liveCount: result.availability.liveAgentCount,
        agents: result.context.agentModel.directAgents.map(({ id, status, progress }) => ({
          id,
          status,
          progress,
        })),
      })}
    </output>
  );
}

function Messages() {
  const value = useThread({ environmentId: LOCAL, threadId: ONE });
  return <output data-probe="messages">{value?.messages.at(-1)?.text}</output>;
}

const displayed = (name: string) =>
  JSON.parse(host.querySelector(`[data-probe="${name}"]`)!.textContent!);
const render = (children: ReactNode) =>
  act(() => root.render(<RegistryContext value={registry}>{children}</RegistryContext>));
const workspaceProbes = (
  <>
    <Probe name="files" detail="workspace" />
    <Probe name="diff" detail="workspace" />
  </>
);

beforeEach(() => {
  registry = AtomRegistry.make();
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
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

it("keeps Files and Diff untouched by same-thread message updates while chat receives them", async () => {
  const initial = thread();
  publishDetail(initial);
  await render(
    <>
      {workspaceProbes}
      <Messages />
    </>,
  );
  const before = [fixture.renders.get("files"), fixture.renders.get("diff")];
  await act(() =>
    publishDetail({
      ...initial,
      messages: [
        {
          id: MessageId.make("reply"),
          role: "assistant",
          text: "Live reply",
          turnId: null,
          streaming: true,
          createdAt: DATE,
          updatedAt: DATE,
        },
      ],
    }),
  );
  expect(host.querySelector('[data-probe="messages"]')!.textContent).toBe("Live reply");
  expect.soft([fixture.renders.get("files"), fixture.renders.get("diff")]).toEqual(before);
  expect(displayed("files").mutation).toBeNull();
});

it("keeps Files and Diff untouched by agent progress while Agents and default availability stay live", async () => {
  const start = activity("start", "task.started", {
    taskId: "worker",
    agentKind: "agent",
    title: "Worker",
  });
  const initial = { ...thread(), activities: [start] };
  publishDetail(initial);
  await render(
    <>
      {workspaceProbes}
      <Probe name="agents" detail="agents" />
      <Probe name="default" />
    </>,
  );
  expect(displayed("agents").liveCount).toBe(1);
  expect(displayed("default").liveCount).toBe(1);
  const before = [fixture.renders.get("files"), fixture.renders.get("diff")];
  const progress = activity("progress", "task.progress", {
    taskId: "worker",
    summary: "Reviewing files",
  });
  await act(() => publishDetail({ ...initial, activities: [start, progress] }));
  expect(displayed("agents").agents).toMatchObject([
    { progress: "Reviewing files", status: "running" },
  ]);
  expect(displayed("default").agents).toMatchObject([{ progress: "Reviewing files" }]);
  expect.soft([fixture.renders.get("files"), fixture.renders.get("diff")]).toEqual(before);
  await act(() =>
    publishDetail({
      ...initial,
      activities: [
        start,
        progress,
        activity("done", "task.completed", { taskId: "worker", status: "completed" }),
      ],
    }),
  );
  expect(displayed("agents").liveCount).toBe(0);
  expect(displayed("default").liveCount).toBe(0);
  expect.soft([fixture.renders.get("files"), fixture.renders.get("diff")]).toEqual(before);
});

it("refreshes Files and Diff for workspace mutations and completed checkpoints", async () => {
  await render(workspaceProbes);
  const write = activity("write", "tool.completed", { itemType: "file_change" });
  const changed = { ...thread(), activities: [write] };
  await act(() => publishDetail(changed));
  expect(displayed("files").mutation).toBe('["write",null]');
  expect(displayed("diff").mutation).toBe('["write",null]');
  expect(fixture.refresh).toHaveBeenCalledTimes(2);
  const checkpoint = {
    turnId: TurnId.make("turn"),
    checkpointTurnCount: 1,
    checkpointRef: CheckpointRef.make("refs/checkpoints/turn"),
    status: "ready" as const,
    files: [],
    assistantMessageId: null,
    completedAt: DATE,
  };
  await act(() => publishDetail({ ...changed, checkpoints: [checkpoint] }));
  expect(displayed("files").mutation).toBe(`["write","${DATE}"]`);
  expect(displayed("diff").mutation).toBe(`["write","${DATE}"]`);
  expect(fixture.refresh).toHaveBeenCalledTimes(4);
  const completedAt = "2026-10-14T00:00:01.000Z";
  await act(() =>
    publishDetail({
      ...changed,
      activities: [write, activity("command", "tool.completed", { itemType: "command_execution" })],
      checkpoints: [{ ...checkpoint, completedAt }],
    }),
  );
  expect(displayed("files").mutation).toBe(`["command","${completedAt}"]`);
  expect(displayed("diff").mutation).toBe(`["command","${completedAt}"]`);
  expect(fixture.refresh).toHaveBeenCalledTimes(6);
});

it("switches thread and environment without receiving another owner's detail changes", async () => {
  await render(<Probe name="selected" detail="workspace" />);
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
  await render(<Probe name="selected" detail="workspace" threadId={TWO} />);
  expect(displayed("selected").cwd).toBe("/worktrees/local/two");
  await render(<Probe name="selected" detail="workspace" threadId={TWO} environmentId={REMOTE} />);
  expect(displayed("selected").cwd).toBe("/worktrees/remote/two");
  const remote = fixture.results.get("selected")!;
  expect(remote.context.composerDraftTarget).toEqual({ environmentId: REMOTE, threadId: TWO });
  expect(remote.context.files.workspaceRoot).toBe("/worktrees/remote/two");
  expect(remote.availability).toMatchObject({
    terminalAvailable: true,
    filesAvailable: true,
    diffAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
  });
  expect(remote.linkedPullRequest?.repository).toBe("remote/repo");
  expect(fixture.statusRequests.at(-1)).toEqual({
    environmentId: REMOTE,
    input: { cwd: "/worktrees/remote/two" },
  });
  const before = fixture.renders.get("selected");
  await act(() =>
    publishDetail({
      ...thread(TWO),
      activities: [activity("local-write", "tool.completed", { itemType: "file_change" })],
    }),
  );
  expect(fixture.renders.get("selected")).toBe(before);
  await act(() =>
    publishDetail(
      {
        ...thread(TWO, REMOTE),
        activities: [activity("remote-write", "tool.completed", { itemType: "command_execution" })],
      },
      REMOTE,
    ),
  );
  expect(displayed("selected").mutation).toBe('["remote-write",null]');
  expect(fixture.results.get("selected")!.context.preview.configuredUrls).toEqual([
    "https://remote.test",
  ]);
  expect(fixture.results.get("selected")!.availability.pullRequestAvailable).toBe(false);
});

it("retains useful detail while reconnecting, clears lost detail, and recovers", async () => {
  const changed = {
    ...thread(),
    activities: [activity("write", "tool.completed", { itemType: "file_change" })],
  };
  publishDetail(changed);
  await render(workspaceProbes);
  const atom = atoms.detail(`${LOCAL}:${ONE}`);
  const ready = registry.get(atom);
  const before = fixture.renders.get("files");
  await act(() => registry.set(atom, AsyncResult.waiting(ready)));
  await act(() =>
    registry.set(
      atom,
      AsyncResult.failWithPrevious(new Error("offline"), { previous: Option.some(ready) }),
    ),
  );
  expect(displayed("files").mutation).toBe('["write",null]');
  expect(fixture.renders.get("files")).toBe(before);
  await act(() => registry.set(atom, AsyncResult.fail(new Error("offline"))));
  expect(displayed("files").mutation).toBeNull();
  expect(displayed("files").cwd).toBe("/worktrees/local/one");
  await act(() => publishDetail(changed));
  expect(displayed("files").mutation).toBe('["write",null]');
});

it("uses detail metadata without a shell and adopts the shell's authoritative workspace and session", async () => {
  publishShells([]);
  const start = activity("start", "task.started", { taskId: "worker", agentKind: "agent" });
  publishDetail({ ...thread(), activities: [start] });
  await render(<Probe name="agents" detail="agents" />);
  expect(displayed("agents")).toMatchObject({ cwd: "/worktrees/local/one", liveCount: 1 });
  await act(() => publishShells([{ ...shell(), worktreePath: "/new-checkout", session: null }]));
  expect(displayed("agents").cwd).toBe("/new-checkout");
  expect(displayed("agents").liveCount).toBe(0);
});

it("builds the chooser from shell metadata without subscribing to thread detail", async () => {
  fixture.configs.delete(REMOTE);
  await render(<Probe name="chooser" detail={false} environmentId={REMOTE} />);
  expect(fixture.detailReads).toEqual([]);
  expect(displayed("chooser")).toMatchObject({ mutation: null, liveCount: 0 });
  expect(fixture.results.get("chooser")!.availability).toMatchObject({
    terminalAvailable: true,
    filesAvailable: true,
    agentsAvailable: true,
    deviceAvailable: true,
    pullRequestAvailable: false,
  });
  expect(fixture.results.get("chooser")!.context.pullRequests).toMatchObject({
    capabilityKnown: false,
    supported: false,
  });
  expect(fixture.results.get("chooser")!.context.terminal.launchContext).toBeNull();
  expect(fixture.results.get("chooser")!.context.terminal.splitShortcutLabel).toBeDefined();
  const before = fixture.renders.get("chooser");
  await act(() =>
    publishDetail(
      {
        ...thread(ONE, REMOTE),
        activities: [activity("write", "tool.completed", { itemType: "file_change" })],
      },
      REMOTE,
    ),
  );
  expect(fixture.renders.get("chooser")).toBe(before);
});
