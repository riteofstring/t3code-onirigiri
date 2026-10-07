import { useLocation } from "@tanstack/react-router";

import type { ChatSurfaceProps } from "@t3tools/web/src/components/chatSurface";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { SidebarInset } from "@t3tools/web/src/components/ui/sidebar";

import { SpatialWorkspace } from "./SpatialWorkspace";

/**
 * The chat area of T3's shell. The workspace shows every chat route except a
 * draft and the pull-requests page, which cover it while it stays mounted.
 * The app's index shows the workspace, whose focus then sets the route,
 * rather than T3's landing draft.
 */
function SpatialChatSurface({ target, children }: ChatSurfaceProps) {
  const onOtherPage = useLocation({
    select: (location) => location.pathname.startsWith("/pull-requests"),
  });
  const threadTarget = target?.kind === "server" ? target : null;
  const workspaceShown = target?.kind !== "draft" && !onOtherPage;
  return (
    <>
      <SidebarInset
        className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
        hidden={!workspaceShown}
      >
        <SpatialWorkspace target={threadTarget} active={workspaceShown} />
      </SidebarInset>
      {target?.kind === "draft" ? (
        <ThreadRouteView target={target} />
      ) : workspaceShown ? null : (
        children
      )}
    </>
  );
}

export function renderSpatialChatSurface(props: ChatSurfaceProps) {
  return <SpatialChatSurface {...props} />;
}
