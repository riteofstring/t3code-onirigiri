// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId, TurnId } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useDiffPanelStore } from "../diffPanelStore";
import DiffPanel from "./DiffPanel";

const route = vi.hoisted(() => ({
  params: { environmentId: "route-environment", threadId: "route-thread" },
  reads: 0,
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: typeof route.params) => unknown }) => {
    route.reads++;
    return select(route.params);
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: () => DEFAULT_CLIENT_SETTINGS,
  useUpdateClientSettings: () => vi.fn(),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => vi.fn() }));
vi.mock("../fileContextMenu", () => ({ useFileContextMenuHandler: () => vi.fn() }));
vi.mock("../state/entities", () => ({
  useProject: () => null,
  useThread: (ref: typeof route.params | null) =>
    ref
      ? {
          ...ref,
          projectId: "project",
          worktreePath: null,
          checkpoints: [
            {
              turnId: `${ref.threadId}-latest`,
              checkpointTurnCount: 1,
              completedAt: "2026-10-13T00:00:00Z",
            },
          ],
        }
      : null,
}));
vi.mock("../lib/checkpointDiffState", () => ({ useCheckpointDiff: () => ({}) }));
vi.mock("../hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: vi.fn() }));
vi.mock("../state/query", () => ({ useEnvironmentQuery: () => ({ refresh: vi.fn() }) }));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/review", () => ({ reviewEnvironment: {} }));
vi.mock("../state/vcs", () => ({ vcsEnvironment: {} }));
vi.mock("./diffs/useReviewFilePatches", () => ({
  useReviewFilePatches: () => ({ renderableFiles: [], readyFilePaths: new Set(), fileStates: [] }),
}));
vi.mock("./diffs/useCodeViewFileReveal", () => ({ useCodeViewFileReveal: () => vi.fn() }));
vi.mock("./DiffPanelShell", () => ({
  DiffPanelShell: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  DiffPanelLoadingState: () => null,
}));

const owner = scopeThreadRef(EnvironmentId.make("owner-environment"), ThreadId.make("owner"));
const routed = scopeThreadRef(
  EnvironmentId.make(route.params.environmentId),
  ThreadId.make(route.params.threadId),
);
const previousTurn = TurnId.make("previous");
const selection = (ref: typeof owner) =>
  useDiffPanelStore.getState().byThreadKey[scopedThreadKey(ref)];

describe("diff surface ownership", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    route.reads = 0;
    useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
    useDiffPanelStore.getState().selectTurn(owner, previousTurn);
    useDiffPanelStore.getState().selectTurn(routed, previousTurn);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reconciles the explicit owner's selected turn without reading or changing the route", async () => {
    await act(() =>
      root.render(
        <DiffPanel threadRef={owner} composerDraftTarget={owner} workspaceMutationId={null} />,
      ),
    );
    expect(selection(owner)).toMatchObject({ kind: "turn", turnId: "owner-latest" });
    expect(selection(routed)).toMatchObject({ kind: "turn", turnId: previousTurn });
    expect(route.reads).toBe(0);
  });

  it("retains route-owned behavior when no explicit owner is supplied", async () => {
    await act(() =>
      root.render(<DiffPanel composerDraftTarget={routed} workspaceMutationId={null} />),
    );
    expect(selection(routed)).toMatchObject({ kind: "turn", turnId: "route-thread-latest" });
    expect(selection(owner)).toMatchObject({ kind: "turn", turnId: previousTurn });
  });
});
