// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { RightPanelEmptyState } from "./RightPanelTabs";
import { TooltipProvider } from "./ui/tooltip";

let host: HTMLDivElement;
let root: Root;

function chooserProps(): ComponentProps<typeof RightPanelEmptyState> {
  return {
    browserProfiles: [
      { id: "default", name: "Default" },
      { id: "work", name: "Work" },
    ],
    onAddBrowser: vi.fn(),
    onAddBrowserInProfile: vi.fn(),
    onAddTerminal: vi.fn(),
    onAddDiff: vi.fn(),
    onAddFiles: vi.fn(),
    onAddPullRequest: vi.fn(),
    onAddPullRequests: vi.fn(),
    onAddAgents: vi.fn(),
    onAddDevice: vi.fn(),
    browserAvailable: true,
    terminalAvailable: true,
    diffAvailable: false,
    filesAvailable: true,
    pullRequestAvailable: false,
    pullRequestsAvailable: false,
    agentsAvailable: true,
    deviceAvailable: true,
    liveAgentCount: 0,
  };
}

async function key(target: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  await act(() => target.dispatchEvent(event));
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("routes launcher letters only to the active pane as focus ownership changes", async () => {
  const first = chooserProps();
  const second = chooserProps();
  async function render(firstActive: boolean) {
    await act(() =>
      root.render(
        <TooltipProvider>
          <RightPanelEmptyState {...first} active={firstActive} />
          <RightPanelEmptyState {...second} active={!firstActive} autoFocus={false} />
        </TooltipProvider>,
      ),
    );
  }
  await render(true);
  const launchers = host.querySelectorAll('[aria-label="Open a surface"]');
  expect(document.activeElement).toBe(launchers[0]);
  expect((await key(document.body, "t")).defaultPrevented).toBe(true);
  expect(first.onAddTerminal).toHaveBeenCalledTimes(1);
  expect(second.onAddTerminal).not.toHaveBeenCalled();
  await render(false);
  await key(document.body, "t");
  expect(first.onAddTerminal).toHaveBeenCalledTimes(1);
  expect(second.onAddTerminal).toHaveBeenCalledTimes(1);
  expect(host.querySelectorAll("[data-surface-launcher-keys]")).toHaveLength(1);
  expect((await key(document.body, "d")).defaultPrevented).toBe(false);
  expect(second.onAddDiff).not.toHaveBeenCalled();
});

it("keeps typing focus when autofocus is disabled and retains arrow selection", async () => {
  const props = chooserProps();
  const composer = document.createElement("textarea");
  host.before(composer);
  composer.focus();
  await act(() =>
    root.render(
      <TooltipProvider>
        <RightPanelEmptyState {...props} autoFocus={false} />
      </TooltipProvider>,
    ),
  );
  expect(document.activeElement).toBe(composer);
  expect((await key(composer, "t")).defaultPrevented).toBe(false);
  expect(props.onAddTerminal).not.toHaveBeenCalled();
  const launcher = host.querySelector<HTMLElement>('[aria-label="Open a surface"]')!;
  launcher.focus();
  await key(launcher, "ArrowDown");
  await key(launcher, "ArrowDown");
  await key(launcher, "Enter");
  expect(props.onAddTerminal).toHaveBeenCalledTimes(1);
  composer.remove();
});

it("opens the selected native browser profile and blocks launcher letters while its menu is open", async () => {
  const props = chooserProps();
  await act(() =>
    root.render(
      <TooltipProvider>
        <RightPanelEmptyState {...props} />
      </TooltipProvider>,
    ),
  );
  await act(() => {
    host.querySelector<HTMLButtonElement>('[aria-label="Open browser in a profile"]')!.click();
  });
  const work = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Work",
  )!;
  expect(work).toBeDefined();
  await key(document.body, "t");
  expect(props.onAddTerminal).not.toHaveBeenCalled();
  await act(() => work.click());
  expect(props.onAddBrowserInProfile).toHaveBeenCalledExactlyOnceWith("work");
  expect(props.onAddBrowser).not.toHaveBeenCalled();
});
