// @vitest-environment jsdom

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { serializeEditorDoc } from "~/composer-rich-text-doc";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "./ComposerPromptEditor";

const draft =
  "> **Assistant and reasoning text still save intermediate full snapshots**, using the existing 50 ms batching. Compaction still preserves their `turn-item.updated` events. [Code](/Users/yashsingh/p/projects/t3code/apps/server/src/orchestration-v2/ProjectionMaintenance.ts:235)";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mountEditor(value: string, richTextEnabled = true) {
  await act(async () =>
    root.render(
      <ComposerPromptEditor
        editorRef={createRef<ComposerPromptEditorHandle>()}
        value={value}
        cursor={0}
        richTextEnabled={richTextEnabled}
        contextRecords={new Map()}
        skills={[]}
        disabled={false}
        placeholder=""
        onChange={() => {}}
        onPaste={() => {}}
      />,
    ),
  );
  const element = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap");
  if (!element) throw new Error("Composer did not mount");
  return element.editor;
}

function press(editor: Editor, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, cancelable: true, ...options });
  const handled = editor.view.props.handleKeyDown?.(editor.view, event);
  expect(event.defaultPrevented).toBe(Boolean(handled));
  return handled;
}

it("keeps Up before the opening bold marker in a quote, including while typing", async () => {
  const editor = await mountEditor(draft);
  const position = editor.state.selection.from;
  await act(async () => {
    editor.view.focus();
    expect(press(editor, "ArrowUp")).toBe(true);
    expect(editor.state.selection.from).toBe(position);
    editor.view.updateState(editor.state);
    const marker = editor.view.dom.querySelector(".composer-rich-marker");
    const caret = window.getSelection()?.getRangeAt(0);
    if (!marker || !caret) throw new Error("Caret or bold marker is missing");
    const markerRange = document.createRange();
    markerRange.selectNode(marker);
    expect(caret.compareBoundaryPoints(Range.START_TO_START, markerRange)).toBeLessThanOrEqual(0);
    // A repeated Up stays at the outside stop, ready for native navigation.
    expect(press(editor, "ArrowUp")).toBe(false);
    editor.commands.insertContent("x");
  });
  expect(serializeEditorDoc(editor.state.doc).value).toBe(draft.replace("> **", "> x**"));
});

it("keeps Down after a closing marker, including while typing", async () => {
  const editor = await mountEditor("> **bold**");
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.atEnd(editor.state.doc)));
    expect(press(editor, "ArrowDown")).toBe(true);
    expect(press(editor, "ArrowDown")).toBe(false);
    editor.commands.insertContent("x");
  });
  expect(serializeEditorDoc(editor.state.doc).value).toBe("> **bold**x");
});

it("leaves vertical navigation between paragraphs to the browser", async () => {
  const editor = await mountEditor("**first**\n**second**");
  await act(async () => {
    const first = editor.state.doc.child(0);
    editor.commands.setTextSelection(first.nodeSize + 1);
    expect(press(editor, "ArrowUp")).toBe(false);
    editor.commands.setTextSelection(first.nodeSize - 1);
    expect(press(editor, "ArrowDown")).toBe(false);
  });
});

it.each([
  { shiftKey: true },
  { altKey: true },
  { metaKey: true },
  { ctrlKey: true },
  { isComposing: true },
])("preserves modified Up behavior for %j", async (options) => {
  const editor = await mountEditor(draft);
  await act(async () => {
    expect(press(editor, "ArrowUp", options)).toBe(false);
    editor.commands.insertContent("x");
  });
  expect(serializeEditorDoc(editor.state.doc).value).toBe(draft.replace("> **", "> **x"));
});

it("leaves literal Markdown navigation to the browser in plain mode", async () => {
  const editor = await mountEditor(draft, false);
  await act(async () => {
    editor.commands.setTextSelection(5);
    expect(press(editor, "ArrowUp")).toBe(false);
    editor.commands.insertContent("x");
  });
  expect(serializeEditorDoc(editor.state.doc).value).toBe(draft.replace("> **", "> **x"));
});

