import type { ThreadRunSummary, ThreadRuntimeSummary } from "@t3tools/client-runtime/state/models";
import { RunId } from "@t3tools/contracts";
import { useEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { useCarriedThread } from "./useCarriedThread";

const state = {
  draftIdByThread: new Map<string, string>(),
  shell: null as null | {
    latestRun: Pick<ThreadRunSummary, "runId" | "status" | "startedAt" | "completedAt"> | null;
    runtime: Pick<ThreadRuntimeSummary, "status" | "activeRunId"> | null;
  },
};

vi.mock("@t3tools/web/src/composerDraftStore", () => ({
  useComposerDraftStore: <T,>(
    select: (store: { getDraftIdByRef: (ref: { threadId: string }) => string | null }) => T,
  ) =>
    select({
      getDraftIdByRef: (ref) => state.draftIdByThread.get(ref.threadId) ?? null,
    }),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: (ref: unknown) => (ref ? state.shell : null),
}));
vi.mock("./useWorkspacePanes", () => ({
  threadPaneId: (environmentId: string, threadId: string) => `thread:${environmentId}:${threadId}`,
}));

const draft = { kind: "draft", draftId: "d1" } as unknown as ThreadRouteTarget;
const thread = (threadId: string) =>
  ({ kind: "server", threadRef: { environmentId: "e", threadId } }) as unknown as ThreadRouteTarget;
const runId = RunId.make("a");

function run(status: ThreadRunSummary["status"]): NonNullable<typeof state.shell>["latestRun"] {
  return {
    runId,
    status,
    startedAt: "2026-10-15T12:00:00.000Z",
    completedAt: status === "completed" ? "2026-10-15T12:01:00.000Z" : null,
  };
}

let renderer: ReactTestRenderer | undefined;
let carried: string | null = null;
function Probe({ target }: { target: ThreadRouteTarget | null }) {
  const value = useCarriedThread(target);
  useEffect(() => {
    carried = value;
  });
  return null;
}
async function show(target: ThreadRouteTarget | null) {
  await act(() => {
    if (renderer) renderer.update(<Probe target={target} />);
    else renderer = create(<Probe target={target} />);
  });
}

afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  state.draftIdByThread.clear();
  state.shell = null;
});

it("carries a thread promoted from the shown draft until its turn settles", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await show(draft);
  expect(carried).toBeNull();

  state.draftIdByThread.set("t1", "d1");
  state.shell = { latestRun: run("running"), runtime: { status: "running", activeRunId: runId } };
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  state.shell = { latestRun: run("completed"), runtime: null };
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  state.draftIdByThread.clear();
  await show(thread("t1"));
  expect(carried).toBeNull();
});

it.each(["preparing", "queued", "starting", "running", "waiting"] as const)(
  "retains the promoted ChatView after its draft record leaves during %s",
  async (status) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await show(draft);
    state.draftIdByThread.set("t1", "d1");
    state.shell = { latestRun: run(status), runtime: { status, activeRunId: runId } };
    await show(thread("t1"));
    state.draftIdByThread.clear();
    await show(thread("t1"));
    expect(carried).toBe("thread:e:t1");

    state.shell = { latestRun: run("completed"), runtime: null };
    await show(thread("t1"));
    expect(carried).toBeNull();
  },
);

it("waits for the runtime to release the completed run before handing off its view", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await show(draft);
  state.draftIdByThread.set("t1", "d1");
  state.shell = { latestRun: run("running"), runtime: { status: "running", activeRunId: runId } };
  await show(thread("t1"));
  state.draftIdByThread.clear();
  state.shell = { latestRun: run("completed"), runtime: { status: "waiting", activeRunId: runId } };
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  state.shell = {
    latestRun: run("completed"),
    runtime: { status: "completed", activeRunId: null },
  };
  await show(thread("t1"));
  expect(carried).toBeNull();
});

it("releases the thread when the route moves on and ignores other threads", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await show(draft);
  state.draftIdByThread.set("t1", "d1");
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  await show(thread("t2"));
  expect(carried).toBeNull();
  await show(thread("t1"));
  expect(carried).toBeNull();
});
