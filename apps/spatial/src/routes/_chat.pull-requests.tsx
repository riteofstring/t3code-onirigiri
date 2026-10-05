import { createFileRoute } from "@tanstack/react-router";

import type { PullRequestsSearch } from "@t3tools/web/src/routes/_chat.pull-requests";

export const Route = createFileRoute("/_chat/pull-requests")({
  validateSearch: (raw: Record<string, unknown>): PullRequestsSearch => ({
    involvement:
      raw.involvement === "reviewing" || raw.involvement === "authored" ? raw.involvement : "all",
    state:
      raw.state === "closed" || raw.state === "merged" || raw.state === "all" ? raw.state : "open",
  }),
  component: () => null,
});
