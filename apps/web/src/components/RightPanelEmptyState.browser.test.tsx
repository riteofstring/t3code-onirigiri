import type { ComponentProps } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { RightPanelEmptyState } from "./RightPanelTabs";
import { TooltipProvider } from "./ui/tooltip";

function chooserProps(): ComponentProps<typeof RightPanelEmptyState> {
  return {
    browserProfiles: [{ id: "default", name: "Default" }],
    onAddBrowser: vi.fn(),
    onAddBrowserInProfile: vi.fn(),
    onAddTerminal: vi.fn(),
    onAddDiff: vi.fn(),
    onAddFiles: vi.fn(),
    onAddPullRequest: vi.fn(),
    onAddPullRequests: vi.fn(),
    onAddLineage: vi.fn(),
    onAddDevice: vi.fn(),
    browserAvailable: true,
    terminalAvailable: true,
    diffAvailable: false,
    filesAvailable: true,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    lineageAvailable: true,
    deviceAvailable: true,
    sideChatAvailable: false,
    sideChatDisabledReason: null,
  };
}

async function key(target: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(() => target.dispatchEvent(event));
  return event;
}

it("routes launcher letters only to the active pane as focus ownership changes", async () => {
  const first = chooserProps();
  const second = chooserProps();
  const panes = (firstActive: boolean) => (
    <TooltipProvider>
      <RightPanelEmptyState {...first} active={firstActive} />
      <RightPanelEmptyState {...second} active={!firstActive} />
    </TooltipProvider>
  );
  await using screen = await render(panes(true), { router: false });
  const launchers = screen.container.querySelectorAll('[aria-label="Open a surface"]');
  expect(document.activeElement).toBe(launchers[0]);
  expect((await key(document.body, "t")).defaultPrevented).toBe(true);
  expect(first.onAddTerminal).toHaveBeenCalledTimes(1);
  expect(second.onAddTerminal).not.toHaveBeenCalled();

  await screen.rerender(panes(false));
  expect(document.activeElement).toBe(launchers[1]);
  await key(document.body, "t");
  expect(first.onAddTerminal).toHaveBeenCalledTimes(1);
  expect(second.onAddTerminal).toHaveBeenCalledTimes(1);
  expect((await key(document.body, "d")).defaultPrevented).toBe(false);
  expect(second.onAddDiff).not.toHaveBeenCalled();
});

it("skips unavailable rows and reaches the lineage launcher from the keyboard", async () => {
  const props = chooserProps();
  props.browserAvailable = false;
  const opened: string[] = [];
  props.onAddTerminal = () => opened.push("terminal");
  props.onAddFiles = () => opened.push("files");
  props.onAddLineage = () => opened.push("lineage");
  props.onAddDevice = () => opened.push("device");
  await using screen = await render(
    <TooltipProvider>
      <RightPanelEmptyState {...props} />
    </TooltipProvider>,
    { router: false },
  );
  const launcher = screen.container.querySelector<HTMLElement>('[aria-label="Open a surface"]')!;
  expect(document.activeElement).not.toBe(launcher);
  expect((await key(document.body, "b")).defaultPrevented).toBe(false);
  expect(props.onAddBrowser).not.toHaveBeenCalled();

  launcher.focus();
  for (let index = 0; index < 4; index++) {
    await key(launcher, "ArrowDown");
    await key(launcher, "Enter");
  }
  expect(opened).toEqual(["terminal", "files", "lineage", "device"]);
  expect(props.onAddDiff).not.toHaveBeenCalled();
  expect(props.onAddPullRequest).not.toHaveBeenCalled();
});
