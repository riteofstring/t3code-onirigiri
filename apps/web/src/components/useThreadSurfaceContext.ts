import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThread } from "@t3tools/client-runtime/state/models";
import {
  AuthPreviewOperateScope,
  AuthTerminalOperateScope,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  resolveProjectScripts,
} from "@t3tools/shared/projectScripts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { useEffect, useMemo } from "react";
import * as DateTime from "effect/DateTime";
import { Atom } from "effect/reactivity";

import { useBrowserDefaults } from "../browser/browserDefaults";
import { recallCheckoutIsRepo, rememberCheckoutIsRepo } from "./ChatView.logic";
import type { ThreadSurfaceContext } from "./ThreadSurfaceContent";
import { useChatViewVcsStatus } from "./chatViewVcsStatus";
import { getConfiguredPreviewUrls } from "./preview/previewEmptyStateLogic";
import { useEnvironmentSettings } from "../hooks/useSettings";
import {
  latestWorkspaceMutationId,
  useWorkspaceMutationRefresh,
} from "../hooks/useWorkspaceMutationRefresh";
import { shortcutLabelForCommand } from "../keybindings";
import { isPreviewSupportedInRuntime } from "../previewStateStore";
import {
  useEnvironmentSupportsServerBrowser,
  useProject,
  useServerConfigs,
  useThreadShell,
} from "../state/entities";
import { environmentThreadDetails } from "../state/threads";
import { useFilesystemReadAccess } from "../state/filesystem";
import { useEnvironmentScope } from "../state/session";
import { primaryServerAvailableEditorsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { vcsEnvironment } from "../state/vcs";
import { threadPullRequestPanelTarget } from "./pullRequest/pullRequestDetail.logic";

const TERMINAL_SHORTCUT_CONTEXT = { context: { terminalFocus: true, terminalOpen: true } };
const EMPTY_DETAIL_ATOM = Atom.make<EnvironmentThread | null>(null);
const threadMetadata = (thread: EnvironmentThread | null) => thread?.projection.thread ?? null;
const threadWorkspaceMutationId = (thread: EnvironmentThread | null) => {
  if (thread === null) return null;
  const checkpoint = thread.projection.checkpoints.findLast(
    (checkpoint) => checkpoint.appRunOrdinal !== null && checkpoint.runId !== null,
  );
  return latestWorkspaceMutationId(
    thread.projection.visibleTurnItems,
    checkpoint ? DateTime.formatIso(checkpoint.capturedAt) : null,
  );
};

export function useThreadSurfaceContext(
  threadRef: ScopedThreadRef,
  { detail = "workspace" }: { detail?: false | "workspace" } = {},
) {
  const shell = useThreadShell(threadRef);
  const detailAtom =
    detail === false ? EMPTY_DETAIL_ATOM : environmentThreadDetails.threadAtom(threadRef);
  const fallbackThread = useAtomValue(shell ? EMPTY_DETAIL_ATOM : detailAtom, threadMetadata);
  const thread = shell ?? fallbackThread;
  const projectId = thread?.projectId;
  const projectRef = useMemo(
    () => (projectId ? scopeProjectRef(threadRef.environmentId, projectId) : null),
    [projectId, threadRef.environmentId],
  );
  const project = useProject(projectRef);
  const settings = useEnvironmentSettings(threadRef.environmentId);
  const serverConfig = useServerConfigs().get(threadRef.environmentId) ?? null;
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const availableEditors = useAtomValue(primaryServerAvailableEditorsAtom);
  const browserProfiles = useBrowserDefaults().profiles;
  const worktreePath = thread?.worktreePath ?? null;
  const cwd = project
    ? projectScriptCwd({ project: { cwd: project.workspaceRoot }, worktreePath })
    : null;
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({ project: { cwd: project.workspaceRoot }, worktreePath })
        : {},
    [project, worktreePath],
  );
  const configuredUrls = useMemo(
    () => getConfiguredPreviewUrls(project ? resolveProjectScripts(settings, project) : []),
    [project, settings],
  );
  const workspaceMutationId = useAtomValue(detailAtom, threadWorkspaceMutationId);
  const gitCwd = worktreePath ?? cwd;
  const gitStatus = useChatViewVcsStatus(
    gitCwd === null
      ? null
      : vcsEnvironment.status({
          environmentId: threadRef.environmentId,
          input: { cwd: gitCwd },
        }),
  );
  useWorkspaceMutationRefresh({
    enabled: gitCwd !== null,
    mutationId: workspaceMutationId,
    refresh: gitStatus.refresh,
    resourceKey: `git-status:${scopedThreadKey(threadRef)}:${gitCwd ?? ""}`,
  });
  const liveIsGitRepo = gitStatus.data?.isRepo;
  useEffect(() => {
    if (gitCwd !== null && liveIsGitRepo !== undefined) {
      rememberCheckoutIsRepo(threadRef.environmentId, gitCwd, liveIsGitRepo);
    }
  }, [gitCwd, liveIsGitRepo, threadRef.environmentId]);
  const isGitRepo = liveIsGitRepo ?? recallCheckoutIsRepo(threadRef.environmentId, gitCwd) ?? true;
  const linkedPullRequest = thread ? threadPullRequestPanelTarget(thread) : null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  const supportsThreadPullRequests =
    serverConfig?.environment.capabilities.threadPullRequests === true;
  const serverBrowser = useEnvironmentSupportsServerBrowser(threadRef.environmentId);
  const canOperatePreview = useEnvironmentScope(threadRef.environmentId, AuthPreviewOperateScope);
  const canOperateTerminal = useEnvironmentScope(threadRef.environmentId, AuthTerminalOperateScope);
  const { canReadFiles } = useFilesystemReadAccess(threadRef.environmentId);
  const context: ThreadSurfaceContext = {
    composerDraftTarget: threadRef,
    workspaceMutationId,
    keybindings,
    preview: { configuredUrls },
    terminal: {
      launchContext: null,
      focusRequestId: 0,
      splitShortcutLabel:
        shortcutLabelForCommand(keybindings, "terminal.split", TERMINAL_SHORTCUT_CONTEXT) ??
        undefined,
      splitVerticalShortcutLabel:
        shortcutLabelForCommand(keybindings, "terminal.splitVertical", TERMINAL_SHORTCUT_CONTEXT) ??
        undefined,
      newShortcutLabel:
        shortcutLabelForCommand(keybindings, "terminal.new", TERMINAL_SHORTCUT_CONTEXT) ??
        undefined,
      closeShortcutLabel:
        shortcutLabelForCommand(keybindings, "terminal.close", TERMINAL_SHORTCUT_CONTEXT) ??
        undefined,
    },
    pullRequests: {
      capabilityKnown: serverConfig !== null,
      supported: supportsPullRequests,
      thread: {
        projectId: thread?.projectId ?? null,
        pullRequests: thread?.pullRequests,
        linkedPullRequest: thread?.linkedPullRequest,
        branchPullRequest: thread?.branchPullRequest,
      },
    },
    files: {
      project,
      workspaceRoot: worktreePath ?? project?.workspaceRoot,
      availableEditors,
      selectedFilePending: false,
    },
  };
  return {
    context,
    availability: {
      browserAvailable: canOperatePreview && (isPreviewSupportedInRuntime() || serverBrowser),
      terminalAvailable: canOperateTerminal && project !== null,
      diffAvailable: canReadFiles && thread !== null && isGitRepo,
      filesAvailable: canReadFiles && project !== null,
      pullRequestAvailable: supportsPullRequests && linkedPullRequest !== null,
      pullRequestsAvailable:
        supportsThreadPullRequests &&
        visibleThreadPullRequests(thread?.pullRequests ?? []).length > 0,
      lineageAvailable: thread !== null,
      deviceAvailable: thread !== null,
    },
    linkedPullRequest,
    visiblePullRequestCount: visibleThreadPullRequests(thread?.pullRequests ?? []).length,
    browserProfiles,
    project,
    thread,
    cwd,
    worktreePath,
    runtimeEnv,
  };
}
