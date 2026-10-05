import { createFileRoute } from "@tanstack/react-router";

import { DiagnosticsSettingsPanel } from "@t3tools/web/src/components/settings/DiagnosticsSettings";

export const Route = createFileRoute("/settings/diagnostics")({
  component: DiagnosticsSettingsPanel,
});
