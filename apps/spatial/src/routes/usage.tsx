import { createFileRoute } from "@tanstack/react-router";

import { UsagePage } from "@t3tools/web/src/components/usage/UsagePage";

export const Route = createFileRoute("/usage")({
  component: UsagePage,
});
