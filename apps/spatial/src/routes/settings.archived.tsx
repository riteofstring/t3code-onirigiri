import { createFileRoute } from "@tanstack/react-router";

import { ArchivedThreadsPanel } from "@t3tools/web/src/components/settings/SettingsPanels";

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedThreadsPanel,
});
