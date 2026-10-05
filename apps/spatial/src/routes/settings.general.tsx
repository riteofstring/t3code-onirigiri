import { createFileRoute } from "@tanstack/react-router";

import { GeneralSettingsPanel } from "@t3tools/web/src/components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsPanel,
});
