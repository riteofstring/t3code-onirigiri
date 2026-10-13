// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import type { EnvironmentShellState } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentThreadState } from "@t3tools/client-runtime/state/threads";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { DraftSessionState } from "../composerDraftStore";
import type { ThreadRouteTarget } from "../threadRoutes";
import { useEnvironmentShellBootstrapped } from "../state/entities";
import { ThreadRouteView } from "./ThreadRouteView";

const fixture = vi.hoisted(() => ({
  navigate: vi.fn(),
  clearPendingDrops: vi.fn(),
  renders: new Map<string, number>(),
  draft: null as Pick<DraftSessionState, "environmentId" | "threadId" | "promotedTo"> | null,
}));

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult, AtomRegistry } = await import("effect/unstable/reactivity");
  const Option = await import("effect/Option");
  const { PrimaryConnectionTarget } = await import("@t3tools/client-runtime/connection");
  const { createEnvironmentSnapshotAtom } = await import("@t3tools/client-runtime/state/shell");
  const { createEnvironmentProjectAtoms } = await import("@t3tools/client-runtime/state/projects");
  const {
    createEnvironmentThreadShellAtoms,
    createEnvironmentThreadDetailAtoms,
    EMPTY_ENVIRONMENT_THREAD_STATE,
  } = await import("@t3tools/client-runtime/state/threads");
  const shell = Atom.family((_id: EnvironmentId) =>
    Atom.make<AsyncResult.AsyncResult<EnvironmentShellState, Error>>(AsyncResult.initial()),
  );
  const detail = Atom.family((_key: string) =>
    Atom.make<AsyncResult.AsyncResult<EnvironmentThreadState, Error>>(
      AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE),
    ),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map(
      ["local", "remote"].map((id) => {
        const environmentId = id as EnvironmentId;
        return [
          environmentId,
          {
            enabled: true,
            profile: Option.none(),
            target: new PrimaryConnectionTarget({
              environmentId,
              label: id,
              httpBaseUrl: `http://${id}.test`,
              wsBaseUrl: `ws://${id}.test`,
            }),
          },
        ] as const;
      }),
    ),
  });
  const snapshot = createEnvironmentSnapshotAtom(shell);
  return {
    shell,
    detail,
    snapshot,
    registry: AtomRegistry.make(),
    projects: createEnvironmentProjectAtoms({ catalogValueAtom, snapshotAtom: snapshot }),
    shells: createEnvironmentThreadShellAtoms({ catalogValueAtom, snapshotAtom: snapshot }),
    details: createEnvironmentThreadDetailAtoms((environmentId, threadId) =>
      detail(`${environmentId}:${threadId}`),
    ),
    unusedBoolean: Atom.make(false),
    unusedConfigs: Atom.make(new Map()),
  };
});

vi.mock("../state/shell", () => ({
  environmentShell: { stateAtom: atoms.shell },
  environmentSnapshotAtom: atoms.snapshot,
  allEnvironmentShellsBootstrappedAtom: atoms.unusedBoolean,
  allEnvironmentProjectSnapshotsReadyAtom: atoms.unusedBoolean,
}));
vi.mock("../state/threads", () => ({
  environmentThreadShells: atoms.shells,
  environmentThreadDetails: atoms.details,
}));
vi.mock("../state/projects", () => ({ environmentProjects: atoms.projects }));
vi.mock("../state/server", () => ({ environmentServerConfigsAtom: atoms.unusedConfigs }));
vi.mock("../rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return atoms.registry;
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => fixture.navigate }));
vi.mock("../composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: object) => unknown) =>
    select({
      getDraftSession: () => fixture.draft,
      getDraftThreadByRef: () => null,
      getDraftIdByRef: () => null,
      hasDraftThreadsInEnvironment: () => false,
    }),
  useBackgroundDraftSubmissionPending: () => false,
  finalizePromotedDraftThreadByRef: vi.fn(),
  markPromotedDraftThreadByRef: vi.fn(),
}));
vi.mock("../sidebarPendingFileDropStore", () => ({
  useSidebarPendingFileDropStore: {
    getState: () => ({ clearPendingFileDropsForThread: fixture.clearPendingDrops }),
  },
}));
vi.mock("./chat/draftHeroTransition", () => ({ waitForDraftHeroTransition: async () => {} }));
vi.mock("./ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./ChatView", async () => {
  const { useState } = await import("react");
  const { useThread } = await import("../state/entities");
  return {
    default: (props: { environmentId: EnvironmentId; threadId: ThreadId; routeKind: string }) => {
      const thread = useThread(props.routeKind === "server" ? props : null);
      const [edits, setEdits] = useState(0);
      const key = `${props.environmentId}:${props.threadId}`;
      fixture.renders.set(key, (fixture.renders.get(key) ?? 0) + 1);
      return (
        <button data-chat={key} onClick={() => setEdits((count) => count + 1)}>
          {JSON.stringify({ title: thread?.title, messages: thread?.messages.length, edits })}
        </button>
      );
    },
  };
});

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const ONE = ThreadId.make("one");
const TWO = ThreadId.make("two");
const DATE = "2026-10-13T00:00:00.000Z";
const thread = (id: ThreadId): OrchestrationThreadShell => ({
  id,
  projectId: ProjectId.make("project"),
  title: id,
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
  pullRequests: [],
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
});
const snapshot = (threads: readonly OrchestrationThreadShell[]): OrchestrationShellSnapshot => ({
  snapshotSequence: 1,
  updatedAt: DATE,
  projects: [],
  threads,
});
const shellState = (
  value: OrchestrationShellSnapshot,
  status: EnvironmentShellState["status"] = "live",
): EnvironmentShellState => ({ snapshot: Option.some(value), status, error: Option.none() });
const detail = (shell: OrchestrationThreadShell): OrchestrationThread => ({
  ...shell,
  deletedAt: null,
  messages: [],
  activities: [],
  proposedPlans: [],
  checkpoints: [],
});
const target = (threadId = ONE, environmentId = LOCAL): ThreadRouteTarget => ({
  kind: "server",
  threadRef: { environmentId, threadId },
});
let host: HTMLDivElement;
let root: Root;

