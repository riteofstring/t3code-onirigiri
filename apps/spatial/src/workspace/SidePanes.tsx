import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { Suspense, createContext, use, useState } from "react";

import DiffPanel from "@t3tools/web/src/components/DiffPanel";
import { TerminalViewport } from "@t3tools/web/src/components/ThreadTerminalDrawer";
import { useProject, useThread } from "@t3tools/web/src/state/entities";
import { primaryServerKeybindingsAtom } from "@t3tools/web/src/state/server";

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

/** One terminal of a thread, rendered as its own workspace pane. */
export function TerminalPane({
  thread,
  terminalId,
  focused,
  live,
}: {
  thread: SidePaneThread;
  terminalId: string;
  focused: boolean;
  live: boolean;
}) {
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const cwd = useThreadCwd(thread);
  if (!cwd) return null;
  return (
    <div className="h-full w-full" data-terminal-owner="drawer">
      <TerminalViewport
        advancedTypography={false}
        threadRef={thread}
        threadId={thread.threadId}
        terminalId={terminalId}
        terminalLabel={terminalId}
        cwd={cwd}
        onSessionExited={() => {}}
        focusRequestId={0}
        autoFocus={focused}
        visible={live}
        resizeEpoch={0}
        drawerHeight={0}
        keybindings={keybindings}
      />
    </div>
  );
}

const DiffThreadContext = createContext<SidePaneThread | null>(null);

function DiffThreadRoute() {
  const thread = use(DiffThreadContext);
  if (!thread) return null;
  return (
    <Suspense fallback={null}>
      <DiffPanel mode="embedded" composerDraftTarget={thread} workspaceMutationId={null} />
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
