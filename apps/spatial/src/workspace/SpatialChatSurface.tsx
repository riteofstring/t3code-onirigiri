import { useLocation } from "@tanstack/react-router";

import type { ChatSurfaceProps } from "@t3tools/web/src/components/chatSurface";
import { SidebarInset } from "@t3tools/web/src/components/ui/sidebar";
import {
  useAllEnvironmentShellsBootstrapped,
  useThreadShells,
} from "@t3tools/web/src/state/entities";

import { SpatialWorkspace } from "./SpatialWorkspace";

function SpatialChatSurface({ target, background, children }: ChatSurfaceProps) {
  const onOtherPage = useLocation({
    select: (location) => location.pathname.startsWith("/pull-requests"),
  });
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const hasThreads = useThreadShells().some((thread) => thread.archivedAt === null);
  const workspaceShown = !onOtherPage && (target !== null || !bootstrapped || hasThreads);
  return (
    <>
      <SidebarInset
        className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
        hidden={!workspaceShown}
        inert={background}
      >
        <SpatialWorkspace target={target} active={workspaceShown && !background} />
      </SidebarInset>
      {workspaceShown ? null : children}
    </>
  );
}

export function renderSpatialChatSurface(props: ChatSurfaceProps) {
  return <SpatialChatSurface {...props} />;
}
