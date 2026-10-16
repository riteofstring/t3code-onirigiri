import {
  PanelBottomIcon,
  PanelRightIcon,
  SquareMenuIcon,
  Maximize2Icon,
  Minimize2Icon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import { Maximize2, Minimize2 } from "lucide";
import { MorphIcon } from "~/components/MorphIcon";
import { memo, useContext, type ReactElement } from "react";
import { ChatPaneControlsContext, type ChatPaneControls } from "../chatPaneControls";
import { Button } from "../ui/button";
import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";
import { Toggle } from "../ui/toggle";
import { Tooltip, TooltipPopup, TooltipProvider, TooltipTrigger } from "../ui/tooltip";

export interface PanelLayoutControlsProps {
  showThreadPanelControl?: boolean;
  showTerminalControl?: boolean;
  showRightPanelControl?: boolean;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  terminalShortcutLabel: string | null;
  threadPanelOpen: boolean;
  threadPanelPresentation: ThreadPanelPresentation;
  threadPanelPopoverHandle?: ReturnType<typeof PopoverCreateHandle>;
  threadPanelShortcutLabel: string | null;
  rightPanelAvailable: boolean;
  rightPanelOpen: boolean;
  rightPanelShortcutLabel: string | null;
  rightPanelUnavailableLabel?: string;
  onToggleTerminal: () => void;
  onToggleThreadPanel: () => void;
  onToggleRightPanel: () => void;
}

export const PanelLayoutControls = memo(function PanelLayoutControls({
  showThreadPanelControl = true,
  showTerminalControl = true,
  showRightPanelControl = true,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  threadPanelOpen,
  threadPanelPresentation,
  threadPanelPopoverHandle,
  threadPanelShortcutLabel,
  rightPanelAvailable,
  rightPanelOpen,
  rightPanelShortcutLabel,
  rightPanelUnavailableLabel = "Right panel is unavailable",
  onToggleTerminal,
  onToggleThreadPanel,
  onToggleRightPanel,
}: PanelLayoutControlsProps) {
  const paneControls = useContext(ChatPaneControlsContext);
  const threadPanelToggle = (
    <Toggle
      className="relative shrink-0 [-webkit-app-region:no-drag]"
      pressed={threadPanelOpen}
      aria-label="Toggle thread details panel"
      variant="ghost"
      size="sm"
    >
      <SquareMenuIcon className="size-4" />
    </Toggle>
  );
  const threadPanelTooltip = (trigger: ReactElement) => (
    <Tooltip>
      <TooltipTrigger
        render={trigger}
        {...(threadPanelPresentation === "popover" ? {} : { onClick: onToggleThreadPanel })}
      />
      <TooltipPopup side="bottom">
        Toggle thread details
        {threadPanelShortcutLabel ? ` (${threadPanelShortcutLabel})` : ""}
      </TooltipPopup>
    </Tooltip>
  );

  return (
    <div
      className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
      data-panel-layout-controls
    >
      {showThreadPanelControl
        ? threadPanelPresentation === "popover"
          ? threadPanelTooltip(
              <PopoverTrigger handle={threadPanelPopoverHandle} render={threadPanelToggle} />,
            )
          : threadPanelTooltip(threadPanelToggle)
        : null}
      {paneControls ? (
        showTerminalControl || showRightPanelControl ? (
          <ChatPaneLayoutControls
            controls={paneControls}
            showTerminalControl={showTerminalControl}
            terminalAvailable={terminalAvailable}
            terminalOpen={terminalOpen}
            terminalShortcutLabel={terminalShortcutLabel}
            onToggleTerminal={onToggleTerminal}
          />
        ) : null
      ) : (
        <>
          {showTerminalControl ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0" />}>
                <Toggle
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  pressed={terminalOpen}
                  onPressedChange={onToggleTerminal}
                  aria-label="Toggle terminal drawer"
                  variant="ghost"
                  size="sm"
                  disabled={!terminalAvailable}
                >
                  <PanelBottomIcon className="size-4" />
                </Toggle>
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {terminalAvailable
                  ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
                  : "Terminal drawer is unavailable"}
              </TooltipPopup>
            </Tooltip>
          ) : null}
          {showRightPanelControl ? (
            <Tooltip>
              <TooltipTrigger render={<span className="flex shrink-0" />}>
                <Toggle
                  className="shrink-0 [-webkit-app-region:no-drag]"
                  pressed={rightPanelOpen}
                  onPressedChange={onToggleRightPanel}
                  aria-label="Toggle right panel"
                  variant="ghost"
                  size="sm"
                  disabled={!rightPanelAvailable}
                >
                  <PanelRightIcon className="size-4" />
                </Toggle>
              </TooltipTrigger>
              <TooltipPopup side="bottom">
                {rightPanelAvailable
                  ? `Toggle right panel${rightPanelShortcutLabel ? ` (${rightPanelShortcutLabel})` : ""}`
                  : rightPanelUnavailableLabel}
              </TooltipPopup>
            </Tooltip>
          ) : null}
        </>
      )}
    </div>
  );
});

