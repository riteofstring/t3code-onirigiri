import { useAtomValue } from "@effect/atom-react";
import type { OnirigiriWorkspaceHandle } from "@riteofstring/onirigiri";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Suspense, createContext, use, useEffect, useMemo, useRef, useState } from "react";

import DiffPanel from "@t3tools/web/src/components/DiffPanel";
import { Button } from "@t3tools/web/src/components/ui/button";
import { TerminalViewport } from "@t3tools/web/src/components/ThreadTerminalDrawer";
import { latestWorkspaceMutationId } from "@t3tools/web/src/hooks/useWorkspaceMutationRefresh";
import { useProject, useThread } from "@t3tools/web/src/state/entities";
import { primaryServerKeybindingsAtom } from "@t3tools/web/src/state/server";
import { terminalEnvironment } from "@t3tools/web/src/state/terminal";
import { useAtomCommand } from "@t3tools/web/src/state/use-atom-command";

export interface SidePaneThread {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}

function useThreadCwd(thread: SidePaneThread): string | null {
  const detail = useThread(thread);
  const project = useProject(
    detail ? { environmentId: thread.environmentId, projectId: detail.projectId } : null,
  );
  return detail?.worktreePath ?? project?.workspaceRoot ?? null;
}

/**
 * One terminal of a thread, rendered as its own workspace pane. When its
 * shell exits the pane offers to start it again.
 */
export function TerminalPane({
  thread,
  terminalId,
  focused,
  live,
  onNavigate,
}: {
  thread: SidePaneThread;
  terminalId: string;
  focused: boolean;
  live: boolean;
  onNavigate?: OnirigiriWorkspaceHandle["focus"];
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const cwd = useThreadCwd(thread);
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const [session, setSession] = useState({ attempt: 0, exited: false, failed: false });
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const activeElement = containerRef.current?.ownerDocument.activeElement;
    if (
      !focused &&
      activeElement instanceof HTMLElement &&
      containerRef.current?.contains(activeElement)
    ) {
      activeElement.blur();
    }
  }, [focused]);
  if (!cwd) return null;
  const restart = () => {
    void openTerminal({
      environmentId: thread.environmentId,
      input: { threadId: thread.threadId, terminalId, cwd },
    }).then((result) =>
      setSession((current) =>
        result._tag === "Success"
          ? { attempt: current.attempt + 1, exited: false, failed: false }
          : { ...current, failed: true },
      ),
    );
  };
  return (
    <div
      ref={containerRef}
      className="relative h-full w-full"
      data-terminal-owner="drawer"
      onKeyDownCapture={(event) => {
        const native = event.nativeEvent;
        if (
          !onNavigate ||
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
        const direction = terminalNavigationDirections[event.key];
        if (typeof direction !== "string") return;
        event.preventDefault();
        onNavigate(direction);
      }}
    >
      <TerminalViewport
        key={session.attempt}
        advancedTypography={false}
        threadRef={thread}
        threadId={thread.threadId}
        terminalId={terminalId}
        terminalLabel={terminalId}
        cwd={cwd}
        onSessionExited={() =>
          setSession((current) => ({ ...current, exited: true, failed: false }))
        }
        focusRequestId={0}
        autoFocus={focused && !session.exited}
        visible={live}
        resizeEpoch={0}
        drawerHeight={0}
        keybindings={keybindings}
      />
      {session.exited ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/85 text-foreground">
          <p className="text-sm">
            {session.failed ? "The shell could not be restarted." : "The shell exited."}
          </p>
          <Button size="sm" variant="outline" onClick={restart}>
            Restart
          </Button>
        </div>
      ) : null}
    </div>
  );
}

const terminalNavigationDirections: Readonly<
  Record<string, Parameters<OnirigiriWorkspaceHandle["focus"]>[0] | undefined>
> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

const DiffThreadContext = createContext<SidePaneThread | null>(null);

// The same revision ChatView gives its diff, so agent edits refresh the pane.
function useWorkspaceMutationId(thread: SidePaneThread): string | null {
  const detail = useThread(thread);
  const activities = detail?.activities;
  const latestCheckpointCompletedAt = detail?.checkpoints.at(-1)?.completedAt ?? null;
  return useMemo(() => {
    const activityId = activities ? latestWorkspaceMutationId(activities) : null;
    return activityId === null && latestCheckpointCompletedAt === null
      ? null
      : JSON.stringify([activityId, latestCheckpointCompletedAt]);
  }, [activities, latestCheckpointCompletedAt]);
}

function DiffThreadRoute() {
  const thread = use(DiffThreadContext);
  if (!thread) return null;
  return <DiffThreadPanel thread={thread} />;
}

function DiffThreadPanel({ thread }: { thread: SidePaneThread }) {
  const workspaceMutationId = useWorkspaceMutationId(thread);
  return (
    <Suspense fallback={null}>
      <DiffPanel
        mode="embedded"
        composerDraftTarget={thread}
        workspaceMutationId={workspaceMutationId}
      />
    </Suspense>
  );
}

const diffRootRoute = createRootRoute({ component: Outlet });
const diffRouteTree = diffRootRoute.addChildren([
  createRoute({
    getParentRoute: () => diffRootRoute,
    path: "$environmentId/$threadId",
    component: DiffThreadRoute,
  }),
]);

/**
 * A thread's diff review. DiffPanel reads its thread from the route, so each
 * pane owns a memory-history router pointed at that thread.
 */
export function DiffPane({ thread }: { thread: SidePaneThread }) {
  const [router] = useState(() =>
    createRouter({
      routeTree: diffRouteTree,
      history: createMemoryHistory({
        initialEntries: [`/${thread.environmentId}/${thread.threadId}`],
      }),
    }),
  );
  return (
    <DiffThreadContext value={thread}>
      <div className="h-full w-full overflow-hidden bg-background text-foreground">
        <RouterProvider router={router} />
      </div>
    </DiffThreadContext>
  );
}
