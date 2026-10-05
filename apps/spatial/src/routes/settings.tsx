import { Outlet, createFileRoute, redirect, useLocation } from "@tanstack/react-router";

import { SettingsScopeProvider } from "@t3tools/web/src/components/settings/SettingsScopeContext";
import {
  retainSettingsScope,
  validateSettingsRouteSearch,
} from "@t3tools/web/src/components/settings/settingsScopeNavigation";
import { SidebarProvider } from "@t3tools/web/src/components/ui/sidebar";

export const Route = createFileRoute("/settings")({
  validateSearch: validateSettingsRouteSearch,
  search: { middlewares: [retainSettingsScope] },
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    if (location.pathname === "/settings") {
      throw redirect({ to: "/settings/general", replace: true });
    }
  },
  component: SettingsLayout,
});

function SettingsLayout() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  return (
    <SidebarProvider defaultOpen={false}>
      <SettingsScopeProvider
        search={search}
        singleEnvironment={pathname === "/settings/providers"}
        onChange={(next) => {
          void navigate({
            to: pathname,
            search: () => ({
              project: next.project,
              machine: next.machine,
              checkout: next.checkout,
            }),
            hash: "",
            resetScroll: false,
          });
        }}
      >
        <main className="h-dvh min-h-0 overflow-auto bg-background text-foreground">
          <Outlet />
        </main>
      </SettingsScopeProvider>
    </SidebarProvider>
  );
}
