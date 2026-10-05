import { createFileRoute } from "@tanstack/react-router";

import { ProjectsSettings } from "@t3tools/web/src/components/settings/ProjectsSettings";

export const Route = createFileRoute("/settings/projects")({
  component: ProjectsSettings,
});
