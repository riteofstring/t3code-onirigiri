// @vitest-environment jsdom
import { getSharedHighlighter } from "@pierre/diffs";
import type { Editor, EditorFactory } from "@pierre/diffs/edit";
import type { EditProviderProps } from "@pierre/diffs/react";
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, ThreadId } from "@t3tools/contracts";
import { compileResolvedKeybindingsConfig } from "../../../../../packages/shared/src/keybindings";
import { fileSurface } from "~/rightPanelStore";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vite-plus/test";

import { ToolPaneView } from "../../../../spatial/src/workspace/ToolPaneView";
import type { ToolPane } from "../../../../spatial/src/workspace/useToolPanes";

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

const enginePath = await vi.hoisted(async () => {
  const NodeModule = await import("node:module");
  const spatialPackage = NodeModule.createRequire(import.meta.url).resolve(
    "../../../../spatial/package.json",
  );
  const spatialRequire = NodeModule.createRequire(spatialPackage);
  const enginePackage = spatialRequire.resolve("@riteofstring/onirigiri/package.json");
  const { main } = spatialRequire(enginePackage) as { main: string };
  return NodeModule.createRequire(enginePackage).resolve(main);
});
vi.mock(enginePath, () => ({ useOnirigiriPaneInteractive: () => true }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => null }));
vi.mock("~/components/RightPanelTabs", () => ({ RightPanelEmptyState: () => null }));
vi.mock("~/components/chat/ThreadRelationshipsControl", () => ({
  ThreadRelationshipsPanel: () => null,
}));
vi.mock("~/components/pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: () => null,
}));
vi.mock("~/components/ThreadPullRequestsPanel", () => ({ ThreadPullRequestsPanel: () => null }));
vi.mock("~/components/files/FileBrowserPanel", () => ({ default: () => null }));
vi.mock("~/components/files/FileBreadcrumbs", () => ({ FileBreadcrumbs: () => null }));
vi.mock("~/components/chat/OpenInPicker", () => ({ OpenInPicker: () => null }));
vi.mock("~/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/components/DiffWorkerPoolProvider", () => ({
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
vi.mock("~/components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("~/localApi", () => ({ readLocalApi: () => ({ dialogs: { confirm: async () => true } }) }));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    select(DEFAULT_CLIENT_SETTINGS),
  useUpdateClientSettings: () => state.command,
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
vi.mock("~/hooks/useWorkspaceMutationRefresh", () => ({ useWorkspaceMutationRefresh: () => {} }));
vi.mock("~/remoteOpen", () => ({ useRemoteOpenState: () => ({ mode: "local-exec" }) }));
vi.mock("~/state/environments", () => ({
  usePrimaryEnvironmentId: () => "environment",
  useEnvironmentHttpBaseUrl: () => null,
}));
vi.mock("~/editorPreferences", () => ({ useOpenInPreferredEditor: () => () => undefined }));
vi.mock("~/composerDraftStore", () => ({
  useComposerDraftStore: (select: (store: typeof state) => unknown) => select(state),
}));
vi.mock("~/state/entities", () => ({
  useThreadShell: () => ({
    environmentId: "environment",
    projectId: "project",
    worktreePath: null,
  }),
  useProject: () => ({ workspaceRoot: "/repo" }),
}));
vi.mock("~/state/filesystem", () => ({
  useFilesystemReadAccess: () => ({ canReadFiles: true, isPending: false, error: null }),
}));
vi.mock("~/state/session", () => ({
  useEnvironmentScope: () => true,
  readEnvironmentScope: () => true,
}));
vi.mock("~/browser/previewRuntime", () => ({ usePreviewAvailable: () => false }));
vi.mock("~/state/terminalSessions", () => ({ useKnownTerminalSessions: () => [] }));
vi.mock("~/state/projects", () => ({ projectEnvironment: { writeFile: { write: true } } }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command?: { write?: boolean }) =>
    command?.write ? state.writeFile : state.command,
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.command }));
vi.mock("~/state/server", () => ({ serverEnvironment: { configValueAtom: () => null } }));
vi.mock("~/state/assets", () => ({ assetEnvironment: { createUrl: {} } }));
vi.mock("~/state/preview", () => ({ previewEnvironment: {} }));
vi.mock("~/state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("~/previewStateStore", () => ({
  useThreadPreviewState: () => ({ serverEpoch: null }),
  isPreviewSupportedInRuntime: () => false,
}));
vi.mock("~/surfaceNavigation", () => ({ useSurfaceNavigation: () => ({}) }));
vi.mock("~/components/files/projectFilesQueryState", () => ({
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
}));
vi.mock("../../../../spatial/src/workspace/useToolPaneContext", () => ({
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
      isPresent={() => true}
    />,
  );
}

beforeAll(async () => {
  await import("./FilePreviewPanel");
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
