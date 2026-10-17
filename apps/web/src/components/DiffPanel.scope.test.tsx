// @vitest-environment jsdom

import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId, RunId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useDiffPanelStore } from "../diffPanelStore";
import DiffPanel from "./DiffPanel";

const access = vi.hoisted(() => ({ deniedEnvironmentId: null as string | null }));
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
  useThreadShell: (ref: { environmentId: string; threadId: string } | null) =>
    ref
      ? {
          ...ref,
          projectId: "project",
          worktreePath: null,
        }
      : null,
  useThreadProjection: (ref: { environmentId: string; threadId: string } | null) =>
    ref
      ? {
          environmentId: ref.environmentId,
          projection: {
            checkpoints: [
              {
                id: `${ref.threadId}-checkpoint`,
                scopeId: `${ref.threadId}-scope`,
                runId: `${ref.threadId}-latest`,
                appRunOrdinal: 1,
                ref: "refs/t3/checkpoint/latest",
                status: "ready",
                files: [],
                capturedAt: DateTime.makeUnsafe("2026-10-13T00:00:00Z"),
              },
            ],
            messages: [],
          },
        }
      : null,
}));
vi.mock("../state/filesystem", () => ({
  useFilesystemReadAccess: (environmentId: string | null) => ({
    canReadFiles: environmentId !== access.deniedEnvironmentId,
    isPending: false,
    error: null,
  }),
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
const other = scopeThreadRef(EnvironmentId.make("other-environment"), ThreadId.make("other"));
const previousRun = RunId.make("previous");
const selection = (ref: typeof owner) =>
  useDiffPanelStore.getState().byThreadKey[scopedThreadKey(ref)];

describe("diff surface ownership", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    access.deniedEnvironmentId = null;
    useDiffPanelStore.setState({ byThreadKey: {}, branchBaseRefByThreadKey: {} });
    useDiffPanelStore.getState().selectTurn(owner, previousRun);
    useDiffPanelStore.getState().selectTurn(other, previousRun);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("reconciles the explicit owner's selected turn without changing another thread's selection", async () => {
    await act(() =>
      root.render(
        <DiffPanel threadRef={owner} composerDraftTarget={owner} workspaceMutationId={null} />,
      ),
    );
    expect(selection(owner)).toMatchObject({ kind: "turn", turnId: "owner-latest" });
    expect(selection(other)).toMatchObject({ kind: "turn", turnId: previousRun });
  });

  it("applies the explicit owner's file permissions", async () => {
    access.deniedEnvironmentId = owner.environmentId;
    useDiffPanelStore.getState().selectGitScope(owner, "branch");
    await act(() =>
      root.render(
        <DiffPanel threadRef={owner} composerDraftTarget={owner} workspaceMutationId={null} />,
      ),
    );
    expect(container.textContent).toContain("This connection cannot read local diffs.");
    expect(selection(other)).toMatchObject({ kind: "turn", turnId: previousRun });
  });
});
