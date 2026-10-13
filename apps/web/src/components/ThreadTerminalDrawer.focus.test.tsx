// @vitest-environment jsdom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EMPTY_TERMINAL_SESSION_STATE } from "@t3tools/client-runtime/state/terminal";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import ThreadTerminalDrawer from "./ThreadTerminalDrawer";

vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("../hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("../editorPreferences", () => ({ useOpenInPreferredEditor: () => () => undefined }));
vi.mock("../state/terminalSessions", () => ({
  useAttachedTerminalSession: () => ({ ...EMPTY_TERMINAL_SESSION_STATE, status: "running" }),
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => vi.fn() }));
vi.mock("../state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("../state/preview", () => ({ previewEnvironment: {} }));
vi.mock("../state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: { create: () => new Promise(() => undefined) },
}));

const threadRef = scopeThreadRef(EnvironmentId.make("environment"), ThreadId.make("thread"));
const ignore = () => undefined;
const common: ComponentProps<typeof ThreadTerminalDrawer> = {
  mode: "panel",
  threadRef,
  threadId: threadRef.threadId,
  cwd: "/repo",
  visible: true,
  height: 0,
  terminalIds: ["terminal-1"],
  activeTerminalId: "terminal-1",
  terminalGroups: [{ id: "group", terminalIds: ["terminal-1"] }],
  activeTerminalGroupId: "group",
  focusRequestId: 0,
  onSplitTerminal: ignore,
  onSplitTerminalVertical: ignore,
  onNewTerminal: ignore,
  onActiveTerminalChange: ignore,
  onCloseTerminal: ignore,
  onHeightChange: ignore,
  onAddTerminalContext: ignore,
  keybindings: compileResolvedKeybindingsConfig([]),
};

describe("terminal panel focus ownership", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the ordinary drawer's automatic focus by default", async () => {
    await act(() => root.render(<ThreadTerminalDrawer {...common} />));
    expect(document.activeElement).toBe(container.querySelector("[tabindex='-1']"));
  });

  it.each([false, true])("only the focused visible pane claims input, split=%s", async (split) => {
    const terminalIds = split ? ["terminal-1", "terminal-2"] : ["terminal-1"];
    const props = {
      ...common,
      terminalIds,
      activeTerminalId: terminalIds.at(-1)!,
      terminalGroups: [{ id: "group", terminalIds }],
    };
    const render = (focused: "left" | "right", request = 0) =>
      act(() =>
        root.render(
          <>
            <div data-pane="left">
              <ThreadTerminalDrawer
                {...props}
                autoFocus={focused === "left"}
                focusRequestId={request}
              />
            </div>
            <div data-pane="right">
              <ThreadTerminalDrawer {...props} autoFocus={focused === "right"} />
            </div>
          </>,
        ),
      );
    const activeViewport = (pane: string) =>
      container.querySelector(`[data-pane='${pane}']`)?.querySelectorAll("[tabindex='-1']")[
        terminalIds.length - 1
      ];

    await render("left");
    expect(document.activeElement).toBe(activeViewport("left"));
    await render("right");
    expect(document.activeElement).toBe(activeViewport("right"));
    await render("right", 1);
    expect(document.activeElement).toBe(activeViewport("right"));
  });
});
