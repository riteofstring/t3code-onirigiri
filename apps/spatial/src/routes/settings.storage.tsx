import { createFileRoute } from "@tanstack/react-router";

import { StorageSettingsPanel } from "@t3tools/web/src/components/settings/StorageSettings";

export const Route = createFileRoute("/settings/storage")({
  component: StorageSettingsPanel,
});
