import { Outlet, createFileRoute, redirect, useParams } from "@tanstack/react-router";

import { SidebarProvider } from "@t3tools/web/src/components/ui/sidebar";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

import { SpatialWorkspace } from "../workspace/SpatialWorkspace";

function SpatialChatLayout() {
  const threadTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return (
    <SidebarProvider defaultOpen={false}>
      <SpatialWorkspace target={threadTarget} />
      <Outlet />
    </SidebarProvider>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: SpatialChatLayout,
});
