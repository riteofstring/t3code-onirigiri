import {
  useOnirigiriPaneInteractive,
  type OnirigiriWorkspaceHandle,
} from "@riteofstring/onirigiri";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChatViewActivityContext } from "@t3tools/web/src/components/chatViewActivity";
import { PaneWindowControls } from "@t3tools/web/src/components/chat/PanelLayoutControls";
import type { ChatPaneControls } from "@t3tools/web/src/components/chatPaneControls";
import { RightPanelEmptyState } from "@t3tools/web/src/components/RightPanelTabs";
import {
  ThreadSurfaceContent,
  type ThreadSurfaceActions,
} from "@t3tools/web/src/components/ThreadSurfaceContent";
import { openPreviewSession } from "@t3tools/web/src/components/preview/openPreviewSession";
import { closePreviewSession } from "@t3tools/web/src/components/preview/closePreviewSession";
import { Button } from "@t3tools/web/src/components/ui/button";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "@t3tools/web/src/components/WorkspaceBreadcrumb";
import { toastManager } from "@t3tools/web/src/components/ui/toast";
import { useDiffPanelStore } from "@t3tools/web/src/diffPanelStore";
import { isElectron } from "@t3tools/web/src/env";
import { isCommandPaletteOpen } from "@t3tools/web/src/commandPaletteBus";
import { resolveShortcutCommand } from "@t3tools/web/src/keybindings";
import {
  confirmTerminalClose,
  isTerminalCloseConfirmPending,
  resolveTerminalSessionLabel,
} from "@t3tools/web/src/lib/terminalCloseConfirm";
import {
  preventRepeatedTerminalCloseShortcut,
  preventTerminalCloseShortcut,
} from "@t3tools/web/src/lib/terminalCloseShortcut";
import { getTerminalFocusOwner } from "@t3tools/web/src/lib/terminalFocus";
import { useThreadPreviewState } from "@t3tools/web/src/previewStateStore";
import { formatEnvironmentQueryError } from "@t3tools/web/src/state/query";
import { previewEnvironment } from "@t3tools/web/src/state/preview";
import { terminalEnvironment } from "@t3tools/web/src/state/terminal";
import { useKnownTerminalSessions } from "@t3tools/web/src/state/terminalSessions";
import { useAtomCommand } from "@t3tools/web/src/state/use-atom-command";
import { useSurfaceNavigation } from "@t3tools/web/src/surfaceNavigation";
import { requestThreadSurfaceCommand } from "@t3tools/web/src/threadSurfaceCommands";
import { PANE_TERMINAL_ID_PREFIX } from "@t3tools/web/src/terminalOwnership";
import { useProject, useProjects, useThreadShell } from "@t3tools/web/src/state/entities";
import { MAX_TERMINALS_PER_GROUP } from "@t3tools/web/src/types";
import { PaneProjectPicker } from "./PaneProjectPicker";
import { usePaneActivity } from "./paneActivity";
import { newToolResourceId, toolPaneSurface, type ToolPane } from "./useToolPanes";
import { useToolPaneContext } from "./useToolPaneContext";

const directions: Readonly<
  Record<string, Parameters<OnirigiriWorkspaceHandle["focus"]>[0] | undefined>
> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const NO_THREAD_AVAILABILITY = {
  browserAvailable: false,
  terminalAvailable: false,
  diffAvailable: false,
  filesAvailable: false,
  pullRequestAvailable: false,
  pullRequestsAvailable: false,
  deviceAvailable: false,
  lineageAvailable: false,
};

const ARRIVAL_FOCUS_WAIT_MS = 3000;
const TEXT_FIELDS =
  'input:not([type]), input[type="text"], input[type="search"], input[type="url"], textarea';

