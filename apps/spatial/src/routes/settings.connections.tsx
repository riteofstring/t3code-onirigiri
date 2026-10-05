import { createFileRoute } from "@tanstack/react-router";

import { ConnectionsSettings } from "@t3tools/web/src/components/settings/ConnectionsSettings";

export const Route = createFileRoute("/settings/connections")({
  component: ConnectionsSettings,
});
