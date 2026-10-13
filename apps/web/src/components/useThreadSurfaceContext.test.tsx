import type {
  EnvironmentId,
  ScopedProjectRef,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import { mergeWithDefaultKeybindings } from "@t3tools/shared/keybindings";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useThreadSurfaceContext } from "./useThreadSurfaceContext";

type StatusRequest = { environmentId: string; input: { cwd: string } };
const fixture = vi.hoisted(() => ({
  details: new Map<string, unknown>(),
  shells: new Map<string, unknown>(),
  projects: new Map<string, unknown>(),
  configs: new Map<string, unknown>(),
  settings: new Map<string, unknown>(),
  detailReads: [] as (ScopedThreadRef | null)[],
  statusRequests: [] as StatusRequest[],
  isRepo: new Map<string, boolean>(),
  keybindings: [] as ReturnType<typeof mergeWithDefaultKeybindings>,
  refresh: vi.fn(),
  browserProfiles: [{ id: "work", name: "Work" }],
}));
vi.mock("../state/entities", () => ({
  useThread: (ref: ScopedThreadRef | null) => {
    fixture.detailReads.push(ref);
    return ref ? (fixture.details.get(`${ref.environmentId}:${ref.threadId}`) ?? null) : null;
  },
  useThreadShell: (ref: ScopedThreadRef) =>
    fixture.shells.get(`${ref.environmentId}:${ref.threadId}`) ?? null,
  useProject: (ref: ScopedProjectRef | null) =>
    ref ? (fixture.projects.get(`${ref.environmentId}:${ref.projectId}`) ?? null) : null,
  useServerConfigs: () => fixture.configs,
}));
vi.mock("../state/server", () => ({
  primaryServerAvailableEditorsAtom: "editors",
  primaryServerKeybindingsAtom: "keybindings",
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: string) => (atom === "keybindings" ? fixture.keybindings : ["vscode"]),
}));
vi.mock("../hooks/useSettings", () => ({
  useEnvironmentSettings: (environmentId: string) => fixture.settings.get(environmentId),
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

let result: ReturnType<typeof useThreadSurfaceContext>;
let renderer: ReactTestRenderer | undefined;

function owner(environmentId: string): ScopedThreadRef {
  return {
    environmentId: environmentId as EnvironmentId,
    threadId: "shared-thread-id" as ThreadId,
  };
}

function Probe({ threadRef, detail }: { threadRef: ScopedThreadRef; detail: boolean }) {
  const context = useThreadSurfaceContext(threadRef, { detail });
  useEffect(() => {
    result = context;
  });
  return null;
}

async function render(environmentId: string, detail = true) {
  await act(() => {
    const element = <Probe threadRef={owner(environmentId)} detail={detail} />;
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  for (const map of [
    fixture.details,
    fixture.shells,
    fixture.projects,
    fixture.configs,
    fixture.settings,
    fixture.isRepo,
  ])
    map.clear();
  fixture.detailReads.length = 0;
  fixture.statusRequests.length = 0;
  fixture.refresh.mockReset();
  fixture.keybindings = mergeWithDefaultKeybindings([]);
  for (const environmentId of ["one", "two"]) {
    const linkedPullRequest = {
      projectId: "project",
      repository: `${environmentId}/repo`,
      number: environmentId === "one" ? 1 : 2,
      url: `https://github.com/${environmentId}/repo/pull/1`,
    };
    const thread = {
      environmentId,
      id: "shared-thread-id",
      projectId: "project",
      worktreePath: `/worktrees/${environmentId}`,
      linkedPullRequest,
      pullRequests: [
        { host: "github.com", repository: `${environmentId}/repo`, number: 1, source: "manual" },
      ],
    };
    fixture.shells.set(`${environmentId}:shared-thread-id`, thread);
    fixture.details.set(`${environmentId}:shared-thread-id`, {
      ...thread,
      activities: [
        {
          id: `${environmentId}-write`,
          kind: "tool.completed",
          payload: { itemType: "file_change" },
        },
      ],
      checkpoints: [{ completedAt: "2026-10-13T10:00:00Z" }],
      session: null,
    });
    fixture.projects.set(`${environmentId}:project`, {
      environmentId,
      id: "project",
      title: environmentId,
      workspaceRoot: `/projects/${environmentId}`,
      scripts: [],
    });
    fixture.settings.set(environmentId, {
      projectSettingsOverrides: {},
      projectScriptOverrides: {},
      projectSettingsFolded: true,
      defaultProjectScripts: [{ previewUrl: `https://${environmentId}.example.test` }],
    });
    fixture.configs.set(environmentId, {
      environment: {
        capabilities: {
          pullRequests: environmentId === "one",
          threadPullRequests: environmentId === "one",
        },
      },
    });
    fixture.isRepo.set(`${environmentId}:/worktrees/${environmentId}`, environmentId === "one");
  }
});

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps project, working directory, preview settings and capabilities scoped to each owner", async () => {
  await render("one");
  expect(result.context.composerDraftTarget).toEqual(owner("one"));
  expect(result.context.preview.configuredUrls).toEqual(["https://one.example.test"]);
  expect(result.context.files.workspaceRoot).toBe("/worktrees/one");
  expect(result.runtimeEnv).toEqual({
    T3CODE_PROJECT_ROOT: "/projects/one",
    T3CODE_WORKTREE_PATH: "/worktrees/one",
  });
  expect(result.context.workspaceMutationId).toBe('["one-write","2026-10-13T10:00:00Z"]');
  expect(result.availability).toMatchObject({
    diffAvailable: true,
    pullRequestAvailable: true,
    pullRequestsAvailable: true,
  });
  expect(result.linkedPullRequest?.repository).toBe("one/repo");
  expect(result.browserProfiles).toEqual(fixture.browserProfiles);

  await render("two");
  expect(result.context.composerDraftTarget).toEqual(owner("two"));
  expect(result.context.preview.configuredUrls).toEqual(["https://two.example.test"]);
  expect(result.context.files.workspaceRoot).toBe("/worktrees/two");
  expect(result.cwd).toBe("/worktrees/two");
  expect(result.availability).toMatchObject({
    terminalAvailable: true,
    filesAvailable: true,
    diffAvailable: false,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
  });
  expect(result.linkedPullRequest?.repository).toBe("two/repo");
  expect(fixture.statusRequests.at(-1)).toEqual({
    environmentId: "two",
    input: { cwd: "/worktrees/two" },
  });
});

it("builds the empty chooser from the owner shell without loading thread detail or borrowing another server's capability", async () => {
  fixture.configs.delete("two");
  await render("two", false);
  expect(fixture.detailReads.every((ref) => ref === null)).toBe(true);
  expect(result.context.workspaceMutationId).toBeNull();
  expect(result.context.agentModel.liveCount).toBe(0);
  expect(result.context.pullRequests).toMatchObject({ capabilityKnown: false, supported: false });
  expect(result.availability).toMatchObject({
    terminalAvailable: true,
    filesAvailable: true,
    agentsAvailable: true,
    deviceAvailable: true,
    pullRequestAvailable: false,
  });
  expect(result.context.terminal.launchContext).toBeNull();
  expect(result.context.terminal.splitShortcutLabel).toBeDefined();
});
