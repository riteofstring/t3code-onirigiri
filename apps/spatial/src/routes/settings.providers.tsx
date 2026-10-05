import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ProviderSettingsPanel } from "@t3tools/web/src/components/settings/ProviderSettingsPanel";
import { useSettingsScope } from "@t3tools/web/src/components/settings/SettingsScopeContext";

function SettingsProvidersRoute() {
  const target = Route.useSearch();
  const { environment } = useSettingsScope();
  if (!environment) return null;
  return (
    <ProviderSettingsPanel
      environmentId={environment.environmentId}
      {...(target.instanceId ? { instanceId: target.instanceId } : {})}
      scoped
    />
  );
}

export const Route = createFileRoute("/settings/providers")({
  validateSearch: (raw: Record<string, unknown>) => ({
    ...(typeof raw.environmentId === "string" && raw.environmentId.trim()
      ? { environmentId: EnvironmentId.make(raw.environmentId) }
      : {}),
    ...(typeof raw.instanceId === "string" && raw.instanceId.trim()
      ? { instanceId: ProviderInstanceId.make(raw.instanceId) }
      : {}),
  }),
  component: SettingsProvidersRoute,
});
