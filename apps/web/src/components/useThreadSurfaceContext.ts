import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  deriveAgentPanelModel,
  foldSubagentActivities,
} from "@t3tools/client-runtime/state/subagentRuntime";
import type {
  OrchestrationCheckpointSummary,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import {
  projectScriptCwd,
  projectScriptRuntimeEnv,
  resolveProjectScripts,
} from "@t3tools/shared/projectScripts";
import { visibleThreadPullRequests } from "@t3tools/shared/threadPullRequests";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo } from "react";

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
import { derivePhase } from "../session-logic";
import { useProject, useServerConfigs, useThreadDetail, useThreadShell } from "../state/entities";
import { primaryServerAvailableEditorsAtom, primaryServerKeybindingsAtom } from "../state/server";
import { environmentThreadDetails } from "../state/threads";
import { vcsEnvironment } from "../state/vcs";

const EMPTY_ACTIVITIES: ReadonlyArray<OrchestrationThreadActivity> = [];
const EMPTY_ACTIVITIES_ATOM = Atom.make(EMPTY_ACTIVITIES);
const EMPTY_CHECKPOINTS_ATOM = Atom.make<ReadonlyArray<OrchestrationCheckpointSummary>>([]);
const TERMINAL_SHORTCUT_CONTEXT = { context: { terminalFocus: true, terminalOpen: true } };

function latestCheckpointCompletedAt(
  checkpoints: ReadonlyArray<OrchestrationCheckpointSummary>,
): string | null {
  return checkpoints.at(-1)?.completedAt ?? null;
}

export function useThreadSurfaceContext(
  threadRef: ScopedThreadRef,
  { detail = "agents" }: { detail?: false | "workspace" | "agents" } = {},
) {
  const shell = useThreadShell(threadRef);
  const detailThread = useThreadDetail(detail !== false && shell === null ? threadRef : null);
  const thread = shell ?? detailThread;
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
  const workspaceActivityId = useAtomValue(
    detail === false ? EMPTY_ACTIVITIES_ATOM : environmentThreadDetails.activitiesAtom(threadRef),
    latestWorkspaceMutationId,
  );
  const checkpointCompletedAt = useAtomValue(
    detail === false ? EMPTY_CHECKPOINTS_ATOM : environmentThreadDetails.checkpointsAtom(threadRef),
    latestCheckpointCompletedAt,
  );
  const workspaceMutationId = useMemo(
    () =>
      workspaceActivityId === null && checkpointCompletedAt === null
        ? null
        : JSON.stringify([workspaceActivityId, checkpointCompletedAt]),
    [workspaceActivityId, checkpointCompletedAt],
  );
  const activities = useAtomValue(
    detail === "agents"
      ? environmentThreadDetails.activitiesAtom(threadRef)
      : EMPTY_ACTIVITIES_ATOM,
  );
  const sessionLive =
    detail === "agents" && derivePhase(thread?.session ?? null) !== "disconnected";
  const agentModel = useMemo(
    () => deriveAgentPanelModel({ agents: foldSubagentActivities(activities, { sessionLive }) }),
    [activities, sessionLive],
  );
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
  const linkedPullRequest = thread?.linkedPullRequest ?? thread?.branchPullRequest ?? null;
  const supportsPullRequests = serverConfig?.environment.capabilities.pullRequests === true;
  const supportsThreadPullRequests =
    serverConfig?.environment.capabilities.threadPullRequests === true;
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
    agentModel,
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
      browserAvailable: isPreviewSupportedInRuntime(),
      terminalAvailable: project !== null,
      diffAvailable: thread !== null && isGitRepo,
      filesAvailable: project !== null,
      pullRequestAvailable: supportsPullRequests && linkedPullRequest !== null,
      pullRequestsAvailable:
        supportsThreadPullRequests &&
        visibleThreadPullRequests(thread?.pullRequests ?? []).length > 0,
      agentsAvailable: thread !== null,
      deviceAvailable: thread !== null,
      liveAgentCount: agentModel.liveCount,
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
