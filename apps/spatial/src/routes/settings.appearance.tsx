import { createFileRoute } from "@tanstack/react-router";

import { AppearanceSettingsPanel } from "@t3tools/web/src/components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/appearance")({
  component: AppearanceSettingsPanel,
});
