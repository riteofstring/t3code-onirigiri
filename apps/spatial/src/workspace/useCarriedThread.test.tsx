import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vite-plus/test";

import type { ThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { useCarriedThread } from "./useCarriedThread";

const state = {
  draftIdByThread: new Map<string, string>(),
  shell: null as null | {
    latestTurn: { turnId: string; startedAt: string | null; completedAt: string | null } | null;
    session: null;
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

let renderer: ReactTestRenderer | undefined;
let carried: string | null = null;
function Probe({ target }: { target: ThreadRouteTarget | null }) {
  carried = useCarriedThread(target);
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
  state.shell = { latestTurn: { turnId: "a", startedAt: "s", completedAt: null }, session: null };
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  state.shell = { latestTurn: { turnId: "a", startedAt: "s", completedAt: "c" }, session: null };
  await show(thread("t1"));
  expect(carried).toBe("thread:e:t1");

  state.draftIdByThread.clear();
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
