import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ResolvedKeybindingsConfig, ScopedThreadRef } from "@t3tools/contracts";
import { projectScriptCwd, projectScriptRuntimeEnv } from "@t3tools/shared/projectScripts";
import { resolveTerminalSessionLabel } from "@t3tools/shared/terminalLabels";
import { memo, useMemo } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import type { TerminalContextSelection } from "../lib/terminalContext";
import type { RightPanelSurface } from "../rightPanelStore";
import { useProject, useThreadShell } from "../state/entities";
import { useKnownTerminalSessions } from "../state/terminalSessions";
import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

export interface PersistentTerminalLaunchContext {
  cwd: string;
  worktreePath: string | null;
}

export interface PersistentThreadTerminalPanelProps {
  visible: boolean;
  focused: boolean;
  threadRef: ScopedThreadRef;
  surface: Extract<RightPanelSurface, { kind: "terminal" }>;
  launchContext: PersistentTerminalLaunchContext | null;
  focusRequestId: number;
  keybindings: ResolvedKeybindingsConfig;
  onAddTerminalContext: (selection: TerminalContextSelection) => void;
  onSplitTerminal: () => void;
  onSplitTerminalVertical: () => void;
  onNewTerminal: () => void;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  splitShortcutLabel?: string | undefined;
  splitVerticalShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
}

export const PersistentThreadTerminalPanel = memo(function PersistentThreadTerminalPanel({
  visible,
  focused,
  threadRef,
  surface,
  launchContext,
  focusRequestId,
  keybindings,
  onAddTerminalContext,
  onSplitTerminal,
  onSplitTerminalVertical,
  onNewTerminal,
  onActiveTerminalChange,
  onCloseTerminal,
  splitShortcutLabel,
  splitVerticalShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
}: PersistentThreadTerminalPanelProps) {
  const draftThread = useComposerDraftStore((store) => store.getDraftThreadByRef(threadRef));
  const serverThread = useThreadShell(threadRef);
  const projectRef = serverThread
    ? scopeProjectRef(serverThread.environmentId, serverThread.projectId)
    : draftThread
      ? scopeProjectRef(draftThread.environmentId, draftThread.projectId)
      : null;
  const project = useProject(projectRef);
  const knownTerminalSessions = useKnownTerminalSessions({
    environmentId: threadRef.environmentId,
    threadId: threadRef.threadId,
  });
  const launchCwd = launchContext?.cwd;
  const launchWorktreePath = launchContext?.worktreePath;
  const threadWorktreePath = serverThread?.worktreePath ?? draftThread?.worktreePath ?? null;
  const activeSummary =
    knownTerminalSessions?.find((session) => session.target.terminalId === surface.activeTerminalId)
      ?.state.summary ?? null;
  const worktreePath =
    launchWorktreePath !== undefined
      ? launchWorktreePath
      : activeSummary !== null
        ? activeSummary.worktreePath
        : threadWorktreePath;
  const cwd = useMemo(
    () =>
      launchCwd ??
      activeSummary?.cwd ??
      (project
        ? projectScriptCwd({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          })
        : null),
    [activeSummary?.cwd, launchCwd, project, worktreePath],
  );
  const runtimeEnv = useMemo(
    () =>
      project
        ? projectScriptRuntimeEnv({
            project: { cwd: project.workspaceRoot },
            worktreePath,
          })
        : {},
    [project, worktreePath],
  );
  const terminalLabelsById = useMemo(() => {
    const labels = new Map<string, string>();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions?.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      labels.set(terminalId, resolveTerminalSessionLabel(terminalId, summary));
    }
    return labels;
  }, [knownTerminalSessions, surface.terminalIds]);
  const terminalLaunchLocationsById = useMemo(() => {
    const locations = new Map<
      string,
      {
        readonly cwd: string;
        readonly worktreePath: string | null;
        readonly runtimeEnv: Record<string, string>;
      }
    >();
    for (const terminalId of surface.terminalIds) {
      const summary =
        knownTerminalSessions?.find((session) => session.target.terminalId === terminalId)?.state
          .summary ?? null;
      const terminalWorktreePath =
        launchWorktreePath !== undefined
          ? launchWorktreePath
          : summary !== null
            ? summary.worktreePath
            : threadWorktreePath;
      const terminalCwd =
        launchCwd ??
        summary?.cwd ??
        (project
          ? projectScriptCwd({
              project: { cwd: project.workspaceRoot },
              worktreePath: terminalWorktreePath,
            })
          : null);
      if (!terminalCwd || !project) continue;
      locations.set(terminalId, {
        cwd: terminalCwd,
        worktreePath: terminalWorktreePath,
        runtimeEnv: projectScriptRuntimeEnv({
          project: { cwd: project.workspaceRoot },
          worktreePath: terminalWorktreePath,
        }),
      });
    }
    return locations;
  }, [
    knownTerminalSessions,
    launchCwd,
    launchWorktreePath,
    project,
    surface.terminalIds,
    threadWorktreePath,
  ]);

  if (!project || !cwd) return null;

  return (
    <ThreadTerminalDrawer
      mode="panel"
      visible={visible}
      autoFocus={focused}
      threadRef={threadRef}
      threadId={threadRef.threadId}
      cwd={cwd}
      worktreePath={worktreePath}
      runtimeEnv={runtimeEnv}
      height={0}
      terminalIds={surface.terminalIds}
      activeTerminalId={surface.activeTerminalId}
      terminalGroups={[
        {
          id: surface.id,
          terminalIds: surface.terminalIds,
          ...(surface.splitDirection === "vertical" ? { splitDirection: "vertical" as const } : {}),
        },
      ]}
      activeTerminalGroupId={surface.id}
      focusRequestId={focusRequestId}
      onSplitTerminal={onSplitTerminal}
      onSplitTerminalVertical={onSplitTerminalVertical}
      onNewTerminal={onNewTerminal}
      splitShortcutLabel={splitShortcutLabel}
      splitVerticalShortcutLabel={splitVerticalShortcutLabel}
      newShortcutLabel={newShortcutLabel}
      closeShortcutLabel={closeShortcutLabel}
      onActiveTerminalChange={onActiveTerminalChange}
      onCloseTerminal={onCloseTerminal}
      onHeightChange={() => undefined}
      onAddTerminalContext={onAddTerminalContext}
      terminalLabelsById={terminalLabelsById}
      terminalLaunchLocationsById={terminalLaunchLocationsById}
      keybindings={keybindings}
    />
  );
});
