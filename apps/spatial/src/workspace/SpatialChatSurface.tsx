import type { ChatSurfaceProps } from "@t3tools/web/src/components/chatSurface";
import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { SidebarInset } from "@t3tools/web/src/components/ui/sidebar";

import { SpatialWorkspace } from "./SpatialWorkspace";

/**
 * The chat area of T3's shell. Server threads live in the workspace, which
 * stays mounted while a draft or a non-thread route is shown instead.
 */
export function SpatialChatSurface({ target, children }: ChatSurfaceProps) {
  const threadTarget = target?.kind === "server" ? target : null;
  return (
    <>
      <SidebarInset
        className="h-svh min-h-0 overflow-hidden overscroll-y-none md:h-dvh"
        hidden={threadTarget === null}
      >
        <SpatialWorkspace target={threadTarget} />
      </SidebarInset>
      {target?.kind === "draft" ? (
        <ThreadRouteView target={target} />
      ) : threadTarget ? null : (
        children
      )}
    </>
  );
}
