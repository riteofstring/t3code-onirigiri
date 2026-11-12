// @vitest-environment jsdom
import {
  DEFAULT_BROWSER_PROFILE_ID,
  FILL_PREVIEW_VIEWPORT,
  type EnvironmentId,
  type ThreadId,
} from "@t3tools/contracts";
import {
  compileResolvedKeybindingsConfig,
  DEFAULT_KEYBINDINGS,
} from "../../../../packages/shared/src/keybindings";
import { browserSurface, terminalSurface } from "@t3tools/web/src/rightPanelStore";
import {
  readThreadPreviewState,
  resetPreviewStateForTests,
} from "@t3tools/web/src/previewStateStore";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ToolPaneView } from "./ToolPaneView";
import type { ToolPane } from "./useToolPanes";

const state = vi.hoisted(() => ({
  terminalKeys: [] as string[],
  preventedKeys: [] as string[],
  openTerminal: vi.fn(),
  closeTerminal: vi.fn(),
  openPreview: vi.fn(),
  closePreview: vi.fn(),
  isPresent: vi.fn(),
  confirm: vi.fn(),
  toast: vi.fn(),
  focusThread: vi.fn(),
  preview: {
    serverEpoch: null as string | null,
    sessions: {} as Record<string, object>,
    suppressedTabIds: new Set<string>(),
  },
  navigation: {
    open: vi.fn(),
    splitTerminal: vi.fn(),
    openTerminal: vi.fn(),
    openBrowser: vi.fn(),
    closeTerminal: vi.fn(),
    hasSurface: vi.fn(),
    reconcileBrowserSurfaces: vi.fn(),
  },
}));
const bindings = compileResolvedKeybindingsConfig([
  ...DEFAULT_KEYBINDINGS,
  { key: "ctrl+shift+g", command: "diff.toggle" },
]);
vi.mock("@riteofstring/onirigiri", () => ({ useOnirigiriPaneInteractive: () => true }));
vi.mock("@t3tools/web/src/components/RightPanelTabs", () => ({
  RightPanelEmptyState: (props: { onAddBrowser: () => void; onAddTerminal: () => void }) => (
    <>
      <button onClick={props.onAddBrowser}>Add browser</button>
      <button onClick={props.onAddTerminal}>Add terminal</button>
    </>
  ),
}));
vi.mock("@t3tools/web/src/browser/browserDefaults", () => ({
  resolveBrowserDefaults: async () => ({}),
  browserDefaultOpenViewport: () => FILL_PREVIEW_VIEWPORT,
  browserDefaultOpenProfileId: () => DEFAULT_BROWSER_PROFILE_ID,
}));
vi.mock("@t3tools/web/src/components/ui/button", () => ({ Button: () => null }));
vi.mock("@t3tools/web/src/components/ui/toast", () => ({ toastManager: { add: state.toast } }));
vi.mock("@t3tools/web/src/localApi", () => ({
  readLocalApi: () => ({ dialogs: { confirm: state.confirm } }),
}));
vi.mock("@t3tools/web/src/env", () => ({ isElectron: false }));
vi.mock("@t3tools/web/src/state/query", () => ({ formatEnvironmentQueryError: String }));
vi.mock("@t3tools/web/src/state/preview", () => ({
  previewEnvironment: {
    open: { operation: "preview-open" },
    close: { operation: "preview-close" },
  },
}));
vi.mock("@t3tools/web/src/state/terminal", () => ({
  terminalEnvironment: { open: { operation: "open" }, close: { operation: "close" } },
}));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({
  useAtomCommand: (command: { operation?: string }) =>
    command.operation === "preview-open"
      ? state.openPreview
      : command.operation === "preview-close"
        ? state.closePreview
        : command.operation === "close"
          ? state.closeTerminal
          : state.openTerminal,
}));
vi.mock("@t3tools/web/src/surfaceNavigation", () => ({
  useSurfaceNavigation: () => state.navigation,
}));
vi.mock("@t3tools/web/src/previewStateStore", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/web/src/previewStateStore")>()),
  useThreadPreviewState: () => state.preview,
}));
vi.mock("@t3tools/web/src/state/terminalSessions", () => ({
  useKnownTerminalSessions: () => [
    { target: { terminalId: "onirigiri-pane-one" }, state: { summary: { label: "Build shell" } } },
  ],
}));
vi.mock("./useToolPaneContext", () => ({
  useToolPaneContext: () => ({
    context: { files: {}, keybindings: bindings },
    availability: { diffAvailable: true },
    cwd: "/workspace",
    runtimeEnv: {},
  }),
}));
vi.mock("@t3tools/web/src/components/ThreadSurfaceContent", async () => {
  const { useEffect, useRef } = await import("react");
  return {
    ThreadSurfaceContent: ({
      focused: autoFocus,
      surface,
    }: {
      focused: boolean;
      surface: { kind: string };
    }) => {
      const ref = useRef<HTMLTextAreaElement>(null);
      useEffect(() => {
        const input = ref.current;
        if (!input) return;
        const consume = (event: KeyboardEvent) => {
          if (event.defaultPrevented) {
            state.preventedKeys.push(event.key);
            return;
          }
          state.terminalKeys.push(event.key);
          event.preventDefault();
          event.stopPropagation();
        };
        input.addEventListener("keydown", consume);
        return () => input.removeEventListener("keydown", consume);
      }, []);
      useEffect(() => {
        if (autoFocus && surface.kind === "terminal") ref.current?.focus();
      }, [autoFocus, surface.kind]);
      return surface.kind === "preview" ? (
        <div data-browser-surface-slot="runtime-one" />
      ) : (
        <textarea ref={ref} data-terminal-owner="right-panel" aria-label="Terminal input" />
      );
    },
  };
});

