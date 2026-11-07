import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { applyTerminalMetadataStreamEvent } from "@t3tools/client-runtime/state/terminal";
import {
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  ThreadId,
  type TerminalMetadataStreamEvent,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render, type Screen } from "../../test/render";
import { useKnownTerminalSessions } from "./terminalSessions";

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    scopes: Atom.family((_environmentId: EnvironmentId | null) =>
      Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive),
    ),
    session: Atom.make(AsyncResult.initial()).pipe(Atom.keepAlive),
    metadata: Atom.family((_environmentId: EnvironmentId) =>
      Atom.make<AsyncResult.AsyncResult<ReadonlyArray<TerminalSummary>, Error>>(
        AsyncResult.initial(),
      ).pipe(Atom.keepAlive),
    ),
  };
});

vi.mock("./session", () => ({
  environmentSession: { sessionStateAtom: () => atoms.session },
  sessionHasScope: () => false,
  useEnvironmentScope: (environmentId: EnvironmentId | null, scope: string) =>
    useAtomValue(atoms.scopes(environmentId)).has(scope),
}));

vi.mock("./terminal", () => ({
  terminalEnvironment: {
    metadata: vi.fn(({ environmentId }: { environmentId: EnvironmentId }) =>
      atoms.metadata(environmentId),
    ),
  },
}));

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const ONE = ThreadId.make("one");
const TWO = ThreadId.make("two");
const TERMINAL = "terminal-1";
const DATE = "2026-10-13T00:00:00.000Z";
const renders = new Map<string, number>();
let registry: AtomRegistry.AtomRegistry;

function summary(threadId: ThreadId, label: string): TerminalSummary {
  return {
    threadId,
    terminalId: TERMINAL,
    cwd: "/repo",
    worktreePath: null,
    status: "running",
    pid: 123,
    exitCode: null,
    exitSignal: null,
    hasRunningSubprocess: true,
    label,
    updatedAt: DATE,
  };
}

function metadata(event: TerminalMetadataStreamEvent, environmentId = LOCAL) {
  const atom = atoms.metadata(environmentId);
  const previous = Option.getOrElse(AsyncResult.value(registry.get(atom)), () => []);
  registry.set(atom, AsyncResult.success(applyTerminalMetadataStreamEvent(previous, event)));
}

function Known({
  name,
  environmentId = LOCAL,
  threadId = ONE,
}: {
  name: string;
  environmentId?: EnvironmentId | null;
  threadId?: ThreadId | null;
}) {
  const sessions = useKnownTerminalSessions({ environmentId, threadId });
  renders.set(name, (renders.get(name) ?? 0) + 1);
  return (
    <output data-probe={name}>
      {JSON.stringify(
        sessions?.map(({ target, state }) => ({
          ...target,
          label: state.summary?.label,
          status: state.status,
          running: state.hasRunningSubprocess,
        })) ?? null,
      )}
    </output>
  );
}

const displayed = (screen: Screen, name: string) =>
  JSON.parse(screen.container.querySelector(`[data-probe="${name}"]`)!.textContent!);

// router: false because these probes render no links.
const options = { router: false } as const;

function setup() {
  registry = AtomRegistry.make();
  for (const environmentId of [LOCAL, REMOTE]) {
    registry.set(
      atoms.scopes(environmentId),
      new Set([AuthTerminalReadScope, AuthTerminalOperateScope]),
    );
  }
  vi.clearAllMocks();
  renders.clear();
  const owned = registry;
  return {
    view: (children: ReactNode) => <RegistryContext value={owned}>{children}</RegistryContext>,
    [Symbol.dispose]: () => owned.dispose(),
  };
}

