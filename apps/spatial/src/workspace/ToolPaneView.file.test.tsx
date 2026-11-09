// @vitest-environment jsdom
import { getSharedHighlighter } from "@pierre/diffs";
import type { Editor, EditorFactory } from "@pierre/diffs/edit";
import type { EditProviderProps } from "@pierre/diffs/react";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "@t3tools/shared/keybindings";
import { fileSurface } from "@t3tools/web/src/rightPanelStore";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";

import { ToolPaneView } from "./ToolPaneView";
import type { ToolPane } from "./useToolPanes";

const state = vi.hoisted(() => ({
  command: vi.fn(),
  writeFile: vi.fn(),
  confirmFile: vi.fn(),
  addReviewComment: vi.fn(),
  removeReviewComment: vi.fn(),
  refresh: vi.fn(),
  editor: undefined as
    | Pick<Editor<"file">, "getText" | "canUndo" | "applyEdits" | "undo">
    | undefined,
  contents: "Keep this editable.\n",
}));

vi.mock("@riteofstring/onirigiri", () => ({ useOnirigiriPaneInteractive: () => true }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null, useAtomMount: () => {} }));
vi.mock("@t3tools/web/src/state/revisionedQuery", () => ({
  revisionedQuery: (query: unknown) => query,
}));
vi.mock("@t3tools/web/src/components/RightPanelTabs", () => ({ RightPanelEmptyState: () => null }));
vi.mock("@t3tools/web/src/components/chat/ThreadRelationshipsControl", () => ({
  ThreadRelationshipsPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/ThreadPullRequestsPanel", () => ({
  ThreadPullRequestsPanel: () => null,
}));
vi.mock("@t3tools/web/src/components/files/FileBrowserPanel", () => ({ default: () => null }));
vi.mock("@t3tools/web/src/components/files/FileBreadcrumbs", () => ({
  FileBreadcrumbs: () => null,
}));
vi.mock("@t3tools/web/src/components/chat/OpenInPicker", () => ({ OpenInPicker: () => null }));
vi.mock("@t3tools/web/src/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@t3tools/web/src/components/DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@pierre/diffs/react", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pierre/diffs/react")>();
  return {
    ...original,
    EditProvider: (props: EditProviderProps<unknown, unknown> & { children: ReactNode }) => {
      const createEditor: EditorFactory<unknown, unknown> = (type, options, key) =>
        props.createEditor(
          type,
          {
            ...options,
            onAttach: (editor, instance) => {
              state.editor = editor;
              options.onAttach?.(editor, instance);
              onAttach();
            },
          },
          key,
        );
      return <original.EditProvider {...props} createEditor={createEditor} />;
    },
    Virtualizer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  };
});
vi.mock("@t3tools/web/src/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("@t3tools/web/src/localApi", () => ({
  readLocalApi: () => ({ dialogs: { confirm: async () => true } }),
}));
vi.mock("@t3tools/web/src/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
  useUpdateClientSettings: () => state.command,
}));
vi.mock("@t3tools/web/src/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("@t3tools/web/src/hooks/useWorkspaceMutationRefresh", () => ({
  useWorkspaceMutationRefresh: () => {},
}));
vi.mock("@t3tools/web/src/remoteOpen", () => ({
  useRemoteOpenState: () => ({ mode: "local-exec" }),
}));
vi.mock("@t3tools/web/src/state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment",
  useEnvironmentHttpBaseUrl: () => null,
}));
vi.mock("@t3tools/web/src/editorPreferences", () => ({
  useOpenInPreferredEditor: () => () => undefined,
}));
vi.mock("@t3tools/web/src/composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: typeof state) => unknown) => select(state),
}));
vi.mock("@t3tools/web/src/state/entities", () => ({
  useThreadShell: () => ({
    environmentId: "environment",
    projectId: "project",
    worktreePath: null,
  }),
  useProject: () => ({ workspaceRoot: "/repo" }),
}));
vi.mock("@t3tools/web/src/state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock("@t3tools/web/src/state/session", async () => {
  const { Atom } = await import("effect/reactivity");
  const sessionState = Atom.make(null);
  return {
    useEnvironmentScope: () => true,
    readEnvironmentScope: () => true,
    environmentSession: { sessionStateAtom: () => sessionState },
  };
});
vi.mock("@t3tools/web/src/browser/previewRuntime", () => ({ usePreviewAvailable: () => false }));
vi.mock("@t3tools/web/src/state/terminalSessions", () => ({ useKnownTerminalSessions: () => [] }));
vi.mock("@t3tools/web/src/state/projects", () => ({
  projectEnvironment: { writeFile: { write: true } },
}));
vi.mock("@t3tools/web/src/state/use-atom-command", () => ({
  useAtomCommand: (command?: { write?: boolean }) =>
    command?.write ? state.writeFile : state.command,
}));
vi.mock("@t3tools/client-runtime/state/runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@t3tools/client-runtime/state/runtime")>()),
  runAtomCommand: (_registry: unknown, command: { write?: boolean }, request: unknown) =>
    command.write ? state.writeFile(request) : state.command(request),
}));
vi.mock("@t3tools/web/src/state/use-atom-query-runner", () => ({
  useAtomQueryRunner: () => state.command,
}));
vi.mock("@t3tools/web/src/state/server", () => ({
  serverEnvironment: { configValueAtom: () => null },
}));
vi.mock("@t3tools/web/src/state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("@t3tools/web/src/state/preview", () => ({ previewEnvironment: {} }));
vi.mock("@t3tools/web/src/state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("@t3tools/web/src/previewStateStore", () => ({
  useThreadPreviewState: () => ({ serverEpoch: null }),
  isPreviewSupportedInRuntime: () => false,
}));
vi.mock("@t3tools/web/src/surfaceNavigation", () => ({ useSurfaceNavigation: () => ({}) }));
vi.mock("@t3tools/web/src/components/files/projectFilesQueryState", () => ({
  useProjectFileQuery: () => ({
    data: { contents: state.contents, truncated: false },
    refresh: state.refresh,
  }),
  setProjectFileQueryData: (
    _environment: unknown,
    _cwd: string,
    _path: string,
    contents: string,
  ) => {
    state.contents = contents;
  },
  confirmProjectFileQueryData: state.confirmFile,
  getOptimisticProjectFileQueryData: () => null,
  getUnsavedProjectFileQueryData: () => null,
  getProjectFileContents: () => state.contents,
  getProjectFileQueryAtom: () => null,
}));
vi.mock("./useToolPaneContext", () => ({
  useToolPaneContext: (threadRef: unknown) => ({
    context: {
      files: { project: { title: "Project" }, workspaceRoot: "/repo", availableEditors: [] },
      terminal: { launchContext: null, focusRequestId: 0 },
      composerDraftTarget: threadRef,
      keybindings: compileResolvedKeybindingsConfig([]),
      workspaceMutationId: null,
    },
    availability: {},
    cwd: "/repo",
    runtimeEnv: {},
  }),
}));
const filePane: ToolPane = {
  paneId: "file",
  kind: "surface",
  surface: fileSurface("notes.txt", null, 0),
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
let root: Root;
let host: HTMLDivElement;
let attached: Promise<void>;
let onAttach: () => void;

function render(focused = true, visible = true) {
  root.render(
    <ToolPaneView
      pane={filePane}
      focused={focused}
      visible={visible}
      onNavigate={() => false}
      onFocusThread={() => {}}
      onDismissDeviceSetup={() => {}}
      onStartChat={() => {}}
      onSelectProject={() => {}}
      isPresent={() => true}
    />,
  );
}

beforeAll(async () => {
  await import("@t3tools/web/src/components/files/FilePreviewPanel");
  await getSharedHighlighter({
    themes: ["pierre-dark"],
    langs: ["text"],
    preferredHighlighter: "shiki-wasm",
  });
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  Object.defineProperty(CSSStyleSheet.prototype, "replaceSync", {
    configurable: true,
    value: () => {},
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: () => {},
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    measureText: (text: string) => ({ width: text.length * 8 }),
  } as unknown as ReturnType<HTMLCanvasElement["getContext"]>);
  attached = new Promise((resolve) => {
    onAttach = resolve;
  });
  state.contents = "Keep this editable.\n";
  state.editor = undefined;
  state.writeFile.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  state.confirmFile.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(CSSStyleSheet.prototype, "replaceSync");
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

it("preserves a pending file edit and undo history when its pane loses focus or visibility", async () => {
  await act(() => render());
  await act(() => attached);
  expect(state.editor, host.innerHTML).toBeDefined();
  const editor = state.editor!;
  expect(editor.getText()).toBe("Keep this editable.\n");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  await act(() =>
    editor.applyEdits([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        newText: "Edited: ",
      },
    ]),
  );
  await act(() => render(false, false));
  expect(state.writeFile).not.toHaveBeenCalled();
  expect(state.editor?.canUndo).toBe(true);
  await act(() => render());
  await act(() => vi.advanceTimersByTimeAsync(500));
  expect(state.writeFile).toHaveBeenCalledExactlyOnceWith({
    environmentId: "environment",
    input: { cwd: "/repo", relativePath: "notes.txt", contents: "Edited: Keep this editable.\n" },
  });
  await act(() => state.editor!.undo());
  expect(state.editor?.getText()).toBe("Keep this editable.\n");
});
