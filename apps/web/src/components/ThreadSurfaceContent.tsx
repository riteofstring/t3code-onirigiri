import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProjectId, ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, lazy, Suspense, useEffect, useEffectEvent } from "react";

import { focusTerminal } from "../lib/terminalFocus";
import { type RightPanelSurface, useRightPanelStore } from "../rightPanelStore";
import { ThreadRelationshipsPanel } from "./chat/ThreadRelationshipsControl";
import {
  PersistentThreadTerminalPanel,
  type PersistentThreadTerminalPanelProps,
} from "./PersistentThreadTerminals";
import { pullRequestPanelContext } from "./pullRequest/pullRequestDetail.logic";
import { PullRequestDetailPanel } from "./pullRequest/PullRequestDetailPanel";
import { PullRequestDetailGhost } from "./pullRequest/PullRequestGhosts";
import { PullRequestsUnavailableState } from "./pullRequest/PullRequestsUnavailableState";
import { ThreadPullRequestsPanel } from "./pullRequest/ThreadPullRequestsPanel";

const PreviewPanel = lazy(() =>
  import("./preview/PreviewPanel").then((module) => ({ default: module.PreviewPanel })),
);
const DiffPanel = lazy(() => import("./DiffPanel"));
const DevicePanel = lazy(() =>
  import("./device/DevicePanel").then((module) => ({ default: module.DevicePanel })),
);
const FilePreviewPanel = lazy(() => import("./files/FilePreviewPanel"));

type FilePreviewProps = ComponentProps<typeof FilePreviewPanel>;
type PullRequestProps = ComponentProps<typeof PullRequestDetailPanel>;

export interface ThreadSurfaceContext {
  composerDraftTarget: ComponentProps<typeof DiffPanel>["composerDraftTarget"];
  workspaceMutationId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  preview: { configuredUrls: ReadonlyArray<string> };
  terminal: Pick<
    PersistentThreadTerminalPanelProps,
    | "launchContext"
    | "splitShortcutLabel"
    | "splitVerticalShortcutLabel"
    | "newShortcutLabel"
    | "closeShortcutLabel"
  > & { focusRequestId: number };
  pullRequests: {
    capabilityKnown: boolean;
    supported: boolean;
    thread: Parameters<typeof pullRequestPanelContext>[0];
  };
  files: {
    project: { id?: ProjectId | undefined; title: string } | null;
    workspaceRoot: string | undefined;
    availableEditors: FilePreviewProps["availableEditors"];
    selectedFilePending: boolean;
  };
}

export interface ThreadSurfaceActions {
  onSendAnnotation: NonNullable<ComponentProps<typeof PreviewPanel>["onSendAnnotation"]>;
  terminal: Pick<
    PersistentThreadTerminalPanelProps,
    | "onAddTerminalContext"
    | "onSplitTerminal"
    | "onSplitTerminalVertical"
    | "onNewTerminal"
    | "onActiveTerminalChange"
    | "onCloseTerminal"
  >;
  getShortcutContext: PullRequestProps["getShortcutContext"];
  onSelectPullRequest: NonNullable<PullRequestProps["onSelectPullRequest"]>;
  onBackToPullRequests?: (() => void) | undefined;
  onDismissDeviceSetup: (surface: Extract<RightPanelSurface, { kind: "device" }>) => void;
  onOpenFile: FilePreviewProps["onOpenFile"];
  onFilePendingChange: FilePreviewProps["onPendingChange"];
}

export interface ThreadSurfaceContentProps {
  threadRef: ScopedThreadRef;
  surface: RightPanelSurface;
  visible: boolean;
  focused: boolean;
  context: ThreadSurfaceContext;
  actions: ThreadSurfaceActions;
}

function SurfaceTerminal({
  threadRef,
  surface,
  visible,
  focused,
  context,
  actions,
}: ThreadSurfaceContentProps & { surface: Extract<RightPanelSurface, { kind: "terminal" }> }) {
  const { focusRequestId, ...terminal } = context.terminal;
  const activeTerminalId = surface.activeTerminalId;
  const isFocused = useEffectEvent(() => focused);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves DOM focus into the terminal when the host requests it
  useEffect(() => {
    if (focusRequestId > 0 && isFocused()) focusTerminal(threadRef, activeTerminalId);
  }, [activeTerminalId, focusRequestId, threadRef]);
  return (
    <PersistentThreadTerminalPanel
      {...terminal}
      {...actions.terminal}
      visible={visible}
      focused={focused}
      threadRef={threadRef}
      surface={surface}
      keybindings={context.keybindings}
    />
  );
}