const paneControls = {
  maximized: false,
  addPane: () => {},
  closePane: () => {},
  toggleMaximized: () => {},
};

let host: HTMLDivElement;
let root: Root;
let navigate: ReturnType<typeof vi.fn<(direction: string) => boolean>>;

const terminalPane: ToolPane = {
  paneId: "tool-one",
  kind: "terminal",
  terminalId: "onirigiri-pane-one",
  environmentId: "environment-one" as EnvironmentId,
  threadId: "thread-one" as ThreadId,
};
const threadRef = { environmentId: terminalPane.environmentId, threadId: terminalPane.threadId };

async function render(focused = true, pane: ToolPane = terminalPane) {
  await act(async () => {
    root.render(
      <>
        <ToolPaneView
          pane={pane}
          title="Terminal"
          subtitle="Thread one"
          controls={paneControls}
          focused={focused}
          visible
          onNavigate={navigate}
          onFocusThread={state.focusThread}
          onDismissDeviceSetup={() => {}}
          onStartChat={() => {}}
          onSelectProject={() => {}}
          isPresent={state.isPresent}
        />
        <textarea aria-label="Chat composer" />
      </>,
    );
  });
}

async function chooseFromEmptyPane(kind: "browser" | "terminal") {
  let resolveOpening!: (result: object) => void;
  const open = kind === "browser" ? state.openPreview : state.openTerminal;
  open.mockReturnValueOnce(
    new Promise<object>((resolve) => {
      resolveOpening = resolve;
    }),
  );
  await render(true, { ...terminalPane, kind: "empty" });
  await act(async () => {
    [...host.querySelectorAll("button")]
      .find((button) => button.textContent === `Add ${kind}`)!
      .click();
  });
  return {
    open,
    close: kind === "browser" ? state.closePreview : state.closeTerminal,
    present: kind === "browser" ? state.navigation.openBrowser : state.navigation.openTerminal,
    complete: () =>
      act(async () =>
        resolveOpening({
          _tag: "Success",
          value: {
            threadId: threadRef.threadId,
            tabId: "new-browser",
            navStatus: { _tag: "Idle" },
            canGoBack: false,
            canGoForward: false,
            updatedAt: "2026-10-13T00:00:00.000Z",
          },
        }),
      ),
  };
}

function terminal() {
  return host.querySelector<HTMLTextAreaElement>('[aria-label="Terminal input"]')!;
}

