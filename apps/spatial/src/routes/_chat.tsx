import { Outlet, createFileRoute, redirect, useParams } from "@tanstack/react-router";

import { ThreadRouteView } from "@t3tools/web/src/components/ThreadRouteView";
import { SidebarProvider } from "@t3tools/web/src/components/ui/sidebar";
import { resolveThreadRouteTarget } from "@t3tools/web/src/threadRoutes";

function SpatialChatLayout() {
  const threadTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  return (
    <SidebarProvider defaultOpen={false}>
      {threadTarget ? <ThreadRouteView target={threadTarget} /> : <Outlet />}
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