export const RightPanelMaximizeControl = memo(function RightPanelMaximizeControl({
  maximized,
  onToggle,
}: {
  maximized: boolean;
  onToggle: () => void;
}) {
  const label = maximized ? "Restore panel size" : "Maximize panel";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Toggle
            className="shrink-0 [-webkit-app-region:no-drag]"
            pressed={maximized}
            onPressedChange={onToggle}
            aria-label={label}
            variant="ghost"
            size="sm"
          >
            <MorphIcon className="size-4" icon={maximized ? Minimize2 : Maximize2} />
          </Toggle>
        }
      />
      <TooltipPopup side="bottom">{label}</TooltipPopup>
    </Tooltip>
  );
});

function ChatPaneLayoutControls({
  controls,
  showTerminalControl,
  terminalAvailable,
  terminalOpen,
  terminalShortcutLabel,
  onToggleTerminal,
}: Pick<
  PanelLayoutControlsProps,
  | "showTerminalControl"
  | "terminalAvailable"
  | "terminalOpen"
  | "terminalShortcutLabel"
  | "onToggleTerminal"
> & { controls: ChatPaneControls }) {
  const maximizeLabel = controls.maximized ? "Restore pane" : "Maximize pane";
  const terminalLabel = terminalAvailable
    ? `Toggle terminal drawer${terminalShortcutLabel ? ` (${terminalShortcutLabel})` : ""}`
    : "Terminal drawer is unavailable";
  return (
    <TooltipProvider delay={350} closeDelay={100} timeout={400}>
      <Tooltip<string>>
        {({ payload }) => (
          <div
            className="flex h-full shrink-0 items-center gap-1 [-webkit-app-region:no-drag]"
            data-panel-layout-controls
          >
            {showTerminalControl ? (
              <TooltipTrigger
                payload={terminalLabel}
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Toggle terminal drawer"
                    aria-pressed={terminalOpen}
                    disabled={!terminalAvailable}
                    onClick={onToggleTerminal}
                  />
                }
              >
                <PanelBottomIcon className="size-4" />
              </TooltipTrigger>
            ) : null}
            <TooltipTrigger
              payload="Add pane to the right"
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add pane to the right"
                  onClick={controls.addPane}
                />
              }
            >
              <PlusIcon className="size-4" />
            </TooltipTrigger>
            <TooltipTrigger
              payload={maximizeLabel}
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={maximizeLabel}
                  aria-pressed={controls.maximized}
                  onClick={controls.toggleMaximized}
                />
              }
            >
              {controls.maximized ? (
                <Minimize2Icon className="size-4" />
              ) : (
                <Maximize2Icon className="size-4" />
              )}
            </TooltipTrigger>
            <TooltipTrigger
              payload="Close pane"
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Close pane"
                  onClick={controls.closePane}
                />
              }
            >
              <XIcon className="size-4" />
            </TooltipTrigger>
            <TooltipPopup side="bottom">{payload}</TooltipPopup>
          </div>
        )}
      </Tooltip>
    </TooltipProvider>
  );
}