it("updates the owning thread without rendering another thread's terminal consumer", async () => {
  using context = setup();
  const one = summary(ONE, "One");
  const two = summary(TWO, "Two");
  metadata({ type: "snapshot", terminals: [one, two] });
  await using screen = await render(
    context.view(
      <>
        <Known name="one" />
        <Known name="two" threadId={TWO} />
      </>,
    ),
    options,
  );
  const beforeOne = renders.get("one");
  await act(() => metadata({ type: "upsert", terminal: { ...two, label: "Renamed two" } }));
  expect(displayed(screen, "two")).toMatchObject([{ label: "Renamed two" }]);
  expect.soft(renders.get("one")).toBe(beforeOne);
  const beforeTwo = renders.get("two");
  await act(() =>
    metadata({
      type: "upsert",
      terminal: { ...one, status: "exited", hasRunningSubprocess: false },
    }),
  );
  expect(displayed(screen, "one")).toMatchObject([
    { label: "One", status: "exited", running: false },
  ]);
  expect.soft(renders.get("two")).toBe(beforeTwo);
  await act(() => metadata({ type: "remove", threadId: ONE, terminalId: TERMINAL }));
  expect(displayed(screen, "one")).toEqual([]);
});

it("switches thread and environment subscriptions and supports the all-threads view", async () => {
  using context = setup();
  metadata({ type: "snapshot", terminals: [summary(ONE, "Local one"), summary(TWO, "Local two")] });
  metadata({ type: "snapshot", terminals: [summary(TWO, "Remote two")] }, REMOTE);
  await using screen = await render(context.view(<Known name="selected" />), options);
  expect(displayed(screen, "selected")).toMatchObject([
    { environmentId: LOCAL, label: "Local one" },
  ]);
  await screen.rerender(context.view(<Known name="selected" threadId={TWO} />));
  expect(displayed(screen, "selected")).toMatchObject([{ threadId: TWO, label: "Local two" }]);
  await screen.rerender(
    context.view(<Known name="selected" threadId={TWO} environmentId={REMOTE} />),
  );
  expect(displayed(screen, "selected")).toMatchObject([
    { environmentId: REMOTE, label: "Remote two" },
  ]);
  const before = renders.get("selected");
  await act(() => metadata({ type: "upsert", terminal: summary(TWO, "Changed local two") }));
  expect(renders.get("selected")).toBe(before);
  await screen.rerender(context.view(<Known name="selected" threadId={null} />));
  expect(displayed(screen, "selected").map((session: { label: string }) => session.label)).toEqual([
    "Local one",
    "Changed local two",
  ]);
  await screen.rerender(context.view(<Known name="selected" environmentId={null} />));
  expect(displayed(screen, "selected")).toBeNull();
  await screen.rerender(context.view(<Known name="selected" />));
  expect(displayed(screen, "selected")).toMatchObject([{ label: "Local one" }]);
});

it("retains metadata while refreshing but reports unknown after a failed subscription", async () => {
  using context = setup();
  await using screen = await render(context.view(<Known name="selected" />), options);
  expect(displayed(screen, "selected")).toBeNull();
  const ready = AsyncResult.success([summary(ONE, "Cached")]);
  await act(() => registry.set(atoms.metadata(LOCAL), ready));
  const before = renders.get("selected");
  await act(() => registry.set(atoms.metadata(LOCAL), AsyncResult.waiting(ready)));
  expect(displayed(screen, "selected")).toMatchObject([{ label: "Cached" }]);
  expect(renders.get("selected")).toBe(before);
  await act(() =>
    registry.set(
      atoms.metadata(LOCAL),
      AsyncResult.fail(new Error("offline"), { previousSuccess: Option.some(ready) }),
    ),
  );
  expect(displayed(screen, "selected")).toBeNull();
  await act(() => registry.set(atoms.metadata(LOCAL), AsyncResult.fail(new Error("offline"))));
  expect(displayed(screen, "selected")).toBeNull();
  await act(() => metadata({ type: "snapshot", terminals: [] }));
  expect(displayed(screen, "selected")).toEqual([]);
  await act(() => metadata({ type: "snapshot", terminals: [summary(ONE, "Recovered")] }));
  expect(displayed(screen, "selected")).toMatchObject([{ label: "Recovered" }]);
});