function setDetail(value: OrchestrationThread, environmentId = LOCAL) {
  atoms.registry.set(
    atoms.detail(`${environmentId}:${value.id}`),
    AsyncResult.success({
      data: Option.some(value),
      status: "live",
      error: Option.none(),
      page: Option.none(),
    }),
  );
}
async function render(first: ThreadRouteTarget, second?: ThreadRouteTarget) {
  await act(() =>
    root.render(
      <RegistryContext value={atoms.registry}>
        <ThreadRouteView target={first} />
        {second ? <ThreadRouteView target={second} /> : null}
      </RegistryContext>,
    ),
  );
}
function chat(id = ONE, environmentId = LOCAL) {
  return host.querySelector<HTMLButtonElement>(`[data-chat="${environmentId}:${id}"]`);
}
function displayed(id = ONE, environmentId = LOCAL) {
  return JSON.parse(chat(id, environmentId)!.textContent!);
}

function BootstrapProbe({ environmentId }: { environmentId: EnvironmentId | null }) {
  return <output>{String(useEnvironmentShellBootstrapped(environmentId))}</output>;
}

beforeEach(() => {
  atoms.registry = AtomRegistry.make();
  fixture.renders.clear();
  fixture.navigate.mockReset();
  fixture.clearPendingDrops.mockReset();
  fixture.draft = null;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  atoms.registry.dispose();
  host.remove();
  vi.unstubAllGlobals();
});

it("keeps unrelated routed chats untouched while their own shell and detail updates remain live", async () => {
  const one = thread(ONE);
  const two = thread(TWO);
  atoms.registry.set(atoms.shell(LOCAL), AsyncResult.success(shellState(snapshot([one, two]))));
  setDetail(detail(one));
  setDetail(detail(two));
  await render(target(ONE), target(TWO));
  const retained = chat(TWO)!;
  await act(() => retained.click());
  const otherRenders = fixture.renders.get("local:two");

  await act(() =>
    atoms.registry.set(
      atoms.shell(LOCAL),
      AsyncResult.success(shellState(snapshot([{ ...one, title: "Renamed one" }, two]))),
    ),
  );
  expect(displayed(ONE).title).toBe("Renamed one");
  expect.soft(fixture.renders.get("local:two")).toBe(otherRenders);
  const afterShell = fixture.renders.get("local:two");

  await act(() =>
    setDetail({
      ...detail(one),
      messages: [
        {
          id: MessageId.make("message"),
          role: "assistant",
          text: "Live reply",
          turnId: null,
          streaming: false,
          createdAt: DATE,
          updatedAt: DATE,
        },
      ],
    }),
  );
  expect(displayed(ONE)).toMatchObject({ title: "Renamed one", messages: 1 });
  expect(fixture.renders.get("local:two")).toBe(afterShell);
  expect(chat(TWO)).toBe(retained);
  expect(displayed(TWO)).toMatchObject({ title: "two", edits: 1 });
});