function key(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.terminalKeys = [];
  state.preventedKeys = [];
  vi.clearAllMocks();
  state.openTerminal.mockResolvedValue({ _tag: "Success" });
  state.closeTerminal.mockResolvedValue({ _tag: "Success" });
  state.closePreview.mockResolvedValue({ _tag: "Success" });
  state.isPresent.mockReturnValue(true);
  resetPreviewStateForTests();
  state.confirm.mockResolvedValue(true);
  state.navigation.hasSurface.mockReturnValue(true);
  state.preview = { serverEpoch: null, sessions: {}, suppressedTabIds: new Set() };
  navigate = vi.fn(() => true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("reserves Option arrows before an autofocused terminal consumes them, including repeats and edges", async () => {
  await render();
  expect(document.activeElement).toBe(terminal());
  for (const keyName of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]) {
    expect(key(terminal(), keyName, { altKey: true }).defaultPrevented).toBe(true);
  }
  navigate.mockReturnValue(false);
  key(terminal(), "ArrowRight", { altKey: true, repeat: true });
  expect(navigate.mock.calls.map(([direction]) => direction)).toEqual([
    "left",
    "right",
    "up",
    "down",
    "right",
  ]);
  expect(state.terminalKeys).toEqual([]);
  expect(state.preventedKeys).toEqual([
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "ArrowRight",
  ]);
});

it("leaves ordinary shell keys, modified arrows, composition and previously handled input alone", async () => {
  await render();
  key(terminal(), "x");
  key(terminal(), "ArrowLeft");
  key(terminal(), "c", { ctrlKey: true });
  key(terminal(), "ArrowRight", { altKey: true, shiftKey: true });
  key(terminal(), "ArrowRight", { altKey: true, ctrlKey: true });
  key(terminal(), "ArrowRight", { altKey: true, metaKey: true });
  key(terminal(), "ArrowRight", { altKey: true, isComposing: true });
  key(terminal(), "ArrowRight", { altKey: true, keyCode: 229 });
  key(terminal(), "ArrowRight", { altKey: true, modifierAltGraph: true });
  const handled = new KeyboardEvent("keydown", {
    key: "ArrowLeft",
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  terminal().dispatchEvent(handled);
  expect(navigate).not.toHaveBeenCalled();
  expect(state.terminalKeys).toHaveLength(9);
  expect(state.preventedKeys).toEqual(["ArrowLeft"]);
});

it("preserves Option word movement in chat fields and releases only the inactive terminal's focus", async () => {
  await render();
  const input = terminal();
  await render(false);
  expect(document.activeElement).not.toBe(input);
  expect(terminal()).toBe(input);
  const chat = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  chat.focus();
  expect(key(chat, "ArrowLeft", { altKey: true }).defaultPrevented).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  await render(true);
  chat.focus();
  await render(false);
  expect(document.activeElement).toBe(chat);
});

it("puts the cursor in a non-terminal pane's text field on arrival, and not while inactive", async () => {
  const filesPane = {
    ...terminalPane,
    kind: "surface",
    surface: { id: "files", kind: "files" },
  } as unknown as ToolPane;
  const frame = () =>
    act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await render(false, filesPane);
  const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  composer.focus();
  await frame();
  expect(document.activeElement).toBe(composer);
  await render(true, filesPane);
  await frame();
  expect(document.activeElement).toBe(host.querySelector('[aria-label="Terminal input"]'));
});

const browserPane = {
  ...terminalPane,
  kind: "surface",
  surface: { id: "preview", kind: "preview", resourceId: null },
} as unknown as ToolPane;

async function arriveFromComposer() {
  await render(false, browserPane);
  const composer = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  composer.focus();
  await render(true, browserPane);
  return {
    composer,
    root: host.querySelector<HTMLElement>("[data-spatial-surface]")!,
    slot: host.querySelector("[data-browser-surface-slot]")!,
  };
}

it("takes the keyboard from the chat left behind at once, then gives it to a text field that mounts or is enabled later", async () => {
  const { root, slot } = await arriveFromComposer();
  expect(document.activeElement).toBe(root);
  const checkbox = Object.assign(document.createElement("input"), { type: "checkbox" });
  const address = Object.assign(document.createElement("input"), { disabled: true });
  await act(async () => slot.append(checkbox, address));
  await act(() => new Promise((resolve) => setTimeout(resolve, 600)));
  key(root, "a");
  expect(document.activeElement).toBe(root);
  await act(async () => {
    address.disabled = false;
  });
  expect(document.activeElement).toBe(address);
});

it("leaves the cursor where a click put it when a field mounts afterwards", async () => {
  const { composer, slot } = await arriveFromComposer();
  composer.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  composer.focus();
  await act(async () => slot.append(document.createElement("input")));
  expect(document.activeElement).toBe(composer);
});

it("does not navigate the workspace from a modal terminal", async () => {
  await render();
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  key(terminal(), "ArrowLeft", { altKey: true });
  expect(navigate).not.toHaveBeenCalled();
  expect(state.terminalKeys).toEqual(["ArrowLeft"]);
});

it("dispatches native terminal split, vertical split, new, toggle and configured diff shortcuts once", async () => {
  await render();
  for (const [letter, shift] of [
    ["d", false],
    ["d", true],
    ["n", false],
  ] as const) {
    await act(async () => {
      key(terminal(), letter, { ctrlKey: true, shiftKey: shift });
      key(terminal(), letter, { ctrlKey: true, shiftKey: shift, repeat: true });
    });
  }
  expect(state.openTerminal).toHaveBeenCalledTimes(3);
  expect(state.navigation.splitTerminal.mock.calls.map((call) => call[3])).toEqual([
    "horizontal",
    "vertical",
  ]);
  expect(state.navigation.openTerminal).toHaveBeenCalledTimes(1);
  await act(async () => {
    key(terminal(), "j", { ctrlKey: true });
    key(terminal(), "g", { ctrlKey: true, shiftKey: true });
  });
  expect(state.focusThread).toHaveBeenCalledOnce();
  expect(state.navigation.open).toHaveBeenCalledWith(threadRef, "diff");
  expect(state.closeTerminal).not.toHaveBeenCalled();
  expect(state.terminalKeys).toEqual([]);
});

it("confirms the named terminal close, suppresses repeat and pending confirmations, and respects cancellation", async () => {
  let resolveConfirmation = (_value: boolean) => {};
  const confirmation = new Promise<boolean>((resolve) => {
    resolveConfirmation = resolve;
  });
  state.confirm.mockReturnValueOnce(confirmation);
  await render();
  await act(async () => key(terminal(), "w", { ctrlKey: true }));
  const chat = host.querySelector<HTMLTextAreaElement>('[aria-label="Chat composer"]')!;
  expect(key(chat, "w", { ctrlKey: true }).defaultPrevented).toBe(true);
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(
    'Close terminal "Build shell"?\nThis stops the running process and clears its history.',
    { variant: "destructive" },
  );
  expect(state.closeTerminal).not.toHaveBeenCalled();
  await act(async () => resolveConfirmation(false));
  expect(state.closeTerminal).not.toHaveBeenCalled();
  await act(async () => {
    key(terminal(), "w", { ctrlKey: true, repeat: true });
    key(terminal(), "w", { ctrlKey: true });
  });
  expect(state.confirm).toHaveBeenCalledTimes(2);
  expect(state.closeTerminal).toHaveBeenCalledExactlyOnceWith({
    environmentId: threadRef.environmentId,
    input: { threadId: threadRef.threadId, terminalId: "onirigiri-pane-one", deleteHistory: true },
  });
  expect(state.navigation.closeTerminal).toHaveBeenCalledWith(
    threadRef,
    "terminal:onirigiri-pane-one",
    "onirigiri-pane-one",
  );
});

it("leaves terminal commands to an active modal or palette and ignores inactive, composed and already-handled input", async () => {
  await render();
  key(terminal(), "d", { ctrlKey: true, isComposing: true });
  key(terminal(), "d", { ctrlKey: true, keyCode: 229 });
  key(terminal(), "d", { ctrlKey: true, modifierAltGraph: true });
  const handled = new KeyboardEvent("keydown", {
    key: "d",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  handled.preventDefault();
  terminal().dispatchEvent(handled);
  host.setAttribute("data-command-palette", "");
  key(terminal(), "d", { ctrlKey: true });
  host.removeAttribute("data-command-palette");
  host.setAttribute("role", "dialog");
  host.setAttribute("aria-modal", "true");
  key(terminal(), "d", { ctrlKey: true });
  host.removeAttribute("role");
  host.removeAttribute("aria-modal");
  await render(false);
  key(terminal(), "d", { ctrlKey: true });
  expect(state.openTerminal).not.toHaveBeenCalled();
});

it("does not create a PTY when a terminal split is already full", async () => {
  const ids = ["onirigiri-pane-one", "two", "three", "four"];
  await render(true, {
    ...terminalPane,
    kind: "surface",
    surface: {
      ...terminalSurface(ids[0]!),
      terminalIds: ids,
    },
  });
  await act(async () => key(terminal(), "d", { ctrlKey: true }));
  expect(state.openTerminal).not.toHaveBeenCalled();
});

it.each([false, true])(
  "settles a split after the source closes without losing the new terminal (cleanup failure=%s)",
  async (failure) => {
    let resolveOpening = (_value: { _tag: "Success" }) => {};
    const opening = new Promise<{ _tag: "Success" }>((resolve) => {
      resolveOpening = resolve;
    });
    state.openTerminal.mockReturnValueOnce(opening);
    state.closeTerminal.mockResolvedValueOnce(
      failure ? { _tag: "Failure", cause: "Disconnected" } : { _tag: "Success" },
    );
    await render();
    await act(async () => key(terminal(), "d", { ctrlKey: true }));
    const id = state.openTerminal.mock.calls[0]![0].input.terminalId;
    state.navigation.hasSurface.mockReturnValue(false);
    await act(async () => root.render(null));
    await act(async () => resolveOpening({ _tag: "Success" }));
    expect(state.navigation.splitTerminal).not.toHaveBeenCalled();
    expect(state.closeTerminal).toHaveBeenCalledWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, terminalId: id, deleteHistory: true },
    });
    if (failure) {
      expect(state.navigation.openTerminal).toHaveBeenCalledWith(threadRef, id);
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ type: "error", description: "Disconnected" }),
      );
    } else {
      expect(state.navigation.openTerminal).not.toHaveBeenCalled();
      expect(state.toast).not.toHaveBeenCalled();
    }
  },
);

