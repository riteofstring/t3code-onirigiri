import { Outlet, createRootRoute, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";

import { CommandPalette } from "@t3tools/web/src/components/CommandPalette";
import { ConfirmDialogHost } from "@t3tools/web/src/components/ConfirmDialogHost";
import { QueuedMessageSender } from "@t3tools/web/src/components/QueuedMessageSender";
import { ThreadNotificationCoordinator } from "@t3tools/web/src/components/ThreadNotificationCoordinator";
import { AnchoredToastProvider, ToastProvider } from "@t3tools/web/src/components/ui/toast";
import { resolveInitialServerAuthGateState } from "@t3tools/web/src/environments/primary";
import { hasHostedPairingRequest, isHostedStaticApp } from "@t3tools/web/src/hostedPairing";
import { isLocalEnvironmentDisabled } from "@t3tools/web/src/localEnvironment";
import { setActiveEnvironmentId } from "@t3tools/web/src/state/entities";
import { usePrimaryEnvironmentId } from "@t3tools/web/src/state/environments";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    if (location.pathname === "/pair" && hasHostedPairingRequest(new URL(window.location.href))) {
      return { authGateState: { status: "hosted-pairing" } as const };
    }
    if (isLocalEnvironmentDisabled() || isHostedStaticApp(new URL(window.location.href))) {
      return { authGateState: { status: "hosted-static" } as const };
    }
    return { authGateState: await resolveInitialServerAuthGateState() };
  },
  component: RootRouteView,
});

function RootRouteView() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const { authGateState } = Route.useRouteContext();

  useEffect(() => {
    document.title = "Onirigiri for T3 Code";
  }, []);

  if (
    pathname === "/pair" ||
    pathname === "/connect" ||
    (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static")
  ) {
    return <Outlet />;
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ActiveEnvironmentSync />
        <ThreadNotificationCoordinator />
        <QueuedMessageSender />
        <ConfirmDialogHost />
        <CommandPalette>
          <Outlet />
        </CommandPalette>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function ActiveEnvironmentSync() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  useEffect(() => {
    if (primaryEnvironmentId) setActiveEnvironmentId(primaryEnvironmentId);
  }, [primaryEnvironmentId]);
  return null;
}