it("atomically binds long and short drafts with valid selections and fresh undo history", async () => {
  const handle = createRef<ComposerPromptEditorHandle>();
  const outgoing = vi.fn();
  const incoming = vi.fn();
  await act(async () =>
    root.render(
      <ComposerPromptEditor
        editorRef={handle}
        imperativeBinding
        value=""
        cursor={0}
        richTextEnabled
        contextRecords={new Map()}
        skills={[]}
        disabled={false}
        placeholder=""
        onChange={outgoing}
        onPaste={() => {}}
      />,
    ),
  );
  const editor = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap")!.editor;
  const long = Array.from(
    { length: 60 },
    (_, n) => `> **Paragraph ${n}** with [link](https://example.com)`,
  ).join("\n\n");
  for (const value of [long, "short", long, ""]) {
    await act(async () => {
      expect(handle.current?.bindDraft?.(value, Infinity, incoming)).toBe(true);
      expect(handle.current?.readSnapshot().value).toBe(value);
      expect(editor.state.selection.$from.doc).toBe(editor.state.doc);
      expect(editor.state.selection.from).toBeLessThanOrEqual(editor.state.doc.content.size);
      expect(editor.commands.undo()).toBe(false);
      editor.commands.insertContent("x");
      expect(handle.current?.readSnapshot().value).toBe(`${value}x`);
    });
  }
  expect(outgoing).not.toHaveBeenCalled();
  expect(incoming).toHaveBeenCalled();
});

it("preserves the outgoing binding while composition is active", async () => {
  const handle = createRef<ComposerPromptEditorHandle>();
  await act(async () =>
    root.render(
      <ComposerPromptEditor
        editorRef={handle}
        imperativeBinding
        value=""
        cursor={0}
        contextRecords={new Map()}
        skills={[]}
        disabled={false}
        placeholder=""
        onChange={() => {}}
        onPaste={() => {}}
      />,
    ),
  );
  const editor = container.querySelector<HTMLElement & { editor: Editor }>(".tiptap")!.editor;
  await act(async () => {
    handle.current?.bindDraft?.("outgoing", Infinity, () => {});
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    expect(handle.current?.bindDraft?.("incoming", Infinity, () => {})).toBe(false);
    expect(handle.current?.readSnapshot().value).toBe("outgoing");
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
});

it("preserves the covered document and layout until ownership returns", async () => {
  const { CoveredComposerContext } = await import("./coveredComposer");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const handle = createRef<ComposerPromptEditorHandle>();
  const render = (value: string, covered: boolean, stockInput = false) =>
    root.render(
      <CoveredComposerContext value={covered}>
        <ComposerPromptEditor
          editorRef={handle}
          stockInput={stockInput}
          value={value}
          cursor={value.length}
          richTextEnabled
          contextRecords={new Map()}
          skills={[]}
          disabled={false}
          placeholder="Message"
          onChange={() => {}}
          onPaste={() => {}}
          onCommandKeyDown={() => false}
        />
      </CoveredComposerContext>,
    );
  try {
    await act(async () => render("original", false));
    const editor = host.querySelector(".tiptap")!;
    await act(async () => render("overlay key one", true));
    await act(async () => render("overlay key two", true));
    expect(host.querySelector(".tiptap")).toBe(editor);
    expect(editor.textContent).toBe("original");
    const region = editor.closest<HTMLElement>("[data-pane-composer-editor]")!;
    expect(region.hasAttribute("inert")).toBe(true);
    expect(region.style.visibility).toBe("hidden");
    await act(async () => render("overlay key two", false));
    expect(editor.textContent).toBe("overlay key two");
    expect(region.hasAttribute("inert")).toBe(false);
    expect(region.style.visibility).toBe("");
    await act(async () => render("pending answer", true, true));
    expect(editor.textContent).toBe("pending answer");
    expect(region.hasAttribute("inert")).toBe(false);
    expect(region.dataset.composerInputOwner).toBe("stock");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
