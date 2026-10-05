import { createFileRoute } from "@tanstack/react-router";

import { SourceControlSettingsPanel } from "@t3tools/web/src/components/settings/SourceControlSettings";

export const Route = createFileRoute("/settings/source-control")({
  component: SourceControlSettingsPanel,
});
