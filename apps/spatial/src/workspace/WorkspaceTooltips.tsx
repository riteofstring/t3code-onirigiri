import type { OnirigiriWorkspaceControlButtonProps } from "@riteofstring/onirigiri";
import { createContext, use, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@t3tools/web/src/components/ui/button";
import {
  Tooltip,
  TooltipCreateHandle,
  TooltipPopup,
  TooltipProvider,
  TooltipTrigger,
} from "@t3tools/web/src/components/ui/tooltip";

const WorkspaceTooltipContext = createContext<ReturnType<
  typeof TooltipCreateHandle<string>
> | null>(null);

export function WorkspaceTooltips({ children }: { children: ReactNode }) {
  const [handle] = useState(() => TooltipCreateHandle<string>());
  return (
    <TooltipProvider delay={350} closeDelay={100} timeout={400}>
      <WorkspaceTooltipContext value={handle}>{children}</WorkspaceTooltipContext>
      <Tooltip handle={handle}>
        {({ payload }) => <TooltipPopup side="top">{payload}</TooltipPopup>}
      </Tooltip>
    </TooltipProvider>
  );
}

export function WorkspaceTooltipButton({
  tooltip,
  ...props
}: ComponentProps<typeof Button> & { tooltip: string }) {
  const handle = use(WorkspaceTooltipContext);
  return (
    <TooltipTrigger
      handle={handle ?? undefined}
      payload={tooltip}
      render={
        <Button
          variant="ghost-muted"
          size="icon-xs"
          data-pressed={props["aria-pressed"] === true ? "" : undefined}
          {...props}
        />
      }
    />
  );
}

export function WorkspaceControlButton({
  control,
  className: _className,
  style: _style,
  ...props
}: OnirigiriWorkspaceControlButtonProps) {
  const shortcut =
    control.shortcuts.find((binding) => binding.binding.whileEditing) ?? control.shortcuts[0];
  return (
    <WorkspaceTooltipButton
      {...props}
      tooltip={`${control.label}${shortcut ? ` (${shortcut.label})` : ""}`}
    />
  );
}
