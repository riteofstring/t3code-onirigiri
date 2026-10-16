// @vitest-environment jsdom
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  EMPTY_TERMINAL_BUFFER_STATE,
  terminalOutputText,
  type TerminalBufferState,
} from "@t3tools/client-runtime/state/terminal";
import {
  AuthTerminalReadScope,
  AuthTerminalOperateScope,
  EnvironmentId,
  ThreadId,
  type TerminalAttachInput,
  type TerminalMetadataStreamEvent,
  type TerminalObserveInput,
  type TerminalSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useAttachedTerminalSession, useKnownTerminalSessions } from "./terminalSessions";
import { terminalEnvironment } from "./terminal";

const atoms = await vi.hoisted(async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    scopes: Atom.family((_environmentId: EnvironmentId | null) =>
      Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(Atom.keepAlive),
    ),
    observe: Atom.family((_key: string) =>
      Atom.make<AsyncResult.AsyncResult<TerminalBufferState, Error>>(AsyncResult.initial()).pipe(
        Atom.keepAlive,
      ),
    ),
    metadata: Atom.family((_environmentId: EnvironmentId) =>
      Atom.make<AsyncResult.AsyncResult<ReadonlyArray<TerminalSummary>, Error>>(
        AsyncResult.initial(),
      ).pipe(Atom.keepAlive),
    ),
    attach: Atom.family((_key: string) =>
      Atom.make<AsyncResult.AsyncResult<TerminalBufferState, Error>>(AsyncResult.initial()).pipe(
        Atom.keepAlive,
      ),
    ),
  };
});

vi.mock("./session", () => ({
  useEnvironmentScope: (environmentId: EnvironmentId | null, scope: string) =>
    useAtomValue(atoms.scopes(environmentId)).has(scope),
}));

vi.mock("./terminal", () => ({
  terminalEnvironment: {
    metadata: vi.fn(({ environmentId }: { environmentId: EnvironmentId }) =>
      atoms.metadata(environmentId),
    ),
    observe: vi.fn(
      ({ environmentId, input }: { environmentId: EnvironmentId; input: TerminalObserveInput }) =>
        atoms.observe(JSON.stringify([environmentId, input.threadId, input.terminalId])),
    ),
    attach: vi.fn(
      ({ environmentId, input }: { environmentId: EnvironmentId; input: TerminalAttachInput }) =>
        atoms.attach(JSON.stringify([environmentId, input.threadId, input.terminalId])),
    ),
  },
}));

const LOCAL = EnvironmentId.make("local");
const REMOTE = EnvironmentId.make("remote");
const ONE = ThreadId.make("one");
const TWO = ThreadId.make("two");
const TERMINAL = "terminal-1";
const ATTACH_INPUT = { threadId: ONE, terminalId: TERMINAL };
const DATE = "2026-10-13T00:00:00.000Z";
const renders = new Map<string, number>();
let registry: AtomRegistry.AtomRegistry;
let host: HTMLDivElement;
let root: Root;

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

function Attached({
  environmentId = LOCAL,
  terminal = ATTACH_INPUT,
}: {
  environmentId?: EnvironmentId | null;
  terminal?: TerminalAttachInput | null;
}) {
  const state = useAttachedTerminalSession({ environmentId, terminal });
  renders.set("attached", (renders.get("attached") ?? 0) + 1);
  return (
    <output data-probe="attached">
      {JSON.stringify({
        threadId: state.summary?.threadId,
        label: state.summary?.label,
        running: state.hasRunningSubprocess,
        status: state.status,
        error: state.error,
        output: terminalOutputText(state.output),
      })}
    </output>
  );
}

const displayed = (name: string) =>
  JSON.parse(host.querySelector(`[data-probe="${name}"]`)!.textContent!);
const render = (children: ReactNode) =>
  act(() => root.render(<RegistryContext value={registry}>{children}</RegistryContext>));