export function ThreadSurfaceContent(props: ThreadSurfaceContentProps) {
  const { threadRef, surface, visible, focused, context, actions } = props;
  switch (surface.kind) {
    case "preview":
      return (
        <Suspense fallback={null}>
          <PreviewPanel
            mode="embedded"
            threadRef={threadRef}
            tabId={surface.resourceId}
            configuredUrls={context.preview.configuredUrls}
            visible={visible}
            onSendAnnotation={actions.onSendAnnotation}
          />
        </Suspense>
      );
    case "terminal":
      return <SurfaceTerminal {...props} surface={surface} />;
    case "diff":
      return (
        <Suspense fallback={null}>
          <DiffPanel
            key={scopedThreadKey(threadRef)}
            mode="embedded"
            threadRef={threadRef}
            composerDraftTarget={context.composerDraftTarget}
            workspaceMutationId={context.workspaceMutationId}
            visible={visible}
          />
        </Suspense>
      );
    case "pull-request":
      if (!context.pullRequests.capabilityKnown) return <PullRequestDetailGhost />;
      if (!context.pullRequests.supported) {
        return (
          <PullRequestsUnavailableState
            title="Pull requests unavailable"
            error="Update this environment's T3 Code server to browse pull requests."
          />
        );
      }
      // No onClose: the surface tab's own X owns closing. The thread context drops the checkout
      // button, which suits only the thread's own pull request; any other one stays checkable out.
      return (
        <PullRequestDetailPanel
          getShortcutContext={actions.getShortcutContext}
          shortcutsEnabled={visible && focused}
          key={`${surface.host ?? ""}:${surface.repository}#${surface.number}`}
          environmentId={threadRef.environmentId}
          onSelectPullRequest={actions.onSelectPullRequest}
          threadRef={threadRef}
          reference={{
            projectId: surface.projectId as ProjectId,
            ...(surface.host ? { host: surface.host } : {}),
            repository: surface.repository,
            number: surface.number,
          }}
          initialTab={surface.detailTab ?? "summary"}
          onTabChange={(tab) => {
            useRightPanelStore.getState().setPullRequestDetailTab(threadRef, surface.id, tab);
          }}
          context={pullRequestPanelContext(context.pullRequests.thread, surface)}
          composerDraftTarget={context.composerDraftTarget}
          onBack={actions.onBackToPullRequests}
        />
      );
    case "pull-requests":
      return <ThreadPullRequestsPanel threadRef={threadRef} />;
    case "side-chat":
      return null;
    case "lineage":
      return (
        <ThreadRelationshipsPanel
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
          showLineage
          showSideChats
        />
      );
    case "device":
      return (
        <Suspense fallback={null}>
          <DevicePanel
            mode="embedded"
            threadRef={threadRef}
            key={surface.id}
            surface={surface}
            visible={visible}
            onDismissSetup={() => actions.onDismissDeviceSetup(surface)}
          />
        </Suspense>
      );
    case "files":
    case "file": {
      const attachment = surface.kind === "file" ? surface.attachment : undefined;
      if (!(context.files.project && context.files.workspaceRoot) && !attachment) return null;
      return (
        <Suspense fallback={null}>
          <FilePreviewPanel
            key={`${threadRef.environmentId}:${
              attachment ? `attachment:${attachment.id}` : context.files.workspaceRoot
            }`}
            environmentId={threadRef.environmentId}
            cwd={context.files.workspaceRoot ?? ""}
            projectName={context.files.project?.title ?? ""}
            projectId={context.files.project?.id}
            threadRef={threadRef}
            composerDraftTarget={context.composerDraftTarget}
            keybindings={context.keybindings}
            availableEditors={context.files.availableEditors}
            openInShortcutEnabled={visible}
            relativePath={surface.kind === "file" ? surface.relativePath : null}
            {...(attachment ? { attachment } : {})}
            revealLine={surface.kind === "file" ? (surface.revealLine ?? null) : null}
            revealRequestId={surface.kind === "file" ? surface.revealRequestId : 0}
            onOpenFile={actions.onOpenFile}
            onNavigateFolder={(relativePath, folderTrail, keepSource) =>
              useRightPanelStore
                .getState()
                .navigateFolder(threadRef, surface.id, relativePath, folderTrail, keepSource)
            }
            folderTrail={surface.folderTrail}
            onPendingChange={actions.onFilePendingChange}
            selectedFilePending={surface.kind === "file" && context.files.selectedFilePending}
            workspaceMutationId={context.workspaceMutationId}
          />
        </Suspense>
      );
    }
  }
}
