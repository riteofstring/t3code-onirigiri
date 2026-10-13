import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ProjectId, ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { type ComponentProps, lazy, Suspense } from "react";

import type { RightPanelSurface } from "../rightPanelStore";
import { AgentsPanel } from "./AgentsPanel";
import {
  PersistentThreadTerminalPanel,
  type PersistentThreadTerminalPanelProps,
} from "./PersistentThreadTerminalPanel";
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
    | "focusRequestId"
    | "splitShortcutLabel"
    | "splitVerticalShortcutLabel"
    | "newShortcutLabel"
    | "closeShortcutLabel"
  >;
  pullRequests: {
    capabilityKnown: boolean;
    supported: boolean;
    thread: Parameters<typeof pullRequestPanelContext>[0];
  };
  agentModel: ComponentProps<typeof AgentsPanel>["model"];
  files: {
    project: { title: string } | null;
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

export function ThreadSurfaceContent({
  threadRef,
  surface,
  visible,
  focused,
  context,
  actions,
}: ThreadSurfaceContentProps) {
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
      return (
        <PersistentThreadTerminalPanel
          {...context.terminal}
          {...actions.terminal}
          visible={visible}
          focused={focused}
          threadRef={threadRef}
          surface={surface}
          keybindings={context.keybindings}
        />
      );
    case "diff":
      return (
        <Suspense fallback={null}>
          <DiffPanel
            key={scopedThreadKey(threadRef)}
            mode="embedded"
            threadRef={threadRef}
            composerDraftTarget={context.composerDraftTarget}
            workspaceMutationId={context.workspaceMutationId}
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
      // Closing belongs to the containing surface. Only the thread's own pull
      // request suppresses checkout; other requests retain their page actions.
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
          context={pullRequestPanelContext(context.pullRequests.thread, surface)}
          composerDraftTarget={context.composerDraftTarget}
          onBack={actions.onBackToPullRequests}
        />
      );
    case "pull-requests":
      return <ThreadPullRequestsPanel threadRef={threadRef} />;
    case "agents":
      return (
        <AgentsPanel
          model={context.agentModel}
          environmentId={threadRef.environmentId}
          threadId={threadRef.threadId}
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
            threadRef={threadRef}
            composerDraftTarget={context.composerDraftTarget}
            keybindings={context.keybindings}
            availableEditors={context.files.availableEditors}
            relativePath={surface.kind === "file" ? surface.relativePath : null}
            {...(attachment ? { attachment } : {})}
            revealLine={surface.kind === "file" ? (surface.revealLine ?? null) : null}
            revealRequestId={surface.kind === "file" ? surface.revealRequestId : 0}
            onOpenFile={actions.onOpenFile}
            onPendingChange={actions.onFilePendingChange}
            selectedFilePending={surface.kind === "file" && context.files.selectedFilePending}
            workspaceMutationId={context.workspaceMutationId}
          />
        </Suspense>
      );
    }
  }
}
