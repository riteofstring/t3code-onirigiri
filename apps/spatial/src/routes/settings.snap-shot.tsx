import { createFileRoute } from "@tanstack/react-router";

import { SnapShotSettings } from "@t3tools/web/src/components/settings/SnapShotSettings";

export const Route = createFileRoute("/settings/snap-shot")({
  component: SnapShotSettings,
});