it("blurs only the browser guest owned by a pane that becomes inactive", async () => {
  const pane: ToolPane = { ...terminalPane, kind: "surface", surface: browserSurface("one") };
  const guest = document.createElement("webview");
  guest.tabIndex = -1;
  guest.dataset.previewTab = "runtime-one";
  document.body.append(guest);
  try {
    await render(true, pane);
    guest.focus();
    expect(document.activeElement).toBe(guest);
    await render(false, pane);
    expect(document.activeElement).not.toBe(guest);
    await render(true, pane);
    guest.dataset.previewTab = "unrelated";
    guest.focus();
    await render(false, pane);
    expect(document.activeElement).toBe(guest);
  } finally {
    guest.remove();
  }
});

it("reconciles an externally closed browser only after its server snapshot, preserving suppressed sessions", async () => {
  const pane: ToolPane = { ...terminalPane, kind: "surface", surface: browserSurface("one") };
  await render(true, pane);
  expect(state.navigation.reconcileBrowserSurfaces).not.toHaveBeenCalled();
  state.preview = { serverEpoch: "server", sessions: {}, suppressedTabIds: new Set(["one"]) };
  await render(true, pane);
  expect(state.navigation.reconcileBrowserSurfaces).not.toHaveBeenCalled();
  state.preview = { serverEpoch: "server", sessions: { one: {} }, suppressedTabIds: new Set() };
  await render(true, pane);
  expect(state.navigation.reconcileBrowserSurfaces).not.toHaveBeenCalled();
  state.preview = {
    serverEpoch: "server",
    sessions: { two: {} },
    suppressedTabIds: new Set(["optimistic"]),
  };
  await render(true, pane);
  expect(state.navigation.reconcileBrowserSurfaces).toHaveBeenCalledExactlyOnceWith(threadRef, [
    "two",
    "optimistic",
  ]);
  expect(state.navigation.open).not.toHaveBeenCalled();
  expect(state.focusThread).not.toHaveBeenCalled();
});

