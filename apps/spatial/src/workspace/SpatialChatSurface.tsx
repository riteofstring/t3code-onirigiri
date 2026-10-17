import { useLocation } from "@tanstack/react-router";

import type { ChatSurfaceProps } from "@t3tools/web/src/components/chatSurface";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { SidebarInset } from "@t3tools/web/src/components/ui/sidebar";
import {
  useAllEnvironmentShellsBootstrapped,
  useThreadShells,
} from "@t3tools/web/src/state/entities";

import { SpatialWorkspace } from "./SpatialWorkspace";
import { useCarriedThread } from "./useCarriedThread";

function SpatialChatSurface({ target, children }: ChatSurfaceProps) {
  const onOtherPage = useLocation({
    select: (location) => location.pathname.startsWith("/pull-requests"),
  });
  const threadTarget = target?.kind === "server" ? target : null;
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const hasThreads = useThreadShells().some((thread) => thread.archivedAt === null);
  const carried = useCarriedThread(target);
  const draftView = target !== null && (target.kind === "draft" || carried !== null);
  const workspaceShown =
    !draftView && !onOtherPage && (target !== null || !bootstrapped || hasThreads);
  return (
    <>
      <SidebarInset
        className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
        hidden={!workspaceShown}
      >
        <SpatialWorkspace target={threadTarget} active={workspaceShown} />
      </SidebarInset>
      {draftView ? <ThreadRouteView target={target} /> : workspaceShown ? null : children}
    </>
  );
}

export function renderSpatialChatSurface(props: ChatSurfaceProps) {
  return <SpatialChatSurface {...props} />;
}