beforeEach(() => {
  registry = AtomRegistry.make();
  for (const environmentId of [LOCAL, REMOTE]) {
    registry.set(
      atoms.scopes(environmentId),
      new Set([AuthTerminalReadScope, AuthTerminalOperateScope]),
    );
  }
  vi.clearAllMocks();
  renders.clear();
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

it("updates the owning thread without rendering another thread's terminal consumer", async () => {
  const one = summary(ONE, "One");
  const two = summary(TWO, "Two");
  metadata({ type: "snapshot", terminals: [one, two] });
  await render(
    <>
      <Known name="one" />
      <Known name="two" threadId={TWO} />
    </>,
  );
  const beforeOne = renders.get("one");
  await act(() => metadata({ type: "upsert", terminal: { ...two, label: "Renamed two" } }));
  expect(displayed("two")).toMatchObject([{ label: "Renamed two" }]);
  expect.soft(renders.get("one")).toBe(beforeOne);
  const beforeTwo = renders.get("two");
  await act(() =>
    metadata({
      type: "upsert",
      terminal: { ...one, status: "exited", hasRunningSubprocess: false },
    }),
  );
  expect(displayed("one")).toMatchObject([{ label: "One", status: "exited", running: false }]);
  expect.soft(renders.get("two")).toBe(beforeTwo);
  await act(() => metadata({ type: "remove", threadId: ONE, terminalId: TERMINAL }));
  expect(displayed("one")).toEqual([]);
});

it("switches thread and environment subscriptions and supports the all-threads view", async () => {
  metadata({ type: "snapshot", terminals: [summary(ONE, "Local one"), summary(TWO, "Local two")] });
  metadata({ type: "snapshot", terminals: [summary(TWO, "Remote two")] }, REMOTE);
  await render(<Known name="selected" />);
  expect(displayed("selected")).toMatchObject([{ environmentId: LOCAL, label: "Local one" }]);
  await render(<Known name="selected" threadId={TWO} />);
  expect(displayed("selected")).toMatchObject([{ threadId: TWO, label: "Local two" }]);
  await render(<Known name="selected" threadId={TWO} environmentId={REMOTE} />);
  expect(displayed("selected")).toMatchObject([{ environmentId: REMOTE, label: "Remote two" }]);
  const before = renders.get("selected");
  await act(() => metadata({ type: "upsert", terminal: summary(TWO, "Changed local two") }));
  expect(renders.get("selected")).toBe(before);
  await render(<Known name="selected" threadId={null} />);
  expect(displayed("selected").map((session: { label: string }) => session.label)).toEqual([
    "Local one",
    "Changed local two",
  ]);
  await render(<Known name="selected" environmentId={null} />);
  expect(displayed("selected")).toBeNull();
  await render(<Known name="selected" />);
  expect(displayed("selected")).toMatchObject([{ label: "Local one" }]);
});

it("retains metadata while refreshing but reports unknown after a failed subscription", async () => {
  await render(<Known name="selected" />);
  expect(displayed("selected")).toBeNull();
  const ready = AsyncResult.success([summary(ONE, "Cached")]);
  await act(() => registry.set(atoms.metadata(LOCAL), ready));
  const before = renders.get("selected");
  await act(() => registry.set(atoms.metadata(LOCAL), AsyncResult.waiting(ready)));
  expect(displayed("selected")).toMatchObject([{ label: "Cached" }]);
  expect(renders.get("selected")).toBe(before);
  await act(() =>
    registry.set(
      atoms.metadata(LOCAL),
      AsyncResult.fail(new Error("offline"), { previousSuccess: Option.some(ready) }),
    ),
  );
  expect(displayed("selected")).toBeNull();
  await act(() => registry.set(atoms.metadata(LOCAL), AsyncResult.fail(new Error("offline"))));
  expect(displayed("selected")).toBeNull();
  await act(() => metadata({ type: "snapshot", terminals: [] }));
  expect(displayed("selected")).toEqual([]);
  await act(() => metadata({ type: "snapshot", terminals: [summary(ONE, "Recovered")] }));
  expect(displayed("selected")).toMatchObject([{ label: "Recovered" }]);
});

it("uses each environment's read and operate grants and stops exposing metadata after revocation", async () => {
  metadata({ type: "snapshot", terminals: [summary(ONE, "Local")] });
  metadata({ type: "snapshot", terminals: [summary(ONE, "Remote")] }, REMOTE);
  registry.set(atoms.scopes(LOCAL), new Set([AuthTerminalReadScope]));
  registry.set(atoms.scopes(REMOTE), new Set<string>());
  const terminal = {
    ...ATTACH_INPUT,
    cwd: "/repo",
    worktreePath: "/worktree",
    env: { CUSTOM: "value" },
  };
  const observed = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
    type: "snapshot",
    snapshot: { ...summary(ONE, "Local"), history: "Read-only output" },
  });
  registry.set(
    atoms.observe(JSON.stringify([LOCAL, ONE, TERMINAL])),
    AsyncResult.success(observed),
  );
  await render(
    <>
      <Known name="selected" />
      <Attached terminal={terminal} />
    </>,
  );
  expect(terminalEnvironment.attach).not.toHaveBeenCalled();
  expect(terminalEnvironment.observe).toHaveBeenCalledWith({
    environmentId: LOCAL,
    input: ATTACH_INPUT,
  });
  expect(displayed("selected")).toMatchObject([{ label: "Local" }]);
  expect(displayed("attached")).toMatchObject({ output: "Read-only output" });
  vi.clearAllMocks();
  await act(() => registry.set(atoms.scopes(LOCAL), new Set<string>()));
  expect(displayed("selected")).toBeNull();
  expect(displayed("attached")).toMatchObject({ output: "", status: "closed" });
  expect(terminalEnvironment.metadata).not.toHaveBeenCalled();
  expect(terminalEnvironment.observe).not.toHaveBeenCalled();
  expect(terminalEnvironment.attach).not.toHaveBeenCalled();
  await render(
    <>
      <Known name="selected" environmentId={REMOTE} />
      <Attached environmentId={REMOTE} terminal={terminal} />
    </>,
  );
  expect(displayed("selected")).toBeNull();
  expect(displayed("attached")).toMatchObject({ output: "", status: "closed" });
  await act(() =>
    registry.set(atoms.scopes(REMOTE), new Set([AuthTerminalReadScope, AuthTerminalOperateScope])),
  );
  expect(displayed("selected")).toMatchObject([{ label: "Remote" }]);
  expect(terminalEnvironment.attach).toHaveBeenCalledWith({
    environmentId: REMOTE,
    input: terminal,
  });
  expect(terminalEnvironment.observe).not.toHaveBeenCalled();
  vi.clearAllMocks();
  await act(() => registry.set(atoms.scopes(REMOTE), new Set([AuthTerminalOperateScope])));
  expect(displayed("selected")).toBeNull();
  expect(terminalEnvironment.metadata).not.toHaveBeenCalled();
  expect(terminalEnvironment.attach).toHaveBeenCalledWith({
    environmentId: REMOTE,
    input: terminal,
  });
});

