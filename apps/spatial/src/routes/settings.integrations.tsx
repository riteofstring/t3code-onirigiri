import { createFileRoute } from "@tanstack/react-router";

import { IntegrationsSettingsPanel } from "@t3tools/web/src/components/settings/IntegrationsSettings";

export const Route = createFileRoute("/settings/integrations")({
  component: IntegrationsSettingsPanel,
});
