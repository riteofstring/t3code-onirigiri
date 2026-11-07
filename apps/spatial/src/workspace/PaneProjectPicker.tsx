import { useAtomValue } from "@effect/atom-react";
import { useMemo, useState } from "react";

import {
  buildProjectActionItems,
  ITEM_ICON_CLASS,
  type CommandPaletteActionItem,
  type CommandPaletteProject,
} from "@t3tools/web/src/components/CommandPalette.logic";
import { CommandPaletteContent } from "@t3tools/web/src/components/CommandPaletteContent";
import { CommandPaletteResults } from "@t3tools/web/src/components/CommandPaletteResults";
import { ProjectFavicon } from "@t3tools/web/src/components/ProjectFavicon";
import { CommandDialog, CommandDialogPopup } from "@t3tools/web/src/components/ui/command";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@t3tools/web/src/components/ui/tooltip";
import { primaryServerKeybindingsAtom } from "@t3tools/web/src/state/server";
import { useProjects, useThreadShells } from "@t3tools/web/src/state/entities";

type PickedProject = ReturnType<typeof useProjects>[number];

function projectIcon(project: CommandPaletteProject) {
  return <ProjectFavicon project={project} className={ITEM_ICON_CLASS} />;
}

export function PaneProjectPicker({
  project,
  onSelect,
}: {
  project: PickedProject | null;
  onSelect: (project: PickedProject) => void;
}) {
  const [shift, setShift] = useState<{ x: number; y: number } | null>(null);
  const open = shift !== null;
  const setOpen = (next: boolean) => {
    if (!next) setShift(null);
  };
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="mx-auto mt-6 mb-2 flex w-64 max-w-[calc(100%-2rem)] items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
              aria-label={
                project ? `Project: ${project.title}. Change project` : "Choose a project"
              }
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const width = Math.min(576, window.innerWidth - 32);
                const room = Math.max(0, (window.innerWidth - width) / 2 - 16);
                const offset = box.left + box.width / 2 - window.innerWidth / 2;
                const top = window.innerHeight * 0.1;
                const below = Math.max(0, window.innerHeight - top - 420 - 16);
                setShift({
                  x: Math.max(-room, Math.min(room, offset)),
                  y: Math.max(0, Math.min(below, box.bottom + 8 - top)),
                });
              }}
            >
              <span className="text-muted-foreground">Project</span>
              {project ? <ProjectFavicon project={project} className={ITEM_ICON_CLASS} /> : null}
              <span className="min-w-0 flex-1 truncate text-start">
                {project?.title ?? "Choose a project"}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="size-3.5 text-muted-foreground"
              >
                <path d="M4 6l4 4 4-4" />
              </svg>
            </button>
          }
        />
        <TooltipPopup>The project this pane opens in</TooltipPopup>
      </Tooltip>
      {open ? (
        <CommandDialogPopup
          aria-label="Choose a project"
          className="overflow-hidden"
          style={shift ? { translate: `${shift.x}px ${shift.y}px` } : undefined}
          onBackdropPointerDown={() => setOpen(false)}
        >
          <ProjectResults
            onSelect={(picked) => {
              setOpen(false);
              onSelect(picked);
            }}
          />
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}

function ProjectResults({ onSelect }: { onSelect: (project: PickedProject) => void }) {
  const projects = useProjects();
  const threads = useThreadShells();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const items = useMemo<CommandPaletteActionItem[]>(() => {
    const latest = new Map<string, string>();
    for (const thread of threads) {
      const key = `${thread.environmentId}:${thread.projectId}`;
      if ((latest.get(key) ?? "") < thread.updatedAt) latest.set(key, thread.updatedAt);
    }
    const ordered = projects.toSorted((a, b) =>
      (latest.get(`${b.environmentId}:${b.id}`) ?? "").localeCompare(
        latest.get(`${a.environmentId}:${a.id}`) ?? "",
      ),
    );
    const byKey = new Map(
      ordered.map((project) => [`${project.environmentId}:${project.id}`, project]),
    );
    return buildProjectActionItems({
      projects: ordered.map((project): CommandPaletteProject => ({
        ...project,
        displayName: project.title,
      })),
      valuePrefix: "pane-project",
      icon: projectIcon,
      runProject: async (project) => {
        const picked = byKey.get(`${project.environmentId}:${project.id}`);
        if (picked) onSelect(picked);
      },
    });
  }, [onSelect, projects, threads]);
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = tokens.length
    ? items.filter((item) =>
        tokens.every((token) =>
          item.searchTerms.some((term) => term.toLowerCase().includes(token)),
        ),
      )
    : items;
  return (
    <CommandPaletteContent
      aria-label="Choose a project"
      autoHighlight="always"
      footerActionLabel="Select"
      inputProps={{ placeholder: "Search projects…" }}
      mode="none"
      onItemHighlighted={(value) => setHighlighted(typeof value === "string" ? value : null)}
      onValueChange={(value) => {
        setHighlighted(null);
        setQuery(value);
      }}
      value={query}
    >
      <CommandPaletteResults
        groups={matches.length ? [{ value: "projects", label: "Projects", items: matches }] : []}
        highlightedItemValue={highlighted}
        isActionsOnly={false}
        keybindings={keybindings}
        emptyStateMessage="No matching projects."
        onExecuteItem={(item) => {
          if (item.kind === "action") void item.run();
        }}
      />
    </CommandPaletteContent>
  );
}