it("keeps an attached terminal unchanged by other metadata while preserving its live output and errors", async () => {
  const one = summary(ONE, "One");
  metadata({ type: "snapshot", terminals: [one, summary(TWO, "Two")] });
  await render(<Attached />);
  const before = renders.get("attached");
  await act(() => metadata({ type: "upsert", terminal: summary(TWO, "Renamed two") }));
  expect.soft(renders.get("attached")).toBe(before);
  await act(() => metadata({ type: "upsert", terminal: { ...one, label: "Renamed one" } }));
  expect(displayed("attached")).toMatchObject({ label: "Renamed one", running: true });
  const attach = atoms.attach(JSON.stringify([LOCAL, ONE, TERMINAL]));
  const buffer = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
    type: "snapshot",
    snapshot: { ...one, history: "Live output" },
  });
  const ready = AsyncResult.success(buffer);
  await act(() => registry.set(attach, ready));
  expect(displayed("attached")).toMatchObject({
    output: "Live output",
    status: "running",
    error: null,
  });
  await act(() =>
    registry.set(
      attach,
      AsyncResult.fail(new Error("disconnected"), { previousSuccess: Option.some(ready) }),
    ),
  );
  expect(displayed("attached")).toMatchObject({
    output: "Live output",
    status: "error",
    error: "disconnected",
  });
  await act(() => registry.set(attach, ready));
  expect(displayed("attached")).toMatchObject({
    output: "Live output",
    status: "running",
    error: null,
  });
  await render(<Attached terminal={{ threadId: TWO, terminalId: TERMINAL }} />);
  expect(displayed("attached")).toMatchObject({ threadId: TWO, label: "Renamed two", output: "" });
  metadata({ type: "snapshot", terminals: [summary(TWO, "Remote two")] }, REMOTE);
  await render(
    <Attached environmentId={REMOTE} terminal={{ threadId: TWO, terminalId: TERMINAL }} />,
  );
  expect(displayed("attached")).toMatchObject({ label: "Remote two", output: "" });
  await render(<Attached terminal={null} />);
  expect(displayed("attached")).toMatchObject({ output: "", status: "closed", running: false });
});
