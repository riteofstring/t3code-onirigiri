// @vitest-environment jsdom
import { EMPTY_TERMINAL_SESSION_STATE } from "../../../../packages/client-runtime/src/state/terminal";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "../../../../packages/shared/src/keybindings";
import { terminalSurface } from "@t3tools/web/src/rightPanelStore";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ToolPaneView } from "./ToolPaneView";
import type { ToolPane } from "./useToolPanes";

const state = vi.hoisted(() => ({
  runTerminalCommand: vi.fn(),
  activateTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  ready: [] as Array<() => void>,
}));

vi.mock("@riteofstring/onirigiri", () => ({ useOnirigiriPaneInteractive: () => true }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("@t3tools/web/src/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/web/src/state/session")>()),
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("@t3tools/web/src/components/RightPanelTabs", () => ({
  RightPanelEmptyState: () => null,
}));
vi.mock("@t3tools/web/src/components/chat/ThreadRelationshipsControl", () => ({
  ThreadRelationshipsPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/pullRequest/ThreadPullRequestsPanel", () => ({
  ThreadPullRequestsPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/ui/toast", () => ({
  toastManager: { add: vi.fn() },
}));
vi.mock("@t3tools/web/src/localApi", () => ({
  readLocalApi: () => ({ dialogs: { confirm: async () => true } }),
}));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
}));
vi.mock("@t3tools/web/src/editorPreferences", () => ({
  useOpenInPreferredEditor: () => () => undefined,
}));
vi.mock("@t3tools/web/src/composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: { getDraftThreadByRef: () => null }) => unknown) =>
    select({ getDraftThreadByRef: () => null }),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: () => ({
    environmentId: "environment",
    projectId: "project",
    worktreePath: null,
  }),
  useProject: () => ({ workspaceRoot: "/repo" }),
}));
vi.mock("@t3tools/web/src/state/terminalSessions", () => ({
  useKnownTerminalSessions: () => [
    { target: { terminalId: "one" }, state: { summary: { label: "Build" } } },
    { target: { terminalId: "two" }, state: { summary: { label: "Tests" } } },
    { target: { terminalId: "three" }, state: { summary: { label: "Logs" } } },
  ],
  useAttachedTerminalSession: () => ({ ...EMPTY_TERMINAL_SESSION_STATE, status: "running" }),
}));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({
  useAtomCommand: () => state.runTerminalCommand,
}));
vi.mock("@t3tools/web/src/state/server", () => ({
  serverEnvironment: { configValueAtom: () => null },
}));
vi.mock("@t3tools/web/src/state/preview", () => ({ previewEnvironment: {} }));
vi.mock("@t3tools/web/src/state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("@t3tools/web/src/previewStateStore", () => ({
  useThreadPreviewState: () => ({ serverEpoch: null }),
}));
vi.mock("@t3tools/web/src/surfaceNavigation", () => ({
  useSurfaceNavigation: () => ({
    activateTerminal: state.activateTerminal,
    closeTerminal: state.closeTerminal,
  }),
}));
vi.mock("./useToolPaneContext", () => ({
  useToolPaneContext: () => ({
    context: {
      files: {},
      terminal: { launchContext: null, focusRequestId: 0 },
      keybindings: compileResolvedKeybindingsConfig([]),
    },
    availability: {},
    cwd: "/repo",
    runtimeEnv: {},
  }),
}));
vi.mock("~/terminal/ghostty/surface", () => ({
  GhosttyTerminalSurface: {
    create: (mount: HTMLElement) =>
      new Promise((resolve) => {
        state.ready.push(() => {
          const input = document.createElement("textarea");
          input.setAttribute("aria-label", "Terminal input");
          mount.append(input);
          resolve({
            input,
            setVisible: vi.fn(),
            setTheme: vi.fn(),
            focus: () => input.focus(),
            dispose: () => input.remove(),
            isAtBottom: () => true,
            fit: vi.fn(),
            scrollToBottom: vi.fn(),
          });
        });
      }),
  },
}));

const splitPane: ToolPane = {
  paneId: "tool",
  kind: "surface",
  surface: { ...terminalSurface("one"), terminalIds: ["one", "two", "three"] },
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};

let host: HTMLDivElement;
let root: Root;
let pane = splitPane;
let focused = true;

function render(nextFocused = focused) {
  focused = nextFocused;
  root.render(
    <>
      <ToolPaneView
        pane={pane}
        focused={focused}
        visible
        onNavigate={() => false}
        onFocusThread={() => {}}
        onDismissDeviceSetup={() => {}}
        isPresent={() => true}
      />
      <textarea aria-label="Chat composer" />
    </>,
  );
}

async function openSplit() {
  await act(() => render());
  expect(state.ready).toHaveLength(3);
  await act(async () => {
    for (const ready of state.ready) ready();
  });
  const input = host.querySelector<HTMLTextAreaElement>('[aria-label="Terminal input"]')!;
  expect(document.activeElement).toBe(input);
  return input;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  state.runTerminalCommand.mockResolvedValue({ _tag: "Success" });
  pane = splitPane;
  focused = true;
  state.activateTerminal.mockImplementation(() => render());
  state.closeTerminal.mockImplementation((_ref, _surface, terminalId: string) => {
    pane = {
      ...splitPane,
      surface: {
        ...terminalSurface("one"),
        terminalIds: ["one", "two", "three"].filter((id) => id !== terminalId),
      },
    };
    render();
  });
  state.ready = [];
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

it("returns focus to an already-selected terminal when its native sidebar tab is clicked", async () => {
  const input = await openSplit();
  const tab = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === "Build",
  )!;
  await act(() => {
    tab.focus();
    tab.click();
  });
  expect(document.activeElement).toBe(input);
});

it("returns focus to the retained active terminal after another split closes", async () => {
  const input = await openSplit();
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Logs"]')!;
  await act(async () => {
    close.focus();
    close.click();
  });
  expect(host.querySelectorAll('[aria-label="Terminal input"]')).toHaveLength(2);
  expect(document.activeElement).toBe(input);
});

it("does not reclaim focus on ordinary updates or while its pane is inactive", async () => {
  await openSplit();
  const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  composer.focus();
  await act(() => render());
  expect(document.activeElement).toBe(composer);
  await act(() => render(false));
  expect(document.activeElement).toBe(composer);
});

it("preserves the composer's focus when a split closes after its pane becomes inactive", async () => {
  let resolveClose!: (result: { _tag: "Success" }) => void;
  const closing = new Promise<{ _tag: "Success" }>((resolve) => {
    resolveClose = resolve;
  });
  state.runTerminalCommand.mockReturnValueOnce(closing);
  await openSplit();
  const close = host.querySelector<HTMLButtonElement>('[aria-label="Close Logs"]')!;
  await act(() => {
    close.focus();
    close.click();
  });
  await act(() => render(false));
  const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  composer.focus();
  await act(async () => resolveClose({ _tag: "Success" }));
  expect(host.querySelectorAll('[aria-label="Terminal input"]')).toHaveLength(2);
  expect(document.activeElement).toBe(composer);
});