it.each(["browser", "terminal"] as const)(
  "cleans a new %s when its chooser unmounts before the open completes",
  async (kind) => {
    const { open, close, present, complete } = await chooseFromEmptyPane(kind);
    expect(open).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    await complete();
    const input =
      kind === "browser"
        ? { tabId: "new-browser" }
        : {
            terminalId: open.mock.calls[0]![0].input.terminalId,
            deleteHistory: true,
          };
    expect(close).toHaveBeenCalledExactlyOnceWith({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, ...input },
    });
    expect(present).not.toHaveBeenCalled();
    expect(state.toast).not.toHaveBeenCalled();
    if (kind === "browser") expect(readThreadPreviewState(threadRef).sessions).toEqual({});
  },
);

it.each(["browser", "terminal"] as const)(
  "reveals the new %s and reports failure when its closing chooser cannot clean it up",
  async (kind) => {
    const { open, close, present, complete } = await chooseFromEmptyPane(kind);
    close.mockResolvedValueOnce({ _tag: "Failure", cause: "Disconnected" });
    state.isPresent.mockReturnValue(false);
    await complete();
    const id = kind === "browser" ? "new-browser" : open.mock.calls[0]![0].input.terminalId;
    expect(close).toHaveBeenCalledOnce();
    expect(present).toHaveBeenCalledExactlyOnceWith(threadRef, id);
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", description: "Disconnected" }),
    );
    if (kind === "browser") expect(readThreadPreviewState(threadRef).sessions[id]).toBeDefined();
  },
);

it.each(["browser", "terminal"] as const)(
  "presents the requested %s when its chooser still owns the completed open",
  async (kind) => {
    const { open, close, present, complete } = await chooseFromEmptyPane(kind);
    expect(present).not.toHaveBeenCalled();
    await complete();
    const id = kind === "browser" ? "new-browser" : open.mock.calls[0]![0].input.terminalId;
    expect(present).toHaveBeenCalledExactlyOnceWith(threadRef, id);
    expect(close).not.toHaveBeenCalled();
  },
);