it("waits for bootstrap before routing a missing thread and renders it when it arrives", async () => {
  await render(target());
  expect(chat()).toBeNull();
  expect(fixture.navigate).not.toHaveBeenCalled();
  await act(() => atoms.registry.set(atoms.shell(LOCAL), AsyncResult.fail(new Error("offline"))));
  expect(fixture.navigate).not.toHaveBeenCalled();
  expect(fixture.clearPendingDrops).not.toHaveBeenCalled();

  await act(() =>
    atoms.registry.set(
      atoms.shell(LOCAL),
      AsyncResult.success(shellState(snapshot([thread(TWO)]))),
    ),
  );
  expect(fixture.navigate).toHaveBeenCalledExactlyOnceWith({ to: "/", replace: true });
  expect(fixture.clearPendingDrops).toHaveBeenCalledExactlyOnceWith({
    environmentId: LOCAL,
    threadId: ONE,
  });
  await act(() => {
    atoms.registry.set(
      atoms.shell(LOCAL),
      AsyncResult.success(shellState(snapshot([thread(ONE), thread(TWO)]))),
    );
    setDetail(detail(thread(ONE)));
  });
  expect(displayed().title).toBe("one");
});

it("retains a live chat across cached, reconnecting and failed shell states with a previous snapshot", async () => {
  const value = snapshot([thread(ONE)]);
  const ready = AsyncResult.success(shellState(value));
  atoms.registry.set(atoms.shell(LOCAL), ready);
  setDetail(detail(thread(ONE)));
  await render(target());
  const retained = chat()!;
  await act(() => retained.click());
  for (const state of [
    AsyncResult.success(shellState(value, "cached")),
    AsyncResult.success(shellState(value, "synchronizing")),
    AsyncResult.waiting(ready),
    AsyncResult.fail(new Error("offline"), { previousSuccess: Option.some(ready) }),
    ready,
  ]) {
    await act(() => atoms.registry.set(atoms.shell(LOCAL), state));
    expect(chat()).toBe(retained);
    expect(displayed()).toMatchObject({ title: "one", edits: 1 });
    expect(fixture.navigate).not.toHaveBeenCalled();
  }
});

it("does not carry bootstrap readiness into a different environment or an unreserved draft", async () => {
  atoms.registry.set(atoms.shell(LOCAL), AsyncResult.success(shellState(snapshot([thread(ONE)]))));
  setDetail(detail(thread(ONE)));
  await render(target());
  fixture.draft = { environmentId: REMOTE, threadId: TWO };
  await render({ kind: "draft", draftId: "draft" as import("../composerDraftStore").DraftId });
  expect(chat(TWO, REMOTE)).not.toBeNull();
  await render(target(ONE, REMOTE));
  expect(chat(ONE, REMOTE)).toBeNull();
  expect(fixture.navigate).not.toHaveBeenCalled();
  await act(() => {
    atoms.registry.set(
      atoms.shell(REMOTE),
      AsyncResult.success(shellState(snapshot([thread(ONE)]))),
    );
    setDetail(detail(thread(ONE)), REMOTE);
  });
  expect(displayed(ONE, REMOTE).title).toBe("one");
});

it("reports readiness from retained snapshots and clears it when the snapshot or environment leaves", async () => {
  const show = async (environmentId: EnvironmentId | null) => {
    await act(() =>
      root.render(
        <RegistryContext value={atoms.registry}>
          <BootstrapProbe environmentId={environmentId} />
        </RegistryContext>,
      ),
    );
  };
  const readiness = () => host.querySelector("output")!.textContent;
  await show(LOCAL);
  expect(readiness()).toBe("false");
  const ready = AsyncResult.success(shellState(snapshot([thread(ONE)])));
  for (const value of [
    ready,
    AsyncResult.waiting(ready),
    AsyncResult.fail(new Error("offline"), { previousSuccess: Option.some(ready) }),
    AsyncResult.success({ ...ready.value, status: "cached" as const }),
    AsyncResult.success({ ...ready.value, status: "synchronizing" as const }),
  ]) {
    await act(() => atoms.registry.set(atoms.shell(LOCAL), value));
    expect(readiness()).toBe("true");
  }
  await act(() =>
    atoms.registry.set(
      atoms.shell(LOCAL),
      AsyncResult.success({ ...ready.value, snapshot: Option.none() }),
    ),
  );
  expect(readiness()).toBe("false");
  await act(() => atoms.registry.set(atoms.shell(LOCAL), AsyncResult.fail(new Error("offline"))));
  expect(readiness()).toBe("false");
  await act(() => atoms.registry.set(atoms.shell(LOCAL), ready));
  expect(readiness()).toBe("true");
  await show(REMOTE);
  expect(readiness()).toBe("false");
  await act(() => atoms.registry.set(atoms.shell(REMOTE), ready));
  expect(readiness()).toBe("true");
  await show(null);
  expect(readiness()).toBe("false");
});
