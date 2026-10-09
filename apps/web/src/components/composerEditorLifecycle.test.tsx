// @vitest-environment jsdom
// @vitest-environment-options {"userAgent":"Mozilla/5.0 Chrome/154.0.0.0 Safari/537.36"}
import { Editor, Node } from "@tiptap/core";
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { act, StrictMode, useEffect, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

let root: Root;
let container: HTMLDivElement;
let editor: Editor;
let mountedChips: number;
let disposedChips: number;

function ChipView() {
  useEffect(() => {
    mountedChips++;
    return () => {
      disposedChips++;
    };
  }, []);
  return (
    <NodeViewWrapper as="span" data-chip="true">
      Context chip
    </NodeViewWrapper>
  );
}

const Chip = Node.create({
  name: "contextChip",
  group: "inline",
  inline: true,
  atom: true,
  parseHTML: () => [{ tag: "span[data-chip]" }],
  renderHTML: () => ["span", { "data-chip": "true" }, "Context chip"],
  addNodeView: () => ReactNodeViewRenderer(ChipView),
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mountedChips = 0;
  disposedChips = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  editor = new Editor({
    extensions: [StarterKit, Chip],
    content: '<p>Draft <span data-chip="true"></span></p>',
  });
});

afterEach(async () => {
  await act(() => root.unmount());
  editor.destroy();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("releases an inactive editor without reading document selection during its redraw", async () => {
  await act(() => root.render(<EditorContent editor={editor} />));
  const state = editor.state;
  const focusNode = vi.spyOn(window.Selection.prototype, "focusNode", "get");

  await act(() => root.render(null));
  expect(focusNode).not.toHaveBeenCalled();
  expect(editor.view.dom.isConnected).toBe(false);
  expect(editor.state).toBe(state);
  expect(editor.isDestroyed).toBe(false);
  expect(mountedChips).toBe(disposedChips);

  focusNode.mockClear();
  await act(() => root.render(<EditorContent editor={editor} />));
  expect(focusNode).toHaveBeenCalled();
  expect(container.querySelectorAll("[data-node-view-wrapper]")).toHaveLength(1);
  expect(editor.view.dom.isConnected).toBe(true);
  expect(mountedChips - disposedChips).toBe(1);
});

it("preserves draft, selection and undo history when the same editor is remounted", async () => {
  await act(() => root.render(<EditorContent editor={editor} />));
  const original = editor.getJSON();
  await act(() => {
    editor.commands.insertContent("Edited ");
    editor.commands.setTextSelection(3);
  });
  const changed = editor.getJSON();
  const selection = editor.state.selection.toJSON();
  await act(() => root.render(null));
  await act(() => root.render(<EditorContent editor={editor} />));

  expect(editor.getJSON()).toEqual(changed);
  expect(editor.state.selection.toJSON()).toEqual(selection);
  expect(container.textContent).toContain("Edited");
  expect(container.querySelectorAll("[data-node-view-wrapper]")).toHaveLength(1);
  await act(() => {
    expect(editor.commands.undo()).toBe(true);
  });
  expect(editor.getJSON()).toEqual(original);
  await act(() => {
    expect(editor.commands.redo()).toBe(true);
  });
  expect(editor.getJSON()).toEqual(changed);
});

it("keeps one usable editor and releases every chip through StrictMode replay", async () => {
  await act(() =>
    root.render(
      <StrictMode>
        <EditorContent editor={editor} />
      </StrictMode>,
    ),
  );
  expect(container.querySelectorAll(".ProseMirror")).toHaveLength(1);
  expect(container.querySelectorAll("[data-node-view-wrapper]")).toHaveLength(1);
  expect(mountedChips - disposedChips).toBe(1);
  await act(() => {
    editor.commands.insertContent("Still editable ");
  });
  expect(container.textContent).toContain("Still editable");
  await act(() => root.render(null));
  expect(disposedChips).toBe(mountedChips);
  expect(editor.isDestroyed).toBe(false);
});

it("preserves selection synchronization for a focused connected editor", async () => {
  await act(() => root.render(<EditorContent editor={editor} />));
  await act(() => {
    editor.view.dom.focus();
    editor.commands.setTextSelection({ from: 1, to: 4 });
  });
  const focusNode = vi.spyOn(window.Selection.prototype, "focusNode", "get");
  await act(() => {
    editor.view.setProps({ nodeViews: {} });
  });
  expect(focusNode).toHaveBeenCalled();
  expect(document.activeElement).toBe(editor.view.dom);
  expect(editor.state.selection.from).toBe(1);
  expect(editor.state.selection.to).toBe(4);
  expect(window.getSelection()?.toString()).toBe("Dra");
});

it("leaves another editor's focus and selection intact when releasing inactive content", async () => {
  const active = new Editor({ extensions: [StarterKit], content: "<p>Active draft</p>" });
  try {
    await act(() =>
      root.render(
        <>
          <EditorContent key="inactive" editor={editor} />
          <EditorContent key="active" editor={active} />
        </>,
      ),
    );
    await act(() => {
      active.view.dom.focus();
      active.commands.setTextSelection({ from: 1, to: 7 });
    });
    const state = active.state;
    const focusNode = vi.spyOn(window.Selection.prototype, "focusNode", "get");
    await act(() => root.render(<EditorContent key="active" editor={active} />));

    expect(focusNode).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(active.view.dom);
    expect(active.state).toBe(state);
    expect(window.getSelection()?.toString()).toBe("Active");
    expect(editor.view.dom.isConnected).toBe(false);
    expect(disposedChips).toBe(mountedChips);
  } finally {
    await act(() => root.render(null));
    active.destroy();
  }
});

it("lets useEditor destroy its owned instance after StrictMode cleanup", async () => {
  const owned = { current: null as Editor | null };
  function OwnedEditor() {
    const instance = useEditor({
      extensions: [StarterKit, Chip],
      content: '<p>Owned <span data-chip="true"></span></p>',
    });
    useLayoutEffect(() => {
      owned.current = instance;
    }, [instance]);
    return <EditorContent editor={instance} />;
  }
  await act(() =>
    root.render(
      <StrictMode>
        <OwnedEditor />
      </StrictMode>,
    ),
  );
  const current = owned.current!;
  expect(current.isDestroyed).toBe(false);
  expect(container.querySelectorAll("[data-node-view-wrapper]")).toHaveLength(1);
  const destroyed = new Promise<void>((resolve) => current.on("destroy", () => resolve()));
  await act(() => root.render(null));
  await destroyed;
  expect(current.isDestroyed).toBe(true);
  expect(disposedChips).toBe(mountedChips);
});
