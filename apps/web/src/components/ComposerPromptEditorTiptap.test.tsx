// @vitest-environment jsdom
import type { Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { DirectEditorProps } from "@tiptap/pm/view";
import { ReactRenderer } from "@tiptap/react";
import { act, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";
import { EMPTY_COMPOSER_CONTEXT_RECORDS } from "./composerContextPresentation";
import { TooltipProvider } from "./ui/tooltip";

let root: Root;
let container: HTMLDivElement;
let editorRef: RefObject<ComposerPromptEditorHandle | null>;
let draft: { value: string; cursor: number };
let changes: string[];
let consoleErrors: unknown[][];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  consoleErrors = [];
  vi.spyOn(console, "error").mockImplementation((...args) => consoleErrors.push(args));
  vi.spyOn(console, "warn").mockImplementation((...args) => consoleErrors.push(args));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  editorRef = createRef();
  draft = { value: "Keep **bold** @README.md safely", cursor: 0 };
  changes = [];
});

afterEach(async () => {
  try {
    await act(() => root.unmount());
    await act(() => vi.runOnlyPendingTimersAsync());
    expect(consoleErrors).toEqual([]);
  } finally {
    container.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

async function renderEditor(richTextEnabled: boolean) {
  await act(() =>
    root.render(
      <TooltipProvider>
        <ComposerPromptEditor
          {...draft}
          richTextEnabled={richTextEnabled}
          contextRecords={EMPTY_COMPOSER_CONTEXT_RECORDS}
          skills={[]}
          disabled={false}
          placeholder="Message"
          editorRef={editorRef}
          onChange={(value, cursor) => {
            draft = { value, cursor };
            changes.push(value);
          }}
          onPaste={() => {}}
        />
      </TooltipProvider>,
    ),
  );
  await act(() => vi.runOnlyPendingTimersAsync());
  const element = container.querySelector<HTMLElement & { editor?: Editor }>(
    '[data-testid="composer-editor"]',
  );
  if (!element?.editor) throw new Error("The real composer editor did not mount");
  return element.editor;
}

function resetsNodeViews(props: Partial<DirectEditorProps>) {
  return props.nodeViews !== undefined && Object.keys(props.nodeViews).length === 0;
}

it.each([true, false])(
  "disposes once before removal and restores the saved draft, rich text=%s",
  async (richTextEnabled) => {
    const editor = await renderEditor(richTextEnabled);
    const view = editor.view;
    expect(
      container.querySelectorAll("[data-composer-mention-chip]"),
      container.innerHTML,
    ).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent ?? null).toBe(
      richTextEnabled ? "bold" : null,
    );

    await act(() => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, " ready");
    });
    expect(draft.value).toBe("Keep **bold** @README.md safely ready");
    const savedDraft = { ...draft };
    const changeCount = changes.length;
    const handle = editorRef.current;
    if (!handle) throw new Error("The real composer handle did not mount");

    const destroyPlugin = vi.fn();
    await act(() => {
      editor.registerPlugin(new Plugin({ view: () => ({ destroy: destroyPlugin }) }));
    });
    const extensions = editor.extensionManager;
    const destroyExtensions = vi.spyOn(extensions, "destroy");
    const destroyView = vi.spyOn(view, "destroy");
    const destroyNodeViews = vi.spyOn(ReactRenderer.prototype, "destroy");
    const setProps = vi.spyOn(view, "setProps");
    const onDestroy = vi.fn();
    editor.on("destroy", onDestroy);
    const nodeViews = [...container.querySelectorAll(".react-renderer")];
    expect(nodeViews).toHaveLength(1);

    await act(() => {
      handle.destroyBeforeRemoval();
      root.render(null);
    });
    await act(() => vi.runOnlyPendingTimersAsync());
    handle.destroyBeforeRemoval();

    expect(editor.isDestroyed).toBe(true);
    expect(editorRef.current).toBeNull();
    expect(view.dom.isConnected).toBe(false);
    expect(nodeViews.every((node) => !node.isConnected)).toBe(true);
    expect(container.childElementCount).toBe(0);
    expect(setProps.mock.calls.some(([props]) => resetsNodeViews(props))).toBe(false);
    expect(destroyView).toHaveBeenCalledTimes(1);
    expect(destroyNodeViews).toHaveBeenCalledTimes(1);
    expect(destroyPlugin).toHaveBeenCalledTimes(1);
    expect(destroyExtensions).toHaveBeenCalledTimes(1);
    expect(extensions.extensions).toHaveLength(0);
    expect(editor.extensionStorage).toEqual({});
    expect(onDestroy).toHaveBeenCalledTimes(1);
    expect(draft).toEqual(savedDraft);
    expect(changes).toHaveLength(changeCount);

    const remounted = await renderEditor(richTextEnabled);
    expect(remounted).not.toBe(editor);
    expect(remounted.isDestroyed).toBe(false);
    expect(editorRef.current?.readSnapshot()).toMatchObject(savedDraft);
    expect(container.querySelectorAll("[data-composer-mention-chip]")).toHaveLength(1);
    expect(container.querySelector("strong")?.textContent ?? null).toBe(
      richTextEnabled ? "bold" : null,
    );
    handle.destroyBeforeRemoval();
    expect(remounted.isDestroyed).toBe(false);
    expect(destroyView).toHaveBeenCalledTimes(1);
    expect(destroyExtensions).toHaveBeenCalledTimes(1);
  },
);

it("retains upstream cleanup when removed without explicit disposal", async () => {
  const editor = await renderEditor(true);
  const setProps = vi.spyOn(editor.view, "setProps");
  const destroyView = vi.spyOn(editor.view, "destroy");

  await act(() => root.render(null));
  await act(() => vi.runOnlyPendingTimersAsync());

  expect(setProps.mock.calls.some(([props]) => resetsNodeViews(props))).toBe(true);
  expect(editor.isDestroyed).toBe(true);
  expect(destroyView).toHaveBeenCalledTimes(1);
  expect(editorRef.current).toBeNull();
  expect(container.childElementCount).toBe(0);
});