export function ToolPaneView({
  pane,
  title,
  subtitle,
  controls,
  focused,
  visible,
  onNavigate,
  onFocusThread,
  onDismissDeviceSetup,
  onStartChat,
  onSelectProject,
  isPresent,
}: {
  pane: ToolPane;
  title: string;
  subtitle: string | undefined;
  controls: ChatPaneControls;
  focused: boolean;
  visible: boolean;
  onNavigate: OnirigiriWorkspaceHandle["focus"];
  onFocusThread: () => void;
  onDismissDeviceSetup: ThreadSurfaceActions["onDismissDeviceSetup"];
  onStartChat: () => void;
  onSelectProject: (project: ReturnType<typeof useProjects>[number]) => void;
  isPresent: () => boolean;
}) {
  const interactive = useOnirigiriPaneInteractive();
  const active = focused && interactive;
  const threadRef = useMemo(
    () => ({ environmentId: pane.environmentId, threadId: pane.threadId }),
    [pane.environmentId, pane.threadId],
  );
  const surface = toolPaneSurface(pane);
  const data = useToolPaneContext(threadRef, {
    detail:
      surface?.kind === "diff" || surface?.kind === "files" || surface?.kind === "file"
        ? "workspace"
        : false,
  });
  const navigation = useSurfaceNavigation();
  const ownerShell = useThreadShell(pane.kind === "empty" ? threadRef : null);
  const paneProjectId = pane.projectId ?? ownerShell?.projectId ?? null;
  const paneProject = useProject(
    paneProjectId ? { environmentId: pane.environmentId, projectId: paneProjectId } : null,
  );
  const previewState = useThreadPreviewState(surface?.kind === "preview" ? threadRef : null);
  const terminalSessions = useKnownTerminalSessions({
    environmentId: surface?.kind === "terminal" ? threadRef.environmentId : null,
    threadId: surface?.kind === "terminal" ? threadRef.threadId : null,
  });
  const openPreview = useAtomCommand(previewEnvironment.open, { reportFailure: false });
  const closePreview = useAtomCommand(previewEnvironment.close, { reportFailure: false });
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilePending, setSelectedFilePending] = useState(false);
  const selectedFilePath = surface?.kind === "file" ? surface.relativePath : null;
  const handleFilePendingChange = useCallback(
    (path: string, pending: boolean) => {
      if (path === selectedFilePath) setSelectedFilePending(pending);
    },
    [selectedFilePath],
  );
  const [terminalFocusRequestId, setTerminalFocusRequestId] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    // Arriving at a terminal puts the cursor in it, so typing works without a click.
    if (active && surface?.kind === "terminal") setTerminalFocusRequestId((value) => value + 1);
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const activity = usePaneActivity(active, interactive, rootRef);
  // Arriving at a pane takes the keyboard from the chat left behind at once, so typing never lands
  // there, and hands it to the pane's text field (file search, address bar) once that can take it.
  useEffect(() => {
    const root = rootRef.current;
    if (!active || !surface || surface.kind === "terminal" || !root) return;
    const focusField = () => {
      if (root.contains(document.activeElement) && document.activeElement !== root) return true;
      for (const field of root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        TEXT_FIELDS,
      )) {
        if (field.disabled) continue;
        field.focus({ preventScroll: true });
        if (document.activeElement === field) return true;
      }
      return false;
    };
    if (focusField()) return;
    root.focus({ preventScroll: true });
    // The field can be there but not focusable until the pane is interactive a few frames later,
    // which no mutation inside the pane reports; or it can mount later still. A click anywhere,
    // or Tab or Escape, means the user has chosen where the cursor goes; a field that appears
    // after ARRIVAL_FOCUS_WAIT_MS is no longer part of the arrival.
    let frames = 30;
    let frame = requestAnimationFrame(function retry() {
      if (focusField()) stop();
      else if (--frames > 0) frame = requestAnimationFrame(retry);
    });
    const fields = new MutationObserver(() => {
      if (focusField()) stop();
    });
    const expiry = window.setTimeout(() => stop(), ARRIVAL_FOCUS_WAIT_MS);
    const stop = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(expiry);
      fields.disconnect();
      window.removeEventListener("pointerdown", stop, true);
      window.removeEventListener("keydown", leave, true);
    };
    const leave = (event: KeyboardEvent) => {
      if (event.key === "Tab" || event.key === "Escape") stop();
    };
    fields.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
    window.addEventListener("pointerdown", stop, true);
    window.addEventListener("keydown", leave, true);
    return stop;
  }, [active, surface?.kind]);
  useEffect(() => {
    if (
      surface?.kind !== "preview" ||
      surface.resourceId === null ||
      previewState.serverEpoch === null ||
      previewState.sessions[surface.resourceId] ||
      previewState.suppressedTabIds.has(surface.resourceId)
    )
      return;
    navigation.reconcileBrowserSurfaces(threadRef, [
      ...Object.keys(previewState.sessions),
      ...previewState.suppressedTabIds,
    ]);
  }, [navigation, previewState, surface, threadRef]);

  const browser = async (profileId?: string) => {
    const source = rootRef.current;
    if (pending || !source || !isPresent()) return;
    setPending(true);
    setError(null);
    try {
      const result = await openPreviewSession({
        threadRef,
        openPreview,
        ...(profileId === undefined ? {} : { profileId }),
      });
      if (result._tag === "Failure") {
        if (rootRef.current === source) setError(formatEnvironmentQueryError(result.cause));
      } else if (rootRef.current === source && isPresent()) {
        navigation.openBrowser(threadRef, result.value.tabId);
      } else {
        const closed = await closePreviewSession({
          closePreview,
          threadRef,
          tabId: result.value.tabId,
          snapshot: result.value,
        });
        if (closed._tag === "Failure") {
          navigation.openBrowser(threadRef, result.value.tabId);
          toastManager.add({
            type: "error",
            title: "Unable to close browser",
            description: formatEnvironmentQueryError(closed.cause),
          });
        }
      }
    } finally {
      if (rootRef.current === source) setPending(false);
    }
  };
  const terminal = async (split?: "horizontal" | "vertical") => {
    const source = rootRef.current;
    if (
      pending ||
      !source ||
      !isPresent() ||
      !data.cwd ||
      (split &&
        surface?.kind === "terminal" &&
        surface.terminalIds.length >= MAX_TERMINALS_PER_GROUP)
    )
      return;
    setPending(true);
    setError(null);
    try {
      const terminalId = newToolResourceId(PANE_TERMINAL_ID_PREFIX);
      const result = await openTerminal({
        environmentId: threadRef.environmentId,
        input: {
          threadId: threadRef.threadId,
          terminalId,
          cwd: data.cwd,
          env: data.runtimeEnv,
          ...(data.worktreePath ? { worktreePath: data.worktreePath } : {}),
        },
      });
      if (result._tag === "Failure") {
        if (rootRef.current === source) setError(formatEnvironmentQueryError(result.cause));
      } else if (
        rootRef.current !== source ||
        !isPresent() ||
        (split && surface?.kind === "terminal" && !navigation.hasSurface(threadRef, surface.id))
      ) {
        const closed = await closeTerminal({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, terminalId, deleteHistory: true },
        });
        if (closed._tag === "Failure") {
          navigation.openTerminal(threadRef, terminalId);
          toastManager.add({
            type: "error",
            title: "Unable to close terminal",
            description: formatEnvironmentQueryError(closed.cause),
          });
        }
      } else if (split && surface?.kind === "terminal") {
        navigation.splitTerminal(threadRef, surface.id, terminalId, split);
      } else navigation.openTerminal(threadRef, terminalId);
    } finally {
      if (rootRef.current === source) setPending(false);
    }
  };
  const removeTerminal = async (terminalId: string) => {
    if (surface?.kind !== "terminal") return;
    const result = await closeTerminal({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, terminalId, deleteHistory: true },
    });
    if (result._tag === "Success") {
      navigation.closeTerminal(threadRef, surface.id, terminalId);
      setTerminalFocusRequestId((value) => value + 1);
    } else setError(formatEnvironmentQueryError(result.cause));
  };
  const openDiff = () => {
    useDiffPanelStore.getState().selectGitScope(threadRef, "unstaged");
    navigation.open(threadRef, "diff");
  };
  const handleTerminalShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (
      !active ||
      surface?.kind !== "terminal" ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.getModifierState("AltGraph")
    )
      return;
    const keybindings = data.context.keybindings;
    if (isTerminalCloseConfirmPending() && preventTerminalCloseShortcut(event, keybindings)) {
      event.stopPropagation();
      return;
    }
    if (
      event.defaultPrevented ||
      isCommandPaletteOpen() ||
      !(event.target instanceof HTMLElement) ||
      !rootRef.current?.contains(event.target) ||
      document.querySelector("dialog[open], [role='dialog'][aria-modal='true']")
    )
      return;
    const command = resolveShortcutCommand(event, keybindings, {
      context: {
        terminalFocus: getTerminalFocusOwner() !== null,
        terminalOpen: true,
        previewFocus: false,
        previewOpen: false,
        isWeb: !isElectron,
        isDesktop: isElectron,
      },
    });
    if (
      command !== "terminal.split" &&
      command !== "terminal.splitVertical" &&
      command !== "terminal.new" &&
      command !== "terminal.close" &&
      command !== "terminal.toggle" &&
      command !== "diff.toggle"
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    if (preventRepeatedTerminalCloseShortcut(event, keybindings) || event.repeat) return;
    switch (command) {
      case "terminal.split":
        void terminal("horizontal");
        break;
      case "terminal.splitVertical":
        void terminal("vertical");
        break;
      case "terminal.new":
        void terminal();
        break;
      case "terminal.toggle":
        onFocusThread();
        break;
      case "diff.toggle":
        if (data.availability.diffAvailable) openDiff();
        break;
      case "terminal.close": {
        const id = surface.activeTerminalId;
        const summary = terminalSessions?.find((session) => session.target.terminalId === id)?.state
          .summary;
        void confirmTerminalClose([resolveTerminalSessionLabel(id, summary)]).then((confirmed) => {
          if (confirmed) void removeTerminal(id);
        });
        break;
      }
    }
  });
  useEffect(() => {
    if (!active || surface?.kind !== "terminal") return;
    window.addEventListener("keydown", handleTerminalShortcut, true);
    return () => window.removeEventListener("keydown", handleTerminalShortcut, true);
  }, [active, surface?.kind]);
  const actions: ThreadSurfaceActions = {
    onSendAnnotation(annotation, image) {
      requestThreadSurfaceCommand(threadRef, { kind: "send-annotation", annotation, image });
      onFocusThread();
    },
    terminal: {
      onAddTerminalContext(selection) {
        requestThreadSurfaceCommand(threadRef, { kind: "add-terminal-context", selection });
        onFocusThread();
      },
      onSplitTerminal: () => void terminal("horizontal"),
      onSplitTerminalVertical: () => void terminal("vertical"),
      onNewTerminal: () => void terminal(),
      onActiveTerminalChange: (id) => {
        if (surface?.kind === "terminal") {
          navigation.activateTerminal(threadRef, surface.id, id);
          setTerminalFocusRequestId((value) => value + 1);
        }
      },
      onCloseTerminal: (id) => void removeTerminal(id),
    },
    getShortcutContext: () => ({
      terminalFocus: active && surface?.kind === "terminal",
      terminalOpen: surface?.kind === "terminal",
      previewFocus: active && surface?.kind === "preview",
      previewOpen: surface?.kind === "preview",
      isWeb: !isElectron,
      isDesktop: isElectron,
    }),
    onSelectPullRequest: (reference) =>
      navigation.openPullRequest(threadRef, {
        projectId: reference.projectId,
        repository: reference.repository,
        number: reference.number,
        ...(reference.host ? { host: reference.host } : {}),
      }),
    ...(data.availability.pullRequestsAvailable && data.visiblePullRequestCount > 1
      ? { onBackToPullRequests: () => navigation.open(threadRef, "pull-requests") }
      : {}),
    onDismissDeviceSetup,
    onOpenFile: (path) => navigation.openFile(threadRef, path),
    onFilePendingChange: handleFilePendingChange,
  };

  return (
    <ChatViewActivityContext value={activity}>
      <div
        ref={rootRef}
        tabIndex={-1}
        className="flex h-full w-full min-w-0 flex-col bg-background text-foreground outline-none"
        data-spatial-surface={surface?.kind ?? "empty"}
        onKeyDownCapture={(event) => {
          const native = event.nativeEvent;
          if (
            surface?.kind !== "terminal" ||
            event.defaultPrevented ||
            !event.altKey ||
            event.ctrlKey ||
            event.metaKey ||
            event.shiftKey ||
            native.isComposing ||
            native.keyCode === 229 ||
            native.getModifierState("AltGraph") ||
            (event.target instanceof HTMLElement &&
              event.target.closest("dialog[open], [role='dialog'][aria-modal='true']"))
          )
            return;
          const direction = directions[event.key];
          if (direction) {
            event.preventDefault();
            onNavigate(direction);
          }
        }}
      >
        <header
          className="flex h-[var(--workspace-topbar-height)] min-h-[var(--workspace-topbar-height)] shrink-0 items-center gap-2 bg-background pr-[calc(var(--workspace-controls-right)+1px)] pl-(--workspace-gutter-start)"
          data-tool-pane-header
        >
          <WorkspaceBreadcrumb ariaLabel="Pane breadcrumb" className="flex-1 overflow-clip">
            {subtitle ? (
              <>
                <WorkspaceBreadcrumbItem className="shrink">
                  <WorkspaceBreadcrumbText className="max-w-40">{subtitle}</WorkspaceBreadcrumbText>
                </WorkspaceBreadcrumbItem>
                <WorkspaceBreadcrumbSeparator>
                  <WorkspaceBreadcrumbText>/</WorkspaceBreadcrumbText>
                </WorkspaceBreadcrumbSeparator>
              </>
            ) : null}
            <WorkspaceBreadcrumbItem current className="min-w-10 flex-1">
              <h2 className="min-w-0">
                <WorkspaceBreadcrumbText>{title}</WorkspaceBreadcrumbText>
              </h2>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          <PaneWindowControls controls={controls} />
        </header>
        {error ? (
          <div role="alert" className="flex items-center gap-2 px-3 py-2 text-sm text-destructive">
            <span className="min-w-0 flex-1">{error}</span>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Dismiss error"
              onClick={() => setError(null)}
            >
              ×
            </Button>
          </div>
        ) : null}
        {surface ? (
          <ThreadSurfaceContent
            threadRef={threadRef}
            surface={surface}
            visible={visible}
            focused={active}
            context={{
              ...data.context,
              terminal: { ...data.context.terminal, focusRequestId: terminalFocusRequestId },
              files: { ...data.context.files, selectedFilePending },
            }}
            actions={actions}
          />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col" aria-busy={pending} inert={pending}>
            <PaneProjectPicker project={paneProject} onSelect={onSelectProject} />
            <RightPanelEmptyState
              {...(pane.projectId ? NO_THREAD_AVAILABILITY : data.availability)}
              browserProfiles={data.browserProfiles}
              sideChatAvailable={false}
              sideChatDisabledReason={null}
              active={active}
              onAddBrowser={() => void browser()}
              onAddBrowserInProfile={(profileId) => void browser(profileId)}
              onAddTerminal={() => void terminal()}
              onAddDiff={openDiff}
              onAddFiles={() => navigation.open(threadRef, "files")}
              onAddPullRequest={() => {
                if (data.linkedPullRequest)
                  navigation.openPullRequest(threadRef, data.linkedPullRequest);
              }}
              onAddPullRequests={() => navigation.open(threadRef, "pull-requests")}
              onAddLineage={() => navigation.open(threadRef, "lineage")}
              onAddChat={onStartChat}
              onAddDevice={() => navigation.open(threadRef, "device")}
            />
          </div>
        )}
      </div>
    </ChatViewActivityContext>
  );
}
